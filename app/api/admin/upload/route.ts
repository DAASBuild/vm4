import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { extractBearerToken, checkIsAdmin } from '@/lib/is-admin';

// ── CSV helpers ──────────────────────────────────────────────
function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { result.push(cur); cur = ''; }
    else { cur += c; }
  }
  result.push(cur);
  return result;
}

function parseCSVText(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(Boolean);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = splitCSVLine(lines[0]).map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const vals = splitCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (vals[i] ?? '').trim(); });
    return row;
  }).filter(r => Object.values(r).some(v => v));
  return { headers, rows };
}

// ── Exact header mapping per spec ───────────────────────────
interface StagingRow {
  full_contact_name: string | null;
  title_role: string | null;
  validated_corporate_email: string | null;
  phone_number: string | null;
  company_name: string | null;
  website: string | null;
  state: string | null;
  regulation_type: string | null;
  filing_date: string | null;
  sec_filing_url: string | null;
}

function mapRowToStaging(raw: Record<string, string>): StagingRow {
  const get = (key: string) => raw[key]?.trim() || null;
  const date = raw['Filing Date']?.trim();
  const parsedDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  return {
    full_contact_name:          get('Full Contact Name'),
    title_role:                 get('Title/Role'),
    validated_corporate_email:  get('Validated Corporate Email'),
    phone_number:               get('Phone Number'),   // keep raw per spec
    company_name:               get('Company Name'),
    website:                    get('Website'),
    state:                      get('State'),
    regulation_type:            get('Regulation Type'),
    filing_date:                parsedDate,
    sec_filing_url:             get('SEC Filing URL'),
  };
}

// ── Route handler ────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // 1) Auth
  const token = extractBearerToken(req.headers.get('authorization'));
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      cookies: { getAll: () => [], setAll: () => {} },
    }
  );

  const { isAdmin } = await checkIsAdmin(supabase);
  if (!isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // 2) Parse multipart
  const formData = await req.formData();
  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'no file uploaded' }, { status: 400 });
  }
  const csvFile = file as File;
  const text = await csvFile.text();
  const { rows } = parseCSVText(text);
  if (rows.length === 0) return NextResponse.json({ error: 'empty or invalid CSV' }, { status: 400 });

  const stagingRows = rows.map(mapRowToStaging);

  // 3) Create batch via RPC
  const { data: batchId, error: batchErr } = await supabase.rpc('create_lead_upload_batch', {
    p_filename: csvFile.name,
    p_total_rows: stagingRows.length,
  });
  if (batchErr || !batchId) {
    return NextResponse.json({ error: batchErr?.message ?? 'batch creation failed' }, { status: 500 });
  }

  // 4) Insert staging rows in chunks of 250
  const CHUNK = 250;
  let errorCount = 0;
  for (let i = 0; i < stagingRows.length; i += CHUNK) {
    const chunk = stagingRows.slice(i, i + CHUNK);
    for (const row of chunk) {
      const { error } = await supabase.rpc('insert_lead_upload_staging', {
        p_batch_id: batchId,
        p_full_contact_name: row.full_contact_name,
        p_title_role: row.title_role,
        p_validated_corporate_email: row.validated_corporate_email,
        p_phone_number: row.phone_number,
        p_company_name: row.company_name,
        p_website: row.website,
        p_state: row.state,
        p_regulation_type: row.regulation_type,
        p_filing_date: row.filing_date,
        p_sec_filing_url: row.sec_filing_url,
      });
      if (error) errorCount++;
    }
  }

  return NextResponse.json({ batch_id: batchId, total_rows: stagingRows.length, insert_errors: errorCount });
}
