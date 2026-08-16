-- ============================================================================
-- Klaudius booking skill — APPOINTMENTS schema (salons, barbers, clinics,
-- groomers, garages: the customer picks a service with a duration, optionally
-- a staff member, and a start time on a granularity grid).
--
-- Applied by the booking skill via the Supabase MCP after replacing every
-- `biz_` with this client's SQL prefix (slug, hyphens → underscores, plus a
-- trailing underscore). Requires Postgres 15+ (UNIQUE NULLS NOT DISTINCT) —
-- every Supabase project qualifies. Safe to re-run: tables use IF NOT
-- EXISTS, functions CREATE OR REPLACE, and seed INSERTs are guarded — which
-- also means a re-run NEVER corrects a wrong seed value; fix seed mistakes
-- with UPDATE/INSERT/DELETE, not by editing and re-applying.
--
-- DESIGN RULE — single source of truth: business-wide rules live in the
-- settings row; services, staff and working hours live in their own tables.
-- The RPCs read them at runtime; the TypeScript layer reads the same rows.
-- Never copy a rule into a function body or a TS constant.
--
-- Model notes:
--   - Availability = free intervals on a staff member's calendar. A candidate
--     start is valid when it sits on the granularity grid within a working
--     block, the service fits before the block ends, and [start, blocked_until)
--     overlaps no confirmed appointment for that staff member.
--   - `blocked_until` = start + duration + the service's buffer (cleanup)
--     time. Appointments must end (incl. buffer) by 23:59 — no crossing
--     midnight.
--   - "Any staff" bookings are assigned inside the create RPC, under the
--     advisory lock, to the qualified free staff member with the fewest
--     appointments that day.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings — exactly one row (id = 1).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS biz_booking_settings (
  id                        int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  business_name             text NOT NULL,
  business_email            text NOT NULL,          -- owner's real, monitored inbox
  business_phone            text NOT NULL DEFAULT '',
  business_address          text NOT NULL DEFAULT '',
  timezone                  text NOT NULL,          -- IANA, e.g. 'Europe/London'
  locale                    text NOT NULL DEFAULT 'en-GB',
  slot_granularity_minutes  int NOT NULL DEFAULT 15 CHECK (slot_granularity_minutes > 0),
  advance_days              int NOT NULL DEFAULT 30 CHECK (advance_days >= 0),
  cutoff_hours              int NOT NULL DEFAULT 2 CHECK (cutoff_hours >= 0),
  -- Anti-abuse: max confirmed appointments one customer email can hold per
  -- date through the PUBLIC flow (front-desk bookings are exempt).
  max_per_customer_per_day  int NOT NULL DEFAULT 3 CHECK (max_per_customer_per_day >= 1),
  ref_prefix                text NOT NULL DEFAULT 'BK',
  updated_at                timestamptz NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 2. Services, staff, qualifications, working hours.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS biz_services (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  description       text NOT NULL DEFAULT '',
  duration_minutes  int NOT NULL CHECK (duration_minutes > 0),
  buffer_minutes    int NOT NULL DEFAULT 0 CHECK (buffer_minutes >= 0),
  price_label       text NOT NULL DEFAULT '',  -- display-only, e.g. '£25' / 'from €40'
  is_active         boolean NOT NULL DEFAULT true,
  sort_order        int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS biz_staff (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0
);

-- Which staff perform which services. Seed every (staff, service) pair unless
-- the business says otherwise.
CREATE TABLE IF NOT EXISTS biz_staff_services (
  staff_id    uuid NOT NULL REFERENCES biz_staff(id) ON DELETE CASCADE,
  service_id  uuid NOT NULL REFERENCES biz_services(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, service_id)
);

-- Working blocks per staff per weekday. Multiple rows per day = split shifts.
CREATE TABLE IF NOT EXISTS biz_staff_hours (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     uuid NOT NULL REFERENCES biz_staff(id) ON DELETE CASCADE,
  day_of_week  int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Sunday
  start_time   time NOT NULL,
  end_time     time NOT NULL,
  CHECK (end_time > start_time),
  -- Blocks may not START at the same instant (catches accidental duplicate
  -- seeds); overlapping-but-offset blocks are legal and de-duplicated by the
  -- availability RPC's DISTINCT.
  UNIQUE (staff_id, day_of_week, start_time)
);

CREATE INDEX IF NOT EXISTS biz_staff_hours_staff_day
  ON biz_staff_hours (staff_id, day_of_week);

-- ---------------------------------------------------------------------------
-- 3. Appointments — one row per booking. Auto-confirms on create.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS biz_appointments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_ref         text UNIQUE NOT NULL,
  cancel_token        text UNIQUE NOT NULL,
  appointment_date    date NOT NULL,
  start_time          time NOT NULL,
  end_time            time NOT NULL,      -- start + duration (what the customer sees)
  blocked_until       time NOT NULL,      -- end + buffer (what scheduling uses)
  service_id          uuid NOT NULL REFERENCES biz_services(id),
  staff_id            uuid NOT NULL REFERENCES biz_staff(id),
  customer_name       text NOT NULL,
  customer_phone      text NOT NULL DEFAULT '',
  customer_email      text NOT NULL DEFAULT '',
  notes               text NOT NULL DEFAULT '',
  -- Nth confirmed booking this customer email had made when this row was
  -- created (1 = first). NULL when unknown (no email, e.g. front-desk
  -- entries). Set by the create RPC; frozen at creation — later
  -- cancellations don't rewrite history.
  visit_number        int,
  status              text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  cancellation_reason text,
  cancelled_by        text CHECK (cancelled_by IN ('customer', 'business')),
  reminder_sent_at    timestamptz,
  created_at          timestamptz NOT NULL DEFAULT NOW(),
  updated_at          timestamptz NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time),
  CHECK (blocked_until >= end_time)
);

