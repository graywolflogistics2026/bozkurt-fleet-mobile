import { supabase } from '@/src/lib/supabase';
import i18n from '@/src/i18n';
import { isAiConsentRequiredError } from '@/src/ai/aiConsent';
import { isAiConsentGranted, requestAiConsent } from '@/src/ai/aiConsentGate';

export type AiAdvisorError = { type: string; message: string; detail?: string };
export type AiAdvisorCallResult = { data?: string; error?: AiAdvisorError };

// AI CONSENT (owner decision 2026-11-23): the user said no — nothing was sent.
export const AI_CONSENT_DECLINED = 'consent_declined';

// Calls the ai-advisor Edge Function (supabase/functions/ai-advisor) —
// same invoke/error-unwrap pattern as callAiImport() (aiImportCall.ts).
// First app-side caller of this function (CLAUDE.md invariant #16's
// groundwork note: "no app screen calls it yet" — Profit Analysis v1,
// PROMPTS.md Session 9a item 11, is the first; the dedicated AI Advisor
// chat screen itself is still Session 9b). locale forwards i18n.language so
// the reply is written in the user's chosen app language per invariant #16.
//
// AI CONSENT (owner decision 2026-11-23, App Store 5.1.2(i)): nothing is
// sent without consent. `interactive` (default) opens the just-in-time
// sheet when consent is missing; `interactive: false` is for automatic work
// (the AI Coach weekly review on Home) and never opens a sheet — it just
// sends nothing, and the caller shows its non-AI fallback.
export async function callAiAdvisor(
  messages: { role: 'user' | 'assistant'; content: string }[],
  locale?: string,
  options: { interactive?: boolean } = {}
): Promise<AiAdvisorCallResult> {
  const allowed = options.interactive === false ? isAiConsentGranted() : await requestAiConsent();
  if (!allowed) return { error: { type: AI_CONSENT_DECLINED, message: i18n.t('aiConsent.declined') } };

  const { data, error } = await supabase.functions.invoke('ai-advisor', {
    body: { messages, locale },
  });

  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx) {
      try {
        const body = await ctx.json();
        if (body?.error) return { error: withConsentMessage(body.error as AiAdvisorError) };
      } catch {
        // fall through to the generic message below
      }
    }
    return { error: { type: 'network_error', message: error.message || 'Could not reach the advisor service.' } };
  }

  if (data?.error) return { error: withConsentMessage(data.error as AiAdvisorError) };
  return { data: data?.answer as string };
}

// The server refused for missing consent (e.g. turned off on another
// device): show the app's own words, in the app's language.
function withConsentMessage(err: AiAdvisorError): AiAdvisorError {
  return isAiConsentRequiredError(err) ? { ...err, message: i18n.t('aiConsent.serverRequired') } : err;
}
