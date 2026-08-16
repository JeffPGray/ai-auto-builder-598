-- ============================================================================
-- Klaudius booking skill — SLOT-CAPACITY schema (restaurants with sittings,
-- classes, tours, events: fixed start times, each with a capacity that
-- bookings consume).
--
-- Applied by the booking skill via the Supabase MCP after replacing every
-- `biz_` with this client's SQL prefix (slug, hyphens → underscores, plus a
-- trailing underscore). Requires Postgres 15+ (UNIQUE NULLS NOT DISTINCT) —
-- every Supabase project qualifies. Safe to re-run: tables use IF NOT
-- EXISTS, functions CREATE OR REPLACE, and the seed INSERT is ON CONFLICT
-- DO NOTHING — which also means a re-run NEVER corrects a wrong seed value;
-- fix seed mistakes with an UPDATE, not by editing and re-applying.
--
-- DESIGN RULE — single source of truth: every business rule (days, slot
-- times, capacity, party sizes, cutoff, advance window, timezone) lives in
-- the settings row below and NOWHERE else. The RPCs read it at runtime; the
-- TypeScript layer reads the same row. Never copy one of these values into a
-- function body or a TS constant — that exact drift once broke same-day
-- bookings in the production system this schema is distilled from.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings — exactly one row (id = 1). The owner's rules, editable later
--    with a plain UPDATE (changes apply immediately; no redeploy needed).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS biz_booking_settings (
  id                     int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  business_name          text NOT NULL,
  business_email         text NOT NULL,           -- owner's real, monitored inbox
  business_phone         text NOT NULL DEFAULT '',
  business_address       text NOT NULL DEFAULT '',
  timezone               text NOT NULL,           -- IANA, e.g. 'Europe/London'
  locale                 text NOT NULL DEFAULT 'en-GB',  -- date/time display format
  service_days           int[] NOT NULL,          -- 0=Sunday … 6=Saturday
  slot_times             text[] NOT NULL,         -- 'HH:MM' 24h, e.g. {'18:00','20:00'}
  slot_duration_minutes  int NOT NULL DEFAULT 120,
  max_covers_per_slot    int NOT NULL,            -- headcount cap per slot
  tables_per_slot        int,                     -- NULL = headcount-only capacity
  covers_per_table       int,                     -- seats per table (when tables used)
  min_party              int NOT NULL DEFAULT 1,
  max_party              int NOT NULL,
  advance_days           int NOT NULL DEFAULT 30, -- how far ahead bookings open
  cutoff_hours           int NOT NULL DEFAULT 6,  -- booking + online-cancel close
  -- Anti-abuse: max confirmed bookings one customer email can hold per date
  -- through the PUBLIC flow (staff phone bookings are exempt).
  max_per_customer_per_day int NOT NULL DEFAULT 3 CHECK (max_per_customer_per_day >= 1),
  ref_prefix             text NOT NULL DEFAULT 'BK',
  updated_at             timestamptz NOT NULL DEFAULT NOW(),
  CHECK ((tables_per_slot IS NULL) = (covers_per_table IS NULL)),
  CHECK (min_party >= 1 AND max_party >= min_party),
  CHECK (max_covers_per_slot >= max_party),
  -- Guard rails for owner edits (these are one bad UPDATE away otherwise):
  -- covers_per_table = 0 would divide by zero on every availability call;
  -- negative cutoff/advance silently invert the rules; 7 is the classic
  -- ISO-weekday mistake (Postgres DOW is 0=Sunday … 6=Saturday, never 7).
  CHECK (tables_per_slot IS NULL OR (tables_per_slot >= 1 AND covers_per_table >= 1)),
  CHECK (slot_duration_minutes > 0),
  CHECK (advance_days >= 0 AND cutoff_hours >= 0),
  CHECK (cardinality(service_days) >= 1 AND array_position(service_days, NULL) IS NULL
         AND service_days <@ ARRAY[0, 1, 2, 3, 4, 5, 6]),
  CHECK (cardinality(slot_times) >= 1 AND array_position(slot_times, NULL) IS NULL)
);

