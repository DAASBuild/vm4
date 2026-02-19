-- ============================================================
-- VERIFIEDMEASURE V3 — UI SUPPORT VIEWS (leads only)
-- Run after DATABASE_SETUP.sql
-- ============================================================

-- Lead distribution dashboard metrics
CREATE OR REPLACE VIEW public.leads_dashboard_metrics AS
SELECT
  COUNT(*)::int AS total_leads,
  COUNT(*) FILTER (WHERE is_premium = true)::int AS premium_leads,
  COUNT(*) FILTER (WHERE is_premium = false)::int AS standard_leads,
  COUNT(DISTINCT industry)::int AS industry_count,
  COUNT(DISTINCT state)::int AS state_count,
  AVG(intelligence_score)::numeric(5,1) AS avg_score,
  MAX(created_at) AS latest_lead_at
FROM public.leads;

-- Per-lead download count (for dl: 0/3 badges)
CREATE OR REPLACE VIEW public.leads_claims_rollup AS
SELECT
  lead_id,
  COUNT(*)::int AS claim_count,
  MAX(granted_at) AS last_claimed_at
FROM public.lead_access
WHERE dataset = 'leads'
GROUP BY lead_id;

-- Industry breakdown
CREATE OR REPLACE VIEW public.leads_industry_rollup AS
SELECT
  COALESCE(industry, 'Unknown') AS industry,
  COUNT(*)::int AS lead_count,
  ROUND(AVG(intelligence_score)::numeric, 1) AS avg_score,
  COUNT(*) FILTER (WHERE is_premium = true)::int AS premium_count
FROM public.leads
GROUP BY industry
ORDER BY lead_count DESC;

-- State breakdown
CREATE OR REPLACE VIEW public.leads_state_rollup AS
SELECT
  COALESCE(state, 'Unknown') AS state,
  COUNT(*)::int AS lead_count
FROM public.leads
GROUP BY state
ORDER BY lead_count DESC;
