import { NextRequest, NextResponse } from 'next/server';
import { createServerClientWithToken, extractBearerToken } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const token = extractBearerToken(req.headers.get('Authorization'));
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServerClientWithToken(token);

  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let business_rule: string;
  try {
    const body = await req.json();
    business_rule = body.business_rule;
    if (!['hybrid', 'exclusive_only'].includes(business_rule)) throw new Error('invalid');
  } catch {
    return NextResponse.json({ error: 'Invalid business_rule value' }, { status: 400 });
  }

  const { error } = await supabase
    .from('user_profiles')
    .update({ business_rule })
    .eq('id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, business_rule });
}
