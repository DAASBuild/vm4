# VerifiedMeasure V3 — Lead Distribution DaaS

Governed access to curated lead data products. Preview-without-ownership model with admin-controlled CSV upload pipeline.

## Setup (8 Steps)

### Step 1: Create Supabase Project
Go to [supabase.com](https://supabase.com) → New Project. Wait ~60 seconds for provisioning.

### Step 2: Run Database Setup SQL
SQL Editor → New query → paste `supabase/DATABASE_SETUP.sql` → Run.

### Step 3: Run Admin Upload SQL
SQL Editor → New query → paste `supabase/ADMIN_UPLOAD_SETUP.sql` → Run.
(This adds the upload_batches, staging tables, and all 4 RPCs.)

### Step 4: Run UI Support Views SQL
SQL Editor → New query → paste `supabase/UI_SUPPORT_VIEWS.sql` → Run.

### Step 5: Configure Auth
Authentication → Providers → Email enabled.
Disable "Confirm email" for instant access (recommended for demos).

### Step 6: Get Supabase Credentials
Settings → API → copy Project URL and anon public key.

### Step 7: Create GitHub Repo + Deploy to Vercel
1. github.com/new → private repo `verifiedmeasure-v3-daas`
2. Upload all files from this ZIP
3. vercel.com/new → import repo → set env vars:
   ```
   NEXT_PUBLIC_SUPABASE_URL = your_project_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY = your_anon_key
   ```
4. Deploy

### Step 8: Create Admin Account + Seed Credits
1. Sign up on your deployed app
2. In Supabase SQL Editor:
```sql
-- Grant admin role
UPDATE public.user_profiles
SET role = 'admin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'your@email.com');

-- Add starting credits
INSERT INTO public.credit_ledger (user_id, delta, reason)
SELECT id, 300, 'initial_grant'
FROM auth.users WHERE email = 'your@email.com';
```
3. Refresh → you'll see 300 tokens, full lead pool, and Admin Upload tab

---

## Admin Upload Workflow

1. **Nav → Admin Upload** (visible to admin role only)
2. **Drop or select a CSV** — flexible column mapping supports any of:
   - `name / full_contact_name / full_name`
   - `email / validated_corporate_email / corporate_email`
   - `phone / phone_number`
   - `company / company_name / organization`
   - `website / url`
   - `state / st`
   - `title / title_role / job_title`
   - `regulation_type / regulation / filing_type`
   - `filing_date / date`
   - `sec_filing_url / filing_url`
3. **Preview** — see parsed rows before upload
4. **Upload to Staging** — rows go to `lead_upload_staging` (no production impact yet)
5. **Validate** — flags missing email/company, malformed emails
6. **Approve & Merge** — dedupes by (email, company) and inserts into `public.leads`
7. Leads immediately appear in the Lead Browser for all users

---

## Architecture

```
app/
├── page.tsx                          # Auth
├── dashboard/
│   ├── page.tsx                      # Lead Distribution
│   └── admin/
│       └── page.tsx                  # Admin CSV Upload
├── api/
│   ├── leads/download/route.ts
│   ├── ledger/export/route.ts
│   ├── profile/business-rule/route.ts
│   └── admin/grant/route.ts
supabase/
├── DATABASE_SETUP.sql                # Core schema + seed data
├── ADMIN_UPLOAD_SETUP.sql            # Upload pipeline (run 2nd)
└── UI_SUPPORT_VIEWS.sql              # Dashboard views (run 3rd)
```

## Security Model
- No service-role key at runtime
- RLS on every table
- Admin upload RPCs enforce `is_admin()` — non-admins cannot touch staging
- Dedupe enforced at DB level via UNIQUE(email, company)
- Credit ledger append-only; no UPDATE/DELETE