-- Upgrade shim: CREATE TABLE IF NOT EXISTS can't add columns to a table from
-- an older install, and a missing column would only surface as a runtime
-- error inside the create RPC. Keep one ALTER per column added after v1.
ALTER TABLE biz_appointments ADD COLUMN IF NOT EXISTS visit_number int;

CREATE INDEX IF NOT EXISTS biz_appointments_date_staff_status
  ON biz_appointments (appointment_date, staff_id, status);
CREATE INDEX IF NOT EXISTS biz_appointments_cancel_token
  ON biz_appointments (cancel_token);

CREATE OR REPLACE FUNCTION biz_appointments_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS biz_appointments_updated_at ON biz_appointments;
CREATE TRIGGER biz_appointments_updated_at
  BEFORE UPDATE ON biz_appointments
  FOR EACH ROW EXECUTE FUNCTION biz_appointments_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Closures — staff_id NULL closes the whole business for the day; a
--    specific staff_id marks just that person unavailable (holiday, sick).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS biz_closures (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closure_date  date NOT NULL,
  staff_id      uuid REFERENCES biz_staff(id) ON DELETE CASCADE,
  reason        text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT biz_closures_date_staff_key UNIQUE NULLS NOT DISTINCT (closure_date, staff_id)
);

-- ---------------------------------------------------------------------------
-- 5. Demand signals — unmet-demand telemetry (see the slot-capacity variant
--    for rationale). IPs stored only as salted hashes.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS biz_demand_signals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_date     date NOT NULL,
  service_id       uuid,
  outcome          text NOT NULL CHECK (outcome IN
                     ('fits', 'no_capacity', 'cutoff_passed', 'date_closed', 'no_staff_day', 'outside_window')),
  source           text NOT NULL CHECK (source IN ('availability_check', 'booking_attempt')),
  times_available  int,
  ip_hash          text,
  created_at       timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS biz_demand_signals_date
  ON biz_demand_signals (booking_date, outcome);

-- ---------------------------------------------------------------------------
-- 6. Lock anon/public access (service-role only, like the pipeline schema).
-- ---------------------------------------------------------------------------

