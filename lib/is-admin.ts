import type { SupabaseClient } from '@supabase/supabase-js';

export interface AdminCheckResult {
  isAdmin: boolean;
  userId: string | null;
}

export async function checkIsAdmin(supabase: SupabaseClient): Promise<AdminCheckResult> {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { isAdmin: false, userId: null };

  const { data, error } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (error || !data) return { isAdmin: false, userId: user.id };
  const profile = data as { role: string };
  return { isAdmin: profile.role === 'admin', userId: user.id };
}

export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}
