-- ============================================================
-- VERIFIEDMEASURE V3 — DATABASE SETUP (run this first)
-- ============================================================
BEGIN;

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- 0) CORE TYPES
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.dataset_key AS ENUM ('leads');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.business_mode AS ENUM ('hybrid','exclusive_only');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 1) USER PROFILES (AUTO-PROVISION ON SIGNUP)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid PRIMARY KEY,
  role text NOT NULL DEFAULT 'user',
  business_rule public.business_mode NOT NULL DEFAULT 'hybrid',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_read_own" ON public.user_profiles;
CREATE POLICY "profiles_read_own" ON public.user_profiles FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.user_profiles;
CREATE POLICY "profiles_update_own" ON public.user_profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_profiles (id) VALUES (NEW.id) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created') THEN
    CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END $$;

-- ============================================================
-- 2) CREDIT LEDGER (APPEND-ONLY)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  delta integer NOT NULL,
  reason text NOT NULL DEFAULT 'unspecified',
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_ledger_user_idx ON public.credit_ledger(user_id, created_at DESC);
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ledger_read_own" ON public.credit_ledger;
CREATE POLICY "ledger_read_own" ON public.credit_ledger FOR SELECT USING (auth.uid() = user_id);
REVOKE INSERT, UPDATE, DELETE ON public.credit_ledger FROM authenticated, anon;

-- ============================================================
-- 3) AUDIT LOG (APPEND-ONLY)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  action text NOT NULL,
  dataset public.dataset_key,
  record_ids uuid[],
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_user_idx ON public.audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_action_idx ON public.audit_log(action, created_at DESC);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_read_own" ON public.audit_log;
CREATE POLICY "audit_read_own" ON public.audit_log FOR SELECT USING (auth.uid() = user_id);
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM authenticated, anon;

-- ============================================================
-- 4) ENTITLEMENTS (DATASET ACCESS)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.dataset_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  dataset public.dataset_key NOT NULL,
  record_id uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dataset, record_id)
);

CREATE INDEX IF NOT EXISTS dataset_access_user_idx ON public.dataset_access(user_id, dataset, granted_at DESC);
CREATE INDEX IF NOT EXISTS dataset_access_record_idx ON public.dataset_access(dataset, record_id);
ALTER TABLE public.dataset_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dataset_access_read_own" ON public.dataset_access;
CREATE POLICY "dataset_access_read_own" ON public.dataset_access FOR SELECT USING (auth.uid() = user_id);
REVOKE INSERT, UPDATE, DELETE ON public.dataset_access FROM authenticated, anon;

-- ============================================================
-- 5) FEATURE FLAGS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "flags_read" ON public.feature_flags;
CREATE POLICY "flags_read" ON public.feature_flags FOR SELECT USING (auth.role() = 'authenticated');

INSERT INTO public.feature_flags (key, enabled, description) VALUES
  ('ENABLE_ANALYTICS', true, 'Enable dashboard rollups'),
  ('ENABLE_DETAIL_DRAWERS', true, 'Enable record drawers'),
  ('ENABLE_SPARKLINES', false, 'Optional client-only visuals'),
  ('ENABLE_COMMAND_PALETTE', false, 'Optional command palette')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 6) DATASET A: LEADS
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.workflow_status AS ENUM ('new','triaged','qualified','in_sequence','engaged','won','lost','do_not_contact');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company text NOT NULL,
  contact_name text,
  contact_title text,
  email text,
  phone text,
  website text,
  industry text,
  state text,
  city text,
  stage text,
  workflow public.workflow_status NOT NULL DEFAULT 'new',
  intelligence_score integer NOT NULL DEFAULT 0,
  is_premium boolean NOT NULL DEFAULT false,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leads_created_idx ON public.leads(created_at DESC);
CREATE INDEX IF NOT EXISTS leads_company_trgm_idx ON public.leads USING gin (company gin_trgm_ops);
CREATE INDEX IF NOT EXISTS leads_industry_idx ON public.leads(industry);
CREATE INDEX IF NOT EXISTS leads_state_idx ON public.leads(state);
CREATE INDEX IF NOT EXISTS leads_meta_gin ON public.leads USING gin (meta);

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'leads_set_updated_at') THEN
    CREATE TRIGGER leads_set_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leads_preview_select" ON public.leads;
CREATE POLICY "leads_preview_select" ON public.leads FOR SELECT USING (auth.role() = 'authenticated');
REVOKE INSERT, UPDATE, DELETE ON public.leads FROM authenticated, anon;

-- ============================================================
-- 7) DATASET B: HEALTHCARE PROVIDERS
-- ============================================================

COMMIT;