-- ---------------------------------------------------------------------------
-- 2. Bookings — one row per reservation. Auto-confirms on create.
--    CHECK constraints stay structural only; the business rules are enforced
--    by the create RPC against the settings row.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS biz_bookings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_ref         text UNIQUE NOT NULL,
  cancel_token        text UNIQUE NOT NULL,
  booking_date        date NOT NULL,
  slot_time           text NOT NULL,              -- 'HH:MM', one of settings.slot_times
  party_size          int NOT NULL CHECK (party_size >= 1),
  tables_consumed     int,                        -- NULL when capacity is headcount-only
  customer_name       text NOT NULL,
  customer_phone      text NOT NULL DEFAULT '',
  customer_email      text NOT NULL DEFAULT '',
  special_requests    text NOT NULL DEFAULT '',
  -- Nth confirmed booking this customer email had made when this row was
  -- created (1 = first). NULL when unknown (no email, e.g. phone bookings).
  -- Set by the create RPC; frozen at creation — later cancellations don't
  -- rewrite history.
  visit_number        int,
  status              text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  cancellation_reason text,
  cancelled_by        text CHECK (cancelled_by IN ('customer', 'business')),
  reminder_sent_at    timestamptz,
  created_at          timestamptz NOT NULL DEFAULT NOW(),
  updated_at          timestamptz NOT NULL DEFAULT NOW()
);

-- Upgrade shim: CREATE TABLE IF NOT EXISTS can't add columns to a table from
-- an older install, and a missing column would only surface as a runtime
-- error inside the create RPC. Keep one ALTER per column added after v1.
ALTER TABLE biz_bookings ADD COLUMN IF NOT EXISTS visit_number int;

CREATE INDEX IF NOT EXISTS biz_bookings_date_slot_status
  ON biz_bookings (booking_date, slot_time, status);
CREATE INDEX IF NOT EXISTS biz_bookings_cancel_token
  ON biz_bookings (cancel_token);

CREATE OR REPLACE FUNCTION biz_bookings_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS biz_bookings_updated_at ON biz_bookings;
CREATE TRIGGER biz_bookings_updated_at
  BEFORE UPDATE ON biz_bookings
  FOR EACH ROW EXECUTE FUNCTION biz_bookings_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Closures — owner blackout dates. slot_time NULL closes the whole day;
--    a specific 'HH:MM' closes just that slot.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS biz_closures (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closure_date  date NOT NULL,
  slot_time     text,
  reason        text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT biz_closures_date_slot_key UNIQUE NULLS NOT DISTINCT (closure_date, slot_time)
);

