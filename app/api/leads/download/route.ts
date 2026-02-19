import { NextRequest, NextResponse } from 'next/server';
import { createServerClientWithToken, extractBearerToken } from '@/lib/supabase-server';
import { rowsToCSV } from '@/lib/csv';

export async function POST(req: NextRequest) {
  const token = extractBearerToken(req.headers.get('Authorization'));
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServerClientWithToken(token);

  // Validate user
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let ids: string[];
  try {
    const body = await req.json();
    ids = body.ids;
    if (!Array.isArray(ids) || ids.length === 0) throw new Error('invalid');
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Call RPC to unlock (grants entitlement + debits credits for new only)
  const { data: unlockData, error: unlockErr } = await supabase.rpc('unlock_records_secure', {
    p_dataset: 'leads',
    p_record_ids: ids,
  });

  if (unlockErr) {
    return NextResponse.json({ error: unlockErr.message }, { status: 400 });
  }

  // Fetch entitled rows (only ones this user has access to)
  const { data: accessRows, error: accessErr } = await supabase
    .from('dataset_access')
    .select('record_id')
    .eq('user_id', user.id)
    .eq('dataset', 'leads')
    .in('record_id', ids);

  if (accessErr) return NextResponse.json({ error: 'Failed to fetch entitlements' }, { status: 500 });

  const entitledIds = (accessRows ?? []).map((r: { record_id: string }) => r.record_id);
  if (entitledIds.length === 0) {
    return NextResponse.json({ error: 'No entitled records found' }, { status: 400 });
  }

  // Fetch full lead data for entitled rows
  const { data: leadsData, error: leadsErr } = await supabase
    .from('leads')
    .select('id, company, contact_name, contact_title, email, phone, website, industry, state, city, stage, workflow, intelligence_score, is_premium, created_at')
    .in('id', entitledIds);

  if (leadsErr) return NextResponse.json({ error: 'Failed to fetch leads' }, { status: 500 });

  const csv = rowsToCSV(leadsData ?? [], [
    'id', 'company', 'contact_name', 'contact_title', 'email', 'phone',
    'website', 'industry', 'state', 'city', 'stage', 'workflow',
    'intelligence_score', 'is_premium', 'created_at',
  ]);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="verifiedmeasure-leads-${Date.now()}.csv"`,
    },
  });
}