ALTER TABLE biz_booking_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE biz_services         ENABLE ROW LEVEL SECURITY;
ALTER TABLE biz_staff            ENABLE ROW LEVEL SECURITY;
ALTER TABLE biz_staff_services   ENABLE ROW LEVEL SECURITY;
ALTER TABLE biz_staff_hours      ENABLE ROW LEVEL SECURITY;
ALTER TABLE biz_appointments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE biz_closures         ENABLE ROW LEVEL SECURITY;
ALTER TABLE biz_demand_signals   ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 7. Availability: every valid (start time, staff) pair for a date + service.
--    Output columns use slot_-prefixed names so they can never collide with
--    table columns inside the function body (a plpgsql footgun).
--    `slot_cutoff` is returned rather than filtered so the UI can distinguish
--    "fully booked" from "online booking closed".
--
--    p_exclude_appointment_id: ignore this appointment's block when computing
--    free times — the reschedule picker's counterpart to the create RPC's
--    p_reschedule_of. Without it a customer's own 14:00 appointment hides
--    every nearby time, so the picker could never offer the small nudge that
--    is the most common reschedule.
-- ---------------------------------------------------------------------------

-- The parameter list changed when reschedule support landed; drop the old
-- signature so upgrades don't leave an ambiguous overload behind (no-op on
-- fresh installs).
DROP FUNCTION IF EXISTS biz_get_appointment_availability(date, uuid, uuid);

