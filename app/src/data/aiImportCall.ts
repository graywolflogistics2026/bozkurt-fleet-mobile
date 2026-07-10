import { supabase } from '@/src/lib/supabase';
import type { Extraction } from '@/src/import/types';

export type AiImportError = { type: string; message: string; detail?: string };
export type AiImportCallResult = { data?: Extraction; error?: AiImportError };

// Calls the ai-import Edge Function (supabase/functions/ai-import) with the
// signed-in user's JWT (supabase.functions.invoke attaches it automatically
// — docs/DEPLOY_FUNCTIONS.md). The function returns structured errors as
// { error: { type, message } } for expected failure modes (rate_limited,
// model_refusal, parse_failed, ...); supabase-js surfaces a non-2xx
// response as a FunctionsHttpError with the real body reachable via
// `error.context` (the raw Response) rather than in `data`.
// locale (owner decision 2026-07-10, PRODUCT DECISION — "AI in user's
// language"): the app's current i18n locale, forwarded so the model
// responds in that language for user-facing free-text fields (summary,
// descriptions) — standard financial terms (e.g. "per diem") may stay
// English regardless (see ai-import's prompt addition).
export async function callAiImport(
  fileBase64: string,
  mediaType: string,
  docHint?: string,
  locale?: string
): Promise<AiImportCallResult> {
  const { data, error } = await supabase.functions.invoke('ai-import', {
    body: { fileBase64, mediaType, docHint, locale },
  });

  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx) {
      try {
        const body = await ctx.json();
        if (body?.error) return { error: body.error as AiImportError };
      } catch {
        // fall through to the generic message below
      }
    }
    return { error: { type: 'network_error', message: error.message || 'Could not reach the import service.' } };
  }

  if (data?.error) return { error: data.error as AiImportError };
  return { data: data?.data as Extraction };
}

// User-facing message per structured error type (PROMPTS.md Session 6).
export function friendlyAiImportError(err: AiImportError): string {
  switch (err.type) {
    case 'rate_limited':
      return err.message;
    case 'model_refusal':
      return 'The AI declined to process this document. Try a clearer photo, or a different file.';
    case 'parse_failed':
      return 'Could not read structured data from this document — try retaking the photo with better lighting/focus.';
    case 'unauthenticated':
      return 'Your session expired — sign out and back in, then try again.';
    case 'bad_request':
      return 'This file could not be sent for processing.';
    case 'anthropic_error':
      return 'The import service had a problem. Try again in a moment.';
    case 'network_error':
      return err.message;
    default:
      return err.message || 'Import failed.';
  }
}
