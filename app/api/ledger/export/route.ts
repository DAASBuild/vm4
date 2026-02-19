import { NextRequest, NextResponse } from 'next/server';
import { createServerClientWithToken, extractBearerToken } from '@/lib/supabase-server';
import { rowsToCSV } from '@/lib/csv';

export async function GET(req: NextRequest) {
  const token = extractBearerToken(req.headers.get('Authorization'));
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServerClientWithToken(token);

  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: rows, error } = await supabase
    .from('credit_ledger')
    .select('id, delta, reason, meta, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: 'Failed to fetch ledger' }, { status: 500 });

  const csv = rowsToCSV(
    (rows ?? []).map((r: { id: string; delta: number; reason: string; meta: Record<string, unknown>; created_at: string }) => ({
      ...r,
      meta: JSON.stringify(r.meta),
    })),
    ['id', 'delta', 'reason', 'meta', 'created_at']
  );

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="vm-credit-history.csv"',
    },
  });
}
