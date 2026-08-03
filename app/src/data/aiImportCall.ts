import { supabase } from '@/src/lib/supabase';
import { sanitizeExtractionDates } from '@/src/import/dateGuard';
import { sanitizeExtractionMiles } from '@/src/import/milesGuard';
import type { Extraction } from '@/src/import/types';

export type AiImportError = { type: string; message: string; detail?: string };
// pagesProcessed (owner decision 2026-08-03, "still failing after
// chunking" fix): present only when ai-import didn't cover every page of
// the original document — either because it was deliberately capped at
// SETTLEMENT_MAX_PAGES (index.ts) or because a later page failed after
// earlier ones succeeded. The import screen turns this into a plain
// "imported pages 1-N of M" banner instead of silently showing a result
// that looks complete when it isn't.
export type AiImportCallResult = {
  data?: Extraction;
  error?: AiImportError;
  pagesProcessed?: { through: number; total: number };
};

// CLIENT-SIDE TIMEOUT (owner decision 2026-08-02, raised again 2026-08-03
// per explicit device evidence that real settlements were STILL timing
// out — "raise per-call to 90s server-side and 240s client-side"). Sized
// against ai-import's own documented worst-case wall-clock budgets
// (supabase/functions/ai-import/index.ts's TIMEOUT/PAGE-BUDGET comment):
// the sequential 3-page path tops out around 123s server-side, well
// under this 240s client budget — the large gap is deliberate headroom
// for real-world network variance on top of the server's own (already
// Supabase-150s-ceiling-bounded) processing time, not a sign the server
// itself is expected to take anywhere near 240s. IMAGE_CLIENT_TIMEOUT_MS
// stays shorter, per the same report ("keep a shorter one for single
// images") — images are always a single IMAGE_TIMEOUT_MS(90s) call,
// worst case ~91s with the one 5xx-only retry.
const PDF_CLIENT_TIMEOUT_MS = 240_000;
const IMAGE_CLIENT_TIMEOUT_MS = 120_000;

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
// customCategories (owner decision 2026-07-10, PRODUCT DECISION — custom
// categories): the user's own active category names (both kinds), so
// classification can suggest one of THEM too instead of only ever
// matching the canonical taxonomy (docs/INDUSTRY_TAXONOMY.md §B).
export async function callAiImport(
  fileBase64: string,
  mediaType: string,
  docHint?: string,
  locale?: string,
  customCategories?: string[]
): Promise<AiImportCallResult> {
  const timeout = mediaType.startsWith('image/') ? IMAGE_CLIENT_TIMEOUT_MS : PDF_CLIENT_TIMEOUT_MS;
  const { data, error } = await supabase.functions.invoke('ai-import', {
    body: { fileBase64, mediaType, docHint, locale, customCategories },
    timeout,
  });

  if (error) {
    const ctx = (error as { context?: unknown }).context;
    // A client-side timeout (this function's own `timeout` option above)
    // aborts the underlying fetch and surfaces as a FunctionsFetchError
    // whose `context` is the raw AbortError/DOMException, NOT a Response
    // — must be checked before the ctx.json() Response path below, which
    // would otherwise just silently fall through to the generic
    // 'network_error' message and lose the "this was a timeout, not a
    // connectivity problem" distinction.
    if (ctx && typeof ctx === 'object' && (ctx as { name?: string }).name === 'AbortError') {
      return {
        error: {
          type: 'timeout',
          message: 'The AI service took too long to respond — try again, or split a multi-page document into fewer pages.',
        },
      };
    }
    if (ctx instanceof Response) {
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
  const extraction = data?.data as Extraction | undefined;
  if (!extraction) return { data: extraction };
  // DATE HARDENING round 2 (2026-07-30) — see src/import/dateGuard.ts.
  // MILES TRAP (owner decision 2026-08-02) — see src/import/milesGuard.ts.
  // Both applied once, right here, so every downstream consumer
  // (mapExtraction mappers, the import preview screen) automatically sees
  // the corrected date/miles without needing its own fix.
  const pagesProcessed = data?.pagesProcessed as { through: number; total: number } | undefined;
  return {
    data: sanitizeExtractionMiles(sanitizeExtractionDates(extraction)),
    ...(pagesProcessed ? { pagesProcessed } : {}),
  };
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
    // "settlement imports failing frequently" audit (owner decision
    // 2026-08-02): 'truncated'/'timeout' both carry their own specific,
    // actionable message from ai-import (see supabase/functions/ai-import/
    // index.ts) — prefer it over a generic fallback, same pattern as
    // 'bad_request' below.
    case 'truncated':
      return err.message || 'This document was too complex for the AI to fully process. Try splitting it into fewer pages.';
    case 'timeout':
      return err.message || 'The AI service took too long to respond. Try again.';
    case 'unauthenticated':
      return 'Your session expired — sign out and back in, then try again.';
    case 'bad_request':
      // PDF/file size guard (owner decision 2026-08-02): ai-import returns
      // a specific, user-friendly message for an oversized file — prefer
      // it over the generic fallback whenever the server provided one.
      return err.message || 'This file could not be sent for processing.';
    case 'anthropic_error':
      return 'The import service had a problem. Try again in a moment.';
    case 'network_error':
      return err.message;
    default:
      return err.message || 'Import failed.';
  }
}

// RICH IMPORT ERROR REPORTING (owner decision 2026-08-02): the "Copy
// Details" report for an AI-extraction failure (as opposed to a SAVE
// failure — see saveExtractionError.ts's buildErrorReport() for that
// side) — same shared shape (build line, failed step, error
// type/message/detail) so a device bug report always looks the same
// regardless of which half of the import pipeline failed.
export function buildAiImportErrorReport(err: AiImportError, buildLine: string): string {
  return [
    `Build: ${buildLine}`,
    `Failed step: AI processing (${err.type})`,
    `Error: ${err.message}`,
    err.detail ? `Detail: ${err.detail}` : null,
  ]
    .filter((line): line is string => line != null)
    .join('\n');
}