CREATE OR REPLACE FUNCTION biz_get_appointment_availability(
  p_date                   date,
  p_service_id             uuid,
  p_staff_id               uuid DEFAULT NULL,
  p_exclude_appointment_id uuid DEFAULT NULL
)
RETURNS TABLE (
  slot_start       time,
  slot_staff_id    uuid,
  slot_staff_name  text,
  slot_cutoff      boolean
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  s      biz_booking_settings%ROWTYPE;
  svc    biz_services%ROWTYPE;
  v_now  timestamp;
BEGIN
  SELECT * INTO s FROM biz_booking_settings WHERE biz_booking_settings.id = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking settings missing';
  END IF;
  SELECT * INTO svc FROM biz_services sv WHERE sv.id = p_service_id AND sv.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid service';
  END IF;
  v_now := NOW() AT TIME ZONE s.timezone;

  -- Whole-business closure → no availability at all.
  IF EXISTS (
    SELECT 1 FROM biz_closures c
    WHERE c.closure_date = p_date AND c.staff_id IS NULL
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH eligible_staff AS (
    SELECT st.id AS sid, st.name AS sname, st.sort_order AS sorder
    FROM biz_staff st
    JOIN biz_staff_services ss
      ON ss.staff_id = st.id AND ss.service_id = p_service_id
    WHERE st.is_active
      AND (p_staff_id IS NULL OR st.id = p_staff_id)
      AND NOT EXISTS (
        SELECT 1 FROM biz_closures c
        WHERE c.closure_date = p_date AND c.staff_id = st.id
      )
  ),
  candidate AS (
    SELECT
      es.sid,
      es.sname,
      es.sorder,
      (h.start_time + make_interval(mins => gs.offset_min))::time AS cand_start
    FROM eligible_staff es
    JOIN biz_staff_hours h
      ON h.staff_id = es.sid
     AND h.day_of_week = EXTRACT(DOW FROM p_date)::int
    CROSS JOIN LATERAL generate_series(
      0,
      (EXTRACT(EPOCH FROM (h.end_time - h.start_time))::int / 60) - svc.duration_minutes,
      s.slot_granularity_minutes
    ) AS gs(offset_min)
    -- Same no-crossing-midnight rule the create RPC enforces (incl. buffer).
    -- Without this, a late candidate's `+ interval ::time` wraps past
    -- midnight, silently breaking the overlap test below AND offering times
    -- the create RPC would reject.
    WHERE (EXTRACT(EPOCH FROM h.start_time)::int / 60) + gs.offset_min
          + svc.duration_minutes + svc.buffer_minutes <= 23 * 60 + 59
  ),
  free AS (
    -- DISTINCT: overlapping working blocks (split shifts) can generate the
    -- same (staff, start) twice.
    SELECT DISTINCT c.sid, c.sname, c.sorder, c.cand_start
    FROM candidate c
    WHERE NOT EXISTS (
      SELECT 1 FROM biz_appointments a
      WHERE a.appointment_date = p_date
        AND a.staff_id = c.sid
        AND a.status = 'confirmed'
        AND a.id IS DISTINCT FROM p_exclude_appointment_id
        AND a.start_time < (c.cand_start
              + make_interval(mins => svc.duration_minutes + svc.buffer_minutes))::time
        AND a.blocked_until > c.cand_start
    )
  )
  SELECT
    f.cand_start,
    f.sid,
    f.sname,
    (v_now >= (p_date + f.cand_start)::timestamp - make_interval(hours => s.cutoff_hours))
  FROM free f
  ORDER BY f.cand_start, f.sorder, f.sname;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Create an appointment — transactional, all rules enforced under an
--    advisory lock.
--
--    Why an advisory lock: a free calendar interval has no rows to lock, so
--    two racing transactions could both pass the overlap check and
--    double-book the same staff member. The lock key is the DATE alone
--    (coarser than slot-capacity's date:slot) because "any staff" assignment
--    must see a stable picture of the whole day; per-day contention is
--    negligible at small-business volumes. Do not replace this with
--    TypeScript-side checks + a plain INSERT.
--
--    p_staff_id NULL = "any staff": assigned here, under the lock, to the
--    qualified free staff member with the fewest appointments that day.
--    p_admin_override bypasses the cutoff AND the granularity-grid alignment
--    (front-desk bookings at odd times are fine); working hours, closures,
--    overlaps and the advance window always apply.
--
--    p_reschedule_of = the id of a confirmed appointment this booking
--    REPLACES (customer self-reschedule). Inside the same transaction the old
--    appointment is cancelled and excluded from the overlap check and the
--    per-day cap — without the exclusions, moving 14:00 → 14:30 with the same
--    staff member would collide with the customer's own old appointment, and
--    same-day moves would trip the cap. Never implement reschedule as
--    client-side create-then-cancel: it hits both of those traps and can
--    strand the customer with two bookings if the cancel leg fails.
-- ---------------------------------------------------------------------------

-- The parameter list changed when reschedule support landed; drop the old
-- signature so upgrades don't leave an ambiguous overload behind (no-op on
-- fresh installs).
DROP FUNCTION IF EXISTS biz_create_appointment(
  text, text, date, time, uuid, uuid, text, text, text, text, boolean
);

CREATE OR REPLACE FUNCTION biz_create_appointment(
  p_booking_ref    text,
  p_cancel_token   text,
  p_date           date,
  p_start_time     time,
  p_service_id     uuid,
  p_staff_id       uuid,
  p_name           text,
  p_phone          text,
  p_email          text,
  p_notes          text,
  p_admin_override boolean DEFAULT false,
  p_reschedule_of  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  s               biz_booking_settings%ROWTYPE;
  svc             biz_services%ROWTYPE;
  v_now           timestamp;
  v_today         date;
  v_start_min     int;
  v_end_time      time;
  v_blocked_until time;
  v_staff_id      uuid;
  v_staff_name    text;
  v_appt_id       uuid;
  v_visit_number  int;
BEGIN
  -- Lock FIRST, before any read the decision depends on (fresh reads under
  -- every isolation level; no race with concurrent settings/service edits).
  -- Key notes: the literal 'biz_' is prefix-substituted at install, so
  -- different clients sharing one database never contend; to_char (not
  -- ::text) makes the key independent of the session's DateStyle.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('biz_' || to_char(p_date, 'YYYY-MM-DD'), 0)
  );

  SELECT * INTO s FROM biz_booking_settings WHERE biz_booking_settings.id = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking settings missing';
  END IF;
  SELECT * INTO svc FROM biz_services sv WHERE sv.id = p_service_id AND sv.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid service';
  END IF;

  -- Whole-minute starts only (the grid math and overlap windows assume it;
  -- the routes' HH:MM validation already guarantees this for API callers).
  IF EXTRACT(SECOND FROM p_start_time) <> 0 THEN
    RAISE EXCEPTION 'Invalid time';
  END IF;

  v_now   := NOW() AT TIME ZONE s.timezone;
  v_today := v_now::date;
  IF p_date < v_today OR p_date > v_today + s.advance_days THEN
    RAISE EXCEPTION 'Outside booking window';
  END IF;

  IF EXISTS (
    SELECT 1 FROM biz_closures c
    WHERE c.closure_date = p_date AND c.staff_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Date closed';
  END IF;

  IF NOT p_admin_override THEN
    IF v_now >= (p_date + p_start_time)::timestamp
                - make_interval(hours => s.cutoff_hours) THEN
      RAISE EXCEPTION 'Cutoff passed';
    END IF;
  END IF;

  -- Reschedule: cancel the appointment being replaced INSIDE this
  -- transaction. The conditional WHERE makes racing reschedules/cancels safe:
  -- whoever flips the row first wins, everyone else errors out cleanly.
  IF p_reschedule_of IS NOT NULL THEN
    UPDATE biz_appointments
    SET status = 'cancelled',
        cancelled_by = 'customer',
        cancellation_reason = 'Rescheduled to ' || p_booking_ref
    WHERE biz_appointments.id = p_reschedule_of
      AND biz_appointments.status = 'confirmed';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Reschedule target gone';
    END IF;
  END IF;

  -- No crossing midnight: end (incl. buffer) must fit inside the day.
  v_start_min := EXTRACT(HOUR FROM p_start_time)::int * 60
               + EXTRACT(MINUTE FROM p_start_time)::int;
  IF v_start_min + svc.duration_minutes + svc.buffer_minutes > 23 * 60 + 59 THEN
    RAISE EXCEPTION 'Invalid time';
  END IF;
  v_end_time      := p_start_time + make_interval(mins => svc.duration_minutes);
  v_blocked_until := p_start_time + make_interval(mins => svc.duration_minutes + svc.buffer_minutes);

  -- Pick the staff member: the requested one if given, else the least-loaded
  -- qualified free one. All feasibility checks live in this one query; the
  -- advisory lock above makes the read stable.
  SELECT st.id, st.name INTO v_staff_id, v_staff_name
  FROM biz_staff st
  JOIN biz_staff_services ss
    ON ss.staff_id = st.id AND ss.service_id = p_service_id
  WHERE st.is_active
    AND (p_staff_id IS NULL OR st.id = p_staff_id)
    AND NOT EXISTS (
      SELECT 1 FROM biz_closures c
      WHERE c.closure_date = p_date AND c.staff_id = st.id
    )
    AND EXISTS (
      SELECT 1 FROM biz_staff_hours h
      WHERE h.staff_id = st.id
        AND h.day_of_week = EXTRACT(DOW FROM p_date)::int
        AND h.start_time <= p_start_time
        AND h.end_time >= v_end_time
        AND (
          p_admin_override
          OR (EXTRACT(EPOCH FROM (p_start_time - h.start_time))::int / 60)
             % s.slot_granularity_minutes = 0
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM biz_appointments a
      WHERE a.appointment_date = p_date
        AND a.staff_id = st.id
        AND a.status = 'confirmed'
        AND a.start_time < v_blocked_until
        AND a.blocked_until > p_start_time
    )
  ORDER BY
    (SELECT COUNT(*) FROM biz_appointments a2
     WHERE a2.appointment_date = p_date
       AND a2.staff_id = st.id
       AND a2.status = 'confirmed') ASC,
    st.sort_order ASC,
    st.name ASC
  LIMIT 1;

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Time unavailable';
  END IF;

  -- Anti-abuse cap: the public flow can't stack unlimited appointments on
  -- one date under one email. Front-desk bookings (admin override) exempt.
  IF NOT p_admin_override AND COALESCE(p_email, '') <> '' THEN
    IF (SELECT COUNT(*) FROM biz_appointments a3
        WHERE a3.appointment_date = p_date
          AND lower(a3.customer_email) = lower(p_email)
          AND a3.status = 'confirmed') >= s.max_per_customer_per_day THEN
      RAISE EXCEPTION 'Too many bookings';
    END IF;
  END IF;

  -- Nth confirmed booking this customer email has made with us, in the order
  -- they were MADE (1 = first). Deliberately not filtered by date: a
  -- date-scoped "visit number" regresses when someone books a later date
  -- first. Counted here, under the lock, AFTER any reschedule cancel above —
  -- so moving an appointment never inflates the count. NULL when there's no
  -- email to identify the customer by.
  IF COALESCE(p_email, '') <> '' THEN
    SELECT COUNT(*) + 1 INTO v_visit_number
    FROM biz_appointments a4
    WHERE lower(a4.customer_email) = lower(p_email)
      AND a4.status = 'confirmed';
  END IF;

  INSERT INTO biz_appointments (
    booking_ref, cancel_token, appointment_date, start_time, end_time,
    blocked_until, service_id, staff_id, customer_name, customer_phone,
    customer_email, notes, visit_number, status
  )
  VALUES (
    p_booking_ref, p_cancel_token, p_date, p_start_time, v_end_time,
    v_blocked_until, p_service_id, v_staff_id, p_name, COALESCE(p_phone, ''),
    COALESCE(p_email, ''), COALESCE(p_notes, ''), v_visit_number, 'confirmed'
  )
  RETURNING id INTO v_appt_id;

  RETURN jsonb_build_object(
    'id', v_appt_id,
    'booking_ref', p_booking_ref,
    'cancel_token', p_cancel_token,
    'staff_id', v_staff_id,
    'staff_name', v_staff_name,
    'end_time', to_char(v_end_time, 'HH24:MI'),
    'visit_number', v_visit_number
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Seed. booking-generate: replace with this client's answers from the
--    discovery step. Settings uses ON CONFLICT DO NOTHING; the catalogue
--    seeds are wrapped in a "only when empty" guard so re-runs never
--    duplicate or clobber rows the owner has since edited.
-- ---------------------------------------------------------------------------

INSERT INTO biz_booking_settings (
  id, business_name, business_email, business_phone, business_address,
  timezone, locale, slot_granularity_minutes, advance_days, cutoff_hours, ref_prefix
) VALUES (
  1,
  'BUSINESS NAME',          -- booking-generate
  'owner@example.com',      -- booking-generate: owner's monitored inbox
  '',                       -- booking-generate: public phone
  '',                       -- booking-generate: address shown in emails
  'Europe/London',          -- booking-generate: IANA timezone
  'en-GB',                  -- booking-generate: display locale
  15,                       -- booking-generate: grid granularity (minutes)
  30,                       -- booking-generate: advance window (days)
  2,                        -- booking-generate: cutoff (hours before start)
  'BK'                      -- booking-generate: booking-ref prefix
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM biz_services) THEN
    -- booking-generate: one row per service (name, description,
    -- duration_minutes, buffer_minutes, price_label, sort_order).
    INSERT INTO biz_services (name, description, duration_minutes, buffer_minutes, price_label, sort_order) VALUES
      ('EXAMPLE SERVICE', 'Example description', 30, 5, '£25', 1);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM biz_staff) THEN
    -- booking-generate: one row per staff member. For a business with no
    -- meaningful staff choice, seed a single row named after the business —
    -- the booking form hides the staff picker when only one exists.
    INSERT INTO biz_staff (name, sort_order) VALUES
      ('EXAMPLE STAFF', 1);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM biz_staff_services) THEN
    -- booking-generate: default = every staff member performs every service.
    INSERT INTO biz_staff_services (staff_id, service_id)
    SELECT st.id, sv.id FROM biz_staff st CROSS JOIN biz_services sv;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM biz_staff_hours) THEN
    -- booking-generate: working blocks per staff per weekday (0=Sunday).
    -- Multiple rows per day = split shifts.
    INSERT INTO biz_staff_hours (staff_id, day_of_week, start_time, end_time)
    SELECT st.id, d.dow, '09:00'::time, '17:00'::time
    FROM biz_staff st, (VALUES (2),(3),(4),(5),(6)) AS d(dow);
  END IF;
END $$;
