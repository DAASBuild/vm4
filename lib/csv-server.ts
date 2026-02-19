/**
 * Server-side CSV parser.
 * Handles Windows (\r\n), Unix (\n), and old Mac (\r) line endings.
 * Handles quoted fields with embedded commas and newlines.
 */

export interface ParsedCSVRow {
  full_contact_name: string | null;
  title_role: string | null;
  validated_corporate_email: string | null;
  phone_number: string | null;
  company_name: string | null;
  website: string | null;
  state: string | null;
  regulation_type: string | null;
  filing_date: string | null; // YYYY-MM-DD or null
  sec_filing_url: string | null;
}

function splitLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

function normaliseHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Maps normalised header → staging field name
const HEADER_MAP: Record<string, keyof ParsedCSVRow> = {
  // Full Contact Name
  full_contact_name: 'full_contact_name',
  contact_name: 'full_contact_name',
  full_name: 'full_contact_name',
  name: 'full_contact_name',

  // Title/Role
  title_role: 'title_role',
  title: 'title_role',
  role: 'title_role',
  contact_title: 'title_role',
  job_title: 'title_role',
  position: 'title_role',

  // Email
  validated_corporate_email: 'validated_corporate_email',
  corporate_email: 'validated_corporate_email',
  email: 'validated_corporate_email',
  work_email: 'validated_corporate_email',
  business_email: 'validated_corporate_email',

  // Phone
  phone_number: 'phone_number',
  phone: 'phone_number',
  mobile: 'phone_number',
  tel: 'phone_number',
  telephone: 'phone_number',

  // Company
  company_name: 'company_name',
  company: 'company_name',
  organization: 'company_name',
  organisation: 'company_name',
  firm: 'company_name',
  employer: 'company_name',

  // Website
  website: 'website',
  url: 'website',
  web: 'website',
  company_url: 'website',
  company_website: 'website',

  // State
  state: 'state',
  st: 'state',
  location_state: 'state',
  province: 'state',

  // Regulation Type
  regulation_type: 'regulation_type',
  regulation: 'regulation_type',
  filing_type: 'regulation_type',
  type: 'regulation_type',

  // Filing Date
  filing_date: 'filing_date',
  date: 'filing_date',
  filing_date_time: 'filing_date',

  // SEC URL
  sec_filing_url: 'sec_filing_url',
  sec_url: 'sec_filing_url',
  filing_url: 'sec_filing_url',
  source_url: 'sec_filing_url',
};

function normaliseFilingDate(raw: string): string | null {
  if (!raw || raw.trim() === '') return null;
  const s = raw.trim();
  // Accept YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Try parsing as Date and reformatting
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return null;
}

export function parseCSVBuffer(text: string): ParsedCSVRow[] {
  const normalised = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalised.split('\n').filter(l => l.trim() !== '');
  if (lines.length < 2) return [];

  const rawHeaders = splitLine(lines[0]);
  const headers = rawHeaders.map(normaliseHeader);

  // Build column index map
  const colMap: Partial<Record<keyof ParsedCSVRow, number>> = {};
  headers.forEach((h, i) => {
    const field = HEADER_MAP[h];
    if (field && colMap[field] === undefined) {
      colMap[field] = i;
    }
  });

  const rows: ParsedCSVRow[] = [];

  for (let li = 1; li < lines.length; li++) {
    const cols = splitLine(lines[li]);
    // Skip completely empty rows
    if (cols.every(c => c === '')) continue;

    const get = (field: keyof ParsedCSVRow): string | null => {
      const idx = colMap[field];
      if (idx === undefined) return null;
      const val = (cols[idx] ?? '').trim();
      return val === '' ? null : val;
    };

    rows.push({
      full_contact_name: get('full_contact_name'),
      title_role: get('title_role'),
      validated_corporate_email: get('validated_corporate_email'),
      phone_number: get('phone_number'),
      company_name: get('company_name'),
      website: get('website'),
      state: get('state'),
      regulation_type: get('regulation_type'),
      filing_date: normaliseFilingDate(get('filing_date') ?? ''),
      sec_filing_url: get('sec_filing_url'),
    });
  }

  return rows;
}
