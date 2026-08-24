import { supabase } from '@/src/lib/supabase';

export type ReferralSyncResult = { success: boolean; error?: string };

// Calls the referral-sync Edge Function (supabase/functions/referral-sync)
// — same invoke/error-unwrap pattern as callDeleteAccount()/callAiAdvisor().
// Evaluates whether the CALLER's own incoming referral has newly qualified
// and, if so, grants credits (their own 14-day welcome credit, and the
// referrer's 60-day reward if a new multiple-of-3 threshold was crossed).
// Safe to call opportunistically/repeatedly — a no-op once already
// resolved (see the Edge Function's own header comment on the lazy
// trigger model).
export async function callReferralSync(): Promise<ReferralSyncResult> {
  const { data, error } = await supabase.functions.invoke('referral-sync', { body: {} });

  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx) {
      try {
        const body = await ctx.json();
        if (body?.error?.message) return { success: false, error: body.error.message as string };
      } catch {
        // fall through to the generic message below
      }
    }
    return { success: false, error: error.message || 'Could not reach the server.' };
  }

  if (data?.error) return { success: false, error: data.error.message as string };
  return { success: true };
}