-- ---------------------------------------------------------------------------
-- 4. Demand signals — unmet-demand telemetry. Every availability check and
--    every capacity rejection is logged so the operator can later show the
--    owner hard numbers ("you turned away N covers last month — worth adding
--    a slot?"). IPs are stored only as salted hashes.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS biz_demand_signals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_date  date NOT NULL,
  party_size    int NOT NULL,
  outcome       text NOT NULL CHECK (outcome IN
                  ('fits', 'no_capacity', 'cutoff_passed', 'date_closed', 'date_off_service', 'outside_window')),
  source        text NOT NULL CHECK (source IN ('availability_check', 'booking_attempt')),
  slot_states   jsonb,
  ip_hash       text,
  created_at    timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS biz_demand_signals_date
  ON biz_demand_signals (booking_date, outcome);

-- ---------------------------------------------------------------------------
-- 5. Lock anon/public access. The site's server routes use the service-role
--    key, which bypasses RLS; enabling RLS with no policies denies everything
--    else (same hardening pattern as the pipeline's own schema).
-- ---------------------------------------------------------------------------

ALTER TABLE biz_booking_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE biz_bookings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE biz_closures         ENABLE ROW LEVEL SECURITY;
ALTER TABLE biz_demand_signals   ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 6. Helper: tables consumed by a party = ceil(party / covers_per_table).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION biz_tables_for_party(p_party_size int, p_covers_per_table int)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CEIL(p_party_size::numeric / p_covers_per_table)::int
$$;

-- ---------------------------------------------------------------------------
-- 7. Availability per slot for a date + party size. One row per configured
--    slot with usage, remaining capacity, and the state flags the UI needs.
--    `can_fit_party` is capacity-only; combine with closed/cutoff_passed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION biz_get_slot_availability(
  p_date        date,
  p_party_size  int
)
RETURNS TABLE (
  slot_time         text,
  covers_booked     int,
  tables_booked     int,
  covers_remaining  int,
  tables_remaining  int,   -- NULL when capacity is headcount-only
  can_fit_party     boolean,
  cutoff_passed     boolean,
  closed            boolean
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  s      biz_booking_settings%ROWTYPE;
  v_now  timestamp;  -- wall-clock in the business timezone
BEGIN
  SELECT * INTO s FROM biz_booking_settings WHERE biz_booking_settings.id = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking settings missing';
  END IF;
  v_now := NOW() AT TIME ZONE s.timezone;

  RETURN QUERY
  WITH slots AS (
    SELECT st AS slot_t, (p_date + st::time)::timestamp AS starts_at
    FROM unnest(s.slot_times) AS st
  ),
  agg AS (
    SELECT
      b.slot_time AS slot_t,
      COALESCE(SUM(b.party_size), 0)::int      AS covers,
      COALESCE(SUM(b.tables_consumed), 0)::int AS tabs
    FROM biz_bookings b
    WHERE b.booking_date = p_date
      AND b.status = 'confirmed'
    GROUP BY b.slot_time
  )
  SELECT
    sl.slot_t,
    COALESCE(a.covers, 0),
    COALESCE(a.tabs, 0),
    GREATEST(s.max_covers_per_slot - COALESCE(a.covers, 0), 0),
    CASE WHEN s.tables_per_slot IS NULL THEN NULL
         ELSE GREATEST(s.tables_per_slot - COALESCE(a.tabs, 0), 0) END,
    (
      p_party_size <= s.max_covers_per_slot - COALESCE(a.covers, 0)
      AND (
        s.tables_per_slot IS NULL
        OR biz_tables_for_party(p_party_size, s.covers_per_table)
           <= s.tables_per_slot - COALESCE(a.tabs, 0)
      )
    ),
    (v_now >= sl.starts_at - make_interval(hours => s.cutoff_hours)),
    EXISTS (
      SELECT 1 FROM biz_closures c
      WHERE c.closure_date = p_date
        AND (c.slot_time IS NULL OR c.slot_time = sl.slot_t)
    )
  FROM slots sl
  LEFT JOIN agg a ON a.slot_t = sl.slot_t
  ORDER BY sl.slot_t;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Create a booking — transactional, with every rule enforced under an
--    advisory lock.
--
--    Why an advisory lock and not row locks: an empty or under-capacity slot
--    has no rows to FOR UPDATE, so two racing transactions could both pass
--    the capacity check and both insert. The advisory xact lock (keyed on
--    date:slot, so different slots never contend) serialises writers for one
--    slot; it releases automatically at transaction end. Do not replace this
--    with TypeScript-side checks + a plain INSERT — that reintroduces the
--    race.
--
--    p_admin_override bypasses the CUTOFF only (staff taking same-day phone
--    bookings) — the cutoff is a guest-facing courtesy, not a physical
--    constraint. Capacity, closures, service days and the advance window
--    apply to everyone.
--
--    p_reschedule_of = the id of a confirmed booking this one REPLACES
--    (customer self-reschedule). Inside the same transaction the old booking
--    is cancelled — before the capacity sums and the per-day cap run — so a
--    same-day move never trips the cap and the customer can never lose their
--    old slot without gaining the new one. Never implement reschedule as
--    client-side create-then-cancel.
-- ---------------------------------------------------------------------------

-- The parameter list changed when reschedule support landed; drop the old
-- signature so upgrades don't leave an ambiguous overload behind (no-op on
-- fresh installs).
DROP FUNCTION IF EXISTS biz_create_booking(
  text, text, date, text, int, text, text, text, text, boolean
);

CREATE OR REPLACE FUNCTION biz_create_booking(
  p_booking_ref      text,
  p_cancel_token     text,
  p_date             date,
  p_slot_time        text,
  p_party_size       int,
  p_name             text,
  p_phone            text,
  p_email            text,
  p_special_requests text,
  p_admin_override   boolean DEFAULT false,
  p_reschedule_of    uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  s                 biz_booking_settings%ROWTYPE;
  v_now             timestamp;
  v_today           date;
  v_tables_needed   int;
  v_existing_covers int;
  v_existing_tables int;
  v_closed          boolean;
  v_booking_id      uuid;
  v_visit_number    int;
BEGIN
  -- Lock FIRST, before any read the decision depends on. Two reasons:
  -- (a) if a caller ever wraps this in REPEATABLE READ/SERIALIZABLE, a
  -- pre-lock read would pin the snapshot BEFORE a competing insert commits
  -- and the capacity check would miss it; locking first keeps the reads
  -- fresh under every isolation level. (b) a concurrent settings UPDATE
  -- can't race the decision.
  -- Key notes: the literal 'biz_' is prefix-substituted at install, so
  -- different clients sharing one database never contend; to_char (not
  -- ::text) makes the key independent of the session's DateStyle.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('biz_' || to_char(p_date, 'YYYY-MM-DD') || ':' || p_slot_time, 0)
  );

  SELECT * INTO s FROM biz_booking_settings WHERE biz_booking_settings.id = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking settings missing';
  END IF;

  IF NOT (p_slot_time = ANY(s.slot_times)) THEN
    RAISE EXCEPTION 'Invalid slot';
  END IF;
  IF p_party_size < s.min_party OR p_party_size > s.max_party THEN
    RAISE EXCEPTION 'Invalid party size';
  END IF;
  IF NOT (EXTRACT(DOW FROM p_date)::int = ANY(s.service_days)) THEN
    RAISE EXCEPTION 'Date not in service days';
  END IF;

  v_now   := NOW() AT TIME ZONE s.timezone;
  v_today := v_now::date;
  IF p_date < v_today OR p_date > v_today + s.advance_days THEN
    RAISE EXCEPTION 'Outside booking window';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM biz_closures c
    WHERE c.closure_date = p_date
      AND (c.slot_time IS NULL OR c.slot_time = p_slot_time)
  ) INTO v_closed;
  IF v_closed THEN
    RAISE EXCEPTION 'Date closed';
  END IF;

  IF NOT p_admin_override THEN
    IF v_now >= (p_date + p_slot_time::time)::timestamp
                - make_interval(hours => s.cutoff_hours) THEN
      RAISE EXCEPTION 'Cutoff passed';
    END IF;
  END IF;

  -- Reschedule: cancel the booking being replaced INSIDE this transaction,
  -- BEFORE the capacity sums and per-day cap below (so the old booking no
  -- longer counts against either). The conditional WHERE makes racing
  -- reschedules/cancels safe: whoever flips the row first wins.
  IF p_reschedule_of IS NOT NULL THEN
    UPDATE biz_bookings
    SET status = 'cancelled',
        cancelled_by = 'customer',
        cancellation_reason = 'Rescheduled to ' || p_booking_ref
    WHERE biz_bookings.id = p_reschedule_of
      AND biz_bookings.status = 'confirmed';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Reschedule target gone';
    END IF;
  END IF;

  v_tables_needed := CASE WHEN s.tables_per_slot IS NULL THEN NULL
                          ELSE biz_tables_for_party(p_party_size, s.covers_per_table) END;

  -- Safe to read without row locks; the advisory lock above guarantees we're
  -- the only writer for this date+slot right now.
  SELECT
    COALESCE(SUM(b.party_size), 0)::int,
    COALESCE(SUM(b.tables_consumed), 0)::int
  INTO v_existing_covers, v_existing_tables
  FROM biz_bookings b
  WHERE b.booking_date = p_date
    AND b.slot_time = p_slot_time
    AND b.status = 'confirmed';

  IF v_existing_covers + p_party_size > s.max_covers_per_slot THEN
    RAISE EXCEPTION 'Slot full';
  END IF;
  IF s.tables_per_slot IS NOT NULL
     AND v_existing_tables + v_tables_needed > s.tables_per_slot THEN
    RAISE EXCEPTION 'Slot full';
  END IF;

  -- Anti-abuse cap: the public flow can't stack unlimited bookings on one
  -- date under one email (accidental duplicates + casual calendar-bombing).
  -- Staff phone bookings (admin override) are exempt.
  IF NOT p_admin_override AND COALESCE(p_email, '') <> '' THEN
    IF (SELECT COUNT(*) FROM biz_bookings b2
        WHERE b2.booking_date = p_date
          AND lower(b2.customer_email) = lower(p_email)
          AND b2.status = 'confirmed') >= s.max_per_customer_per_day THEN
      RAISE EXCEPTION 'Too many bookings';
    END IF;
  END IF;

  -- Nth confirmed booking this customer email has made with us, in the order
  -- they were MADE (1 = first). Deliberately not filtered by date: a
  -- date-scoped count regresses when someone books a later date first.
  -- Counted here, under the lock, AFTER any reschedule cancel above — so
  -- moving a booking never inflates the count. NULL when there's no email to
  -- identify the customer by.
  IF COALESCE(p_email, '') <> '' THEN
    SELECT COUNT(*) + 1 INTO v_visit_number
    FROM biz_bookings b4
    WHERE lower(b4.customer_email) = lower(p_email)
      AND b4.status = 'confirmed';
  END IF;

  INSERT INTO biz_bookings (
    booking_ref, cancel_token, booking_date, slot_time, party_size,
    tables_consumed, customer_name, customer_phone, customer_email,
    special_requests, visit_number, status
  )
  VALUES (
    p_booking_ref, p_cancel_token, p_date, p_slot_time, p_party_size,
    v_tables_needed, p_name, COALESCE(p_phone, ''), COALESCE(p_email, ''),
    COALESCE(p_special_requests, ''), v_visit_number, 'confirmed'
  )
  RETURNING id INTO v_booking_id;

  RETURN jsonb_build_object(
    'id', v_booking_id,
    'booking_ref', p_booking_ref,
    'cancel_token', p_cancel_token,
    'visit_number', v_visit_number
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Seed the settings row.
--    booking-generate: replace every value below with this client's answers
--    from the discovery step, then keep the ON CONFLICT guard so re-running
--    the schema never clobbers rules the owner has since tuned.
-- ---------------------------------------------------------------------------

INSERT INTO biz_booking_settings (
  id, business_name, business_email, business_phone, business_address,
  timezone, locale, service_days, slot_times, slot_duration_minutes,
  max_covers_per_slot, tables_per_slot, covers_per_table,
  min_party, max_party, advance_days, cutoff_hours, ref_prefix
) VALUES (
  1,
  'BUSINESS NAME',            -- booking-generate
  'owner@example.com',        -- booking-generate: owner's monitored inbox
  '',                         -- booking-generate: public phone
  '',                         -- booking-generate: address shown in emails
  'Europe/London',            -- booking-generate: IANA timezone
  'en-GB',                    -- booking-generate: display locale
  '{4,5,6}',                  -- booking-generate: 0=Sun … 6=Sat
  '{18:00,20:00}',            -- booking-generate: slot start times
  120,                        -- booking-generate: slot duration (minutes)
  18,                         -- booking-generate: max covers per slot
  6,                          -- booking-generate: tables per slot, or NULL
  3,                          -- booking-generate: covers per table, or NULL
  2,                          -- booking-generate: min party
  8,                          -- booking-generate: max party
  30,                         -- booking-generate: advance window (days)
  6,                          -- booking-generate: cutoff (hours before slot)
  'BK'                        -- booking-generate: booking-ref prefix
)
ON CONFLICT (id) DO NOTHING;
