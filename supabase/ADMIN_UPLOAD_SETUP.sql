-- ============================================================
-- VERIFIEDMEASURE V3 — ADMIN UPLOAD STAGING (run after DATABASE_SETUP.sql)
-- Staging → Validate → Approve → Merge into production leads
-- ============================================================

-- 0) Extensions (safe if already enabled)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Batch table
CREATE TABLE IF NOT EXISTS public.lead_upload_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text,
  source text DEFAULT 'admin_upload',
  total_rows int DEFAULT 0,
  inserted_rows int DEFAULT 0,
  skipped_rows int DEFAULT 0,
  status text DEFAULT 'uploaded' CHECK (status IN ('uploaded','validated','approved','merged','rejected')),
  uploaded_by uuid REFERENCES auth.users(id),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  merged_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- 2) Staging table
CREATE TABLE IF NOT EXISTS public.lead_upload_staging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.lead_upload_batches(id) ON DELETE CASCADE,
  full_contact_name text,
  title_role text,
  validated_corporate_email text,
  phone_number text,
  company_name text,
  website text,
  state text,
  regulation_type text,
  filing_date date,
  sec_filing_url text,
  email_norm text GENERATED ALWAYS AS (lower(coalesce(validated_corporate_email,''))) STORED,
  company_norm text GENERATED ALWAYS AS (lower(regexp_replace(coalesce(company_name,''), '\s+', ' ', 'g'))) STORED,
  website_norm text GENERATED ALWAYS AS (lower(coalesce(website,''))) STORED,
  phone_norm text GENERATED ALWAYS AS (regexp_replace(coalesce(phone_number,''), '[^0-9]', '', 'g')) STORED,
  validation_errors text,
  is_valid boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staging_batch ON public.lead_upload_staging(batch_id);
CREATE INDEX IF NOT EXISTS idx_staging_email_company ON public.lead_upload_staging(email_norm, company_norm);

-- 3) Production dedupe constraint (email+company)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_lead_identity'
  ) THEN
    ALTER TABLE public.leads ADD CONSTRAINT unique_lead_identity UNIQUE (email, company);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_leads_email ON public.leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_company ON public.leads(company);

-- 4) RLS
ALTER TABLE public.lead_upload_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_upload_staging ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_read_batches" ON public.lead_upload_batches;
CREATE POLICY "admin_read_batches" ON public.lead_upload_batches FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_write_batches" ON public.lead_upload_batches;
CREATE POLICY "admin_write_batches" ON public.lead_upload_batches FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_read_staging" ON public.lead_upload_staging;
CREATE POLICY "admin_read_staging" ON public.lead_upload_staging FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_write_staging" ON public.lead_upload_staging;
CREATE POLICY "admin_write_staging" ON public.lead_upload_staging FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 5) RPC: create batch
CREATE OR REPLACE FUNCTION public.create_lead_upload_batch(p_filename text, p_total_rows int)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  INSERT INTO public.lead_upload_batches(filename, total_rows, status, uploaded_by)
  VALUES (p_filename, COALESCE(p_total_rows,0), 'uploaded', auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 6) RPC: insert staging row
CREATE OR REPLACE FUNCTION public.insert_lead_upload_staging(
  p_batch_id uuid, p_full_contact_name text, p_title_role text,
  p_validated_corporate_email text, p_phone_number text,
  p_company_name text, p_website text, p_state text,
  p_regulation_type text, p_filing_date date, p_sec_filing_url text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  INSERT INTO public.lead_upload_staging(
    batch_id, full_contact_name, title_role, validated_corporate_email, phone_number,
    company_name, website, state, regulation_type, filing_date, sec_filing_url
  ) VALUES (
    p_batch_id, p_full_contact_name, p_title_role, p_validated_corporate_email, p_phone_number,
    p_company_name, p_website, p_state, p_regulation_type, p_filing_date, p_sec_filing_url
  );
END $$;

-- 7) RPC: validate batch
CREATE OR REPLACE FUNCTION public.validate_lead_upload_batch(p_batch_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total int; v_invalid int;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  UPDATE public.lead_upload_staging SET is_valid = true, validation_errors = null WHERE batch_id = p_batch_id;
  UPDATE public.lead_upload_staging SET is_valid = false, validation_errors = COALESCE(validation_errors,'') || 'missing_email_or_company;'
    WHERE batch_id = p_batch_id AND (email_norm = '' OR company_norm = '');
  UPDATE public.lead_upload_staging SET is_valid = false, validation_errors = COALESCE(validation_errors,'') || 'bad_email;'
    WHERE batch_id = p_batch_id AND email_norm <> '' AND position('@' IN email_norm) = 0;
  SELECT COUNT(*) INTO v_total FROM public.lead_upload_staging WHERE batch_id = p_batch_id;
  SELECT COUNT(*) INTO v_invalid FROM public.lead_upload_staging WHERE batch_id = p_batch_id AND is_valid = false;
  UPDATE public.lead_upload_batches SET status = 'validated', total_rows = v_total WHERE id = p_batch_id;
  RETURN json_build_object('batch_id', p_batch_id, 'total_rows', v_total, 'invalid_rows', v_invalid, 'valid_rows', (v_total - v_invalid));
END $$;

-- 8) RPC: approve & merge
CREATE OR REPLACE FUNCTION public.approve_and_merge_lead_upload_batch(p_batch_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inserted int := 0; v_skipped int := 0; v_valid int := 0;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  UPDATE public.lead_upload_batches SET status = 'approved', approved_by = auth.uid(), approved_at = now() WHERE id = p_batch_id;
  SELECT COUNT(*) INTO v_valid FROM public.lead_upload_staging WHERE batch_id = p_batch_id AND is_valid = true;
  INSERT INTO public.leads (company, email, phone, contact_name, contact_title, website, state, industry, intelligence_score)
  SELECT s.company_name, s.validated_corporate_email, s.phone_number, s.full_contact_name, s.title_role, s.website, s.state, 'AI', 75
  FROM public.lead_upload_staging s
  WHERE s.batch_id = p_batch_id AND s.is_valid = true
  ON CONFLICT (email, company) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_skipped := GREATEST(v_valid - v_inserted, 0);
  UPDATE public.lead_upload_batches SET status = 'merged', inserted_rows = v_inserted, skipped_rows = v_skipped, merged_at = now() WHERE id = p_batch_id;
  RETURN json_build_object('batch_id', p_batch_id, 'valid_rows', v_valid, 'inserted_rows', v_inserted, 'skipped_rows', v_skipped, 'status', 'merged');
END $$;

-- 9) Permissions
GRANT EXECUTE ON FUNCTION public.create_lead_upload_batch(text,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_lead_upload_staging(uuid,text,text,text,text,text,text,text,text,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_lead_upload_batch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_and_merge_lead_upload_batch(uuid) TO authenticated;
