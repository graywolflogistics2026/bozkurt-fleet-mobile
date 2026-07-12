import { supabase } from '@/src/lib/supabase';

export type DeleteAccountResult = { success: boolean; error?: string };

// Calls the delete-account Edge Function (supabase/functions/delete-
// account) — same invoke/error-unwrap pattern as callAiAdvisor(). The
// function derives the user to delete from the caller's own JWT; nothing
// user-identifying is sent in the request body.
export async function callDeleteAccount(): Promise<DeleteAccountResult> {
  const { data, error } = await supabase.functions.invoke('delete-account', { body: {} });

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
