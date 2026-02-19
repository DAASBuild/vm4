import { NextRequest, NextResponse } from 'next/server';
import { createServerClientWithToken, extractBearerToken } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const token = extractBearerToken(req.headers.get('Authorization'));
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServerClientWithToken(token);

  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let amount: number;
  let reason: string;
  let targetUserId: string;

  try {
    const body = await req.json();
    amount = Number(body.amount);
    reason = body.reason ?? 'admin_grant';
    targetUserId = body.user_id ?? user.id;
    if (!amount || amount === 0) throw new Error('invalid amount');
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Calls the SECURITY DEFINER RPC which validates is_admin() internally
  const { error } = await supabase.rpc('admin_grant_credits', {
    p_user_id: targetUserId,
    p_amount: amount,
    p_reason: reason,
    p_meta: {},
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, amount, reason });
}
