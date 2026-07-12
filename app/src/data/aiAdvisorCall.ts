import { supabase } from '@/src/lib/supabase';

export type AiAdvisorError = { type: string; message: string; detail?: string };
export type AiAdvisorCallResult = { data?: string; error?: AiAdvisorError };

// Calls the ai-advisor Edge Function (supabase/functions/ai-advisor) —
// same invoke/error-unwrap pattern as callAiImport() (aiImportCall.ts).
// First app-side caller of this function (CLAUDE.md invariant #16's
// groundwork note: "no app screen calls it yet" — Profit Analysis v1,
// PROMPTS.md Session 9a item 11, is the first; the dedicated AI Advisor
// chat screen itself is still Session 9b). locale forwards i18n.language so
// the reply is written in the user's chosen app language per invariant #16.
export async function callAiAdvisor(
  messages: { role: 'user' | 'assistant'; content: string }[],
  locale?: string
): Promise<AiAdvisorCallResult> {
  const { data, error } = await supabase.functions.invoke('ai-advisor', {
    body: { messages, locale },
  });

  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx) {
      try {
        const body = await ctx.json();
        if (body?.error) return { error: body.error as AiAdvisorError };
      } catch {
        // fall through to the generic message below
      }
    }
    return { error: { type: 'network_error', message: error.message || 'Could not reach the advisor service.' } };
  }

  if (data?.error) return { error: data.error as AiAdvisorError };
  return { data: data?.answer as string };
}
