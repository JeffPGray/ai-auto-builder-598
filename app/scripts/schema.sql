-- Supabase schema for the Klaudius pipeline.
-- Run this in the Supabase SQL Editor of your project to create the tables.
--
-- Conversation state lives in the real threads (chat.db or Twilio for
-- SMS, IMAP for email). The columns prefixed
-- last_out_/last_in_/outgoing_touch_count/has_inbound_since_last_out/
-- last_in_preview/thread_synced_at are a materialised cache populated
-- by scripts/sync_thread_state.py — do not write to them by hand.

CREATE TABLE clients (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  location TEXT,
  industry TEXT,
  owner TEXT,
  phone TEXT,
  email TEXT,
  landline TEXT,
  deployed_url TEXT,
  status TEXT NOT NULL DEFAULT 'found'
    CHECK (status IN (
      'found','claimed','gathered','built','deployed',
      'outreach_sent','responded','converted','rejected','lapsed','unreachable'
    )),
  notes TEXT,

  -- Outreach send-side metadata (durable; not derivable from the thread)
  outreach_channel TEXT
    CHECK (outreach_channel IN (
      'email','sms','instagram_dm','whatsapp','facebook_messenger','email+whatsapp'
    ) OR outreach_channel IS NULL),
  outreach_first_sent DATE,
  outreach_message_id TEXT,
  outreach_subject TEXT,
  -- outreach_account is the "lock indicator" for outreach claims:
  --   NULL = available, non-NULL = claimed-or-sent.
  -- The actual value is a sentinel like "primary" or "claiming:<actor>".
  outreach_account TEXT,

  -- Per-client price override (NULL falls back to PRICING from .env).
  price INTEGER,

  -- Thread-state cache (refreshed by sync_thread_state.py — do not write by hand).
  last_out_date              TIMESTAMPTZ,
  last_in_date               TIMESTAMPTZ,
  outgoing_touch_count       INTEGER     NOT NULL DEFAULT 0,
  has_inbound_since_last_out BOOLEAN     NOT NULL DEFAULT false,
  last_in_preview            TEXT,
  thread_synced_at           TIMESTAMPTZ,

  -- Inbound classification cache (set by /follow-up after Stage A noise filter).
  last_in_classification     TEXT
    CHECK (last_in_classification IN ('noise','genuine','rejection','unclear')
           OR last_in_classification IS NULL),
  last_in_classified_for_date TIMESTAMPTZ,

  -- iMessage routing cache.
  imessage_capable BOOLEAN,

  -- Metadata
  google_rating NUMERIC(2,1),
  google_review_count INTEGER,
  facebook TEXT,
  instagram TEXT,
  address TEXT,
  region TEXT,
  website TEXT,
  vercel_project TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  claimed_by TEXT,

  -- Anything not in columns
  extra JSONB DEFAULT '{}'::jsonb
);

-- Phone-uniqueness on phone and email so we can't insert two rows for the
-- same business via different code paths.
ALTER TABLE clients ADD CONSTRAINT unique_email UNIQUE (email);
ALTER TABLE clients ADD CONSTRAINT unique_phone UNIQUE (phone);

-- Indexes
CREATE INDEX idx_clients_status ON clients(status);
CREATE INDEX idx_clients_slug ON clients(slug);
CREATE INDEX idx_clients_phone ON clients(phone);
CREATE INDEX idx_clients_email ON clients(email);
CREATE INDEX idx_clients_outreach
  ON clients (status, outreach_first_sent)
  WHERE status = 'outreach_sent';
CREATE INDEX idx_clients_thread_state
  ON clients (status, has_inbound_since_last_out, last_out_date)
  WHERE status IN ('outreach_sent','responded');
CREATE INDEX idx_clients_inbound_pending
  ON clients (status, has_inbound_since_last_out, last_in_classification)
  WHERE has_inbound_since_last_out = true;
CREATE INDEX clients_imessage_capable_idx
  ON clients (imessage_capable)
  WHERE imessage_capable IS NOT NULL;

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Phone / landline / email normalization at write time.
-- Keeps the columns canonical so equality checks across the codebase
-- Just Work, regardless of how a phone was entered (with spaces, dashes,
-- parentheses, etc.).
--
-- Region-agnostic: only generic non-digit/non-plus characters are stripped.
-- The original Website Factory pipeline this is derived from also performed
-- a UK-specific +44 → 0 prefix conversion; that's omitted here because
-- Klaudius is region-agnostic. If you operate in a single country and
-- want a canonical local-format phone, add a country-specific conversion
-- here yourself.
CREATE OR REPLACE FUNCTION normalize_phone_trigger()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.phone IS NOT NULL THEN
    NEW.phone := regexp_replace(NEW.phone, '[^0-9+]', '', 'g');
  END IF;
  IF NEW.landline IS NOT NULL THEN
    NEW.landline := regexp_replace(NEW.landline, '[^0-9+]', '', 'g');
  END IF;
  IF NEW.email IS NOT NULL AND NEW.email != '' THEN
    NEW.email := lower(trim(NEW.email));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_normalize_phone
  BEFORE INSERT OR UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION normalize_phone_trigger();

-- Row Level Security: locked down to service-role access only.
-- Pipeline scripts use the service-role key from .env, which bypasses RLS
-- entirely. RLS enabled with NO policies = deny-by-default for the anon and
-- authenticated keys — exactly what we want for a CRM holding prospects'
-- names, phones, and emails. Deliberately no CREATE POLICY here: a
-- USING (true) policy without a TO clause would grant the anon key full
-- access, and the service role never needed a policy in the first place.
--
-- Existing installs: earlier versions of this file shipped
--   CREATE POLICY "Allow all for service role" ON clients FOR ALL USING (true);
-- which (lacking `TO service_role`) applied to anon/authenticated too. If
-- your Supabase project has it, remove it — the pipeline is unaffected:
--   DROP POLICY IF EXISTS "Allow all for service role" ON clients;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
