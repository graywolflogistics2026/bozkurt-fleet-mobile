import { supabase } from '@/src/lib/supabase';

export type ResetDataResult = { success: boolean; error?: string };

// Calls the reset-data Edge Function (supabase/functions/reset-data) —
// same invoke/error-unwrap pattern as callDeleteAccount(). The function
// derives the user to reset from the caller's own JWT; nothing user-
// identifying is sent in the request body.
export async function callResetData(): Promise<ResetDataResult> {
  const { data, error } = await supabase.functions.invoke('reset-data', { body: {} });

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
