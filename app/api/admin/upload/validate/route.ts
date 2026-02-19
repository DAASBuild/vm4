import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { extractBearerToken, checkIsAdmin } from '@/lib/is-admin';

export async function POST(req: NextRequest) {
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

  const body = await req.json() as { batchId?: string };
  if (!body.batchId) return NextResponse.json({ error: 'batchId required' }, { status: 400 });

  const { data, error } = await supabase.rpc('validate_lead_upload_batch', { p_batch_id: body.batchId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}
