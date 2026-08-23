import { supabase } from '@/src/lib/supabase';
import { sanitizeExtractionDates } from '@/src/import/dateGuard';
import { sanitizeExtractionMiles } from '@/src/import/milesGuard';
import type { Extraction } from '@/src/import/types';

export type AiImportError = { type: string; message: string; detail?: string };
// pagesProcessed (owner decision 2026-08-03, round 5): present only when
// ai-import didn't cover every page of the original document — one or
// more pages failed even after the server's own one non-fatal retry
// (there is no longer a deliberate page cap; see the CONTINUATION
// PROTOCOL comment below). `missingPages` lists the specific page
// numbers that couldn't be processed (gaps are possible — a missing
// middle page no longer stops later pages from being captured, round 4's
// "1 of 11" bug). The import screen turns this into a plain "imported
// N of M pages; pages X, Y couldn't be processed" banner instead of
// silently showing a result that looks complete when it isn't.
export type AiImportCallResult = {
  data?: Extraction;
  error?: AiImportError;
  pagesProcessed?: { total: number; missingPages: number[] };
};

// Raw server response shape for one ai-import invocation (before this
// module's own date/miles sanitizing and error normalization).
type AiImportInvokeResponse = {
  error?: AiImportError;
  data?: unknown;
  pagesProcessed?: { total: number; missingPages: number[] };
  nextPageStart?: number;
  rawPageExtractions?: { page: number; extraction: unknown }[];
  rawMissingPages?: number[];
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

// One call to the ai-import Edge Function (supabase/functions/ai-import)
// with the signed-in user's JWT (supabase.functions.invoke attaches it
// automatically — docs/DEPLOY_FUNCTIONS.md). Returns the raw response
// (before this module's date/miles sanitizing) or a normalized
// AiImportError — no looping/continuation logic here, that lives in
// callAiImport() below.
async function invokeAiImportOnce(
  fileBase64: string,
  mediaType: string,
  docHint: string | undefined,
  locale: string | undefined,
  customCategories: string[] | undefined,
  learningRules: { keyword: string; category: string }[] | undefined,
  pageRangeStart: number | undefined,
  priorPageExtractions: { page: number; extraction: unknown }[] | undefined,
  priorMissingPages: number[] | undefined,
): Promise<{ response?: AiImportInvokeResponse; error?: AiImportError }> {
  const timeout = mediaType.startsWith('image/') ? IMAGE_CLIENT_TIMEOUT_MS : PDF_CLIENT_TIMEOUT_MS;
  const { data, error } = await supabase.functions.invoke('ai-import', {
    body: { fileBase64, mediaType, docHint, locale, customCategories, learningRules, pageRangeStart, priorPageExtractions, priorMissingPages },
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
  return { response: data as AiImportInvokeResponse };
}

// CONTINUATION PROTOCOL (owner decision 2026-08-03, round 5 — a real
// 11-page settlement's deduction line items live well past page 3;
// capping extraction at a fixed page count silently produced a
// zero-expense, zero-net "settlement," a genuine tax-accuracy bug, not
// just an incomplete import). ai-import now processes a document PAGE BY
// PAGE in small batches (server-side PAGES_PER_BATCH, index.ts), and a
// single page's failure — even after the server's own one retry — no
// longer stops the whole document (round 4's "1 of 11" bug: a middle
// page timing out used to abort everything after it). A response
// carrying `nextPageStart` means there's more document left, so this
// function calls ai-import AGAIN, passing `pageRangeStart`/
// `priorPageExtractions`/`priorMissingPages` straight through,
// SEQUENTIALLY (one full round-trip at a time, never concurrent) until
// the whole document is covered. Every intermediate call's own client-
// side timeout (`invokeAiImportOnce`'s `timeout` option) still applies
// per round-trip — a long document just means more round-trips, not one
// single unbounded wait.
// onProgress (optional): called after every intermediate response with
// how much of the document has been ATTEMPTED so far (not necessarily
// all successful — some pages may be missing), so a caller can update a
// "still working — processing page N of M" style message instead of one
// static label for the whole multi-minute operation.
// locale/customCategories: see the original per-parameter comments below.
// learningRules (owner decision 2026-08-05, FULL PARITY follow-up item
// G): the user's own category_learning_rules, forwarded as plain
// prompt-context hints ("USER CORRECTIONS") — never used to fine-tune or
// retrain any model. See app/src/import/categoryLearning.ts.
export async function callAiImport(
  fileBase64: string,
  mediaType: string,
  docHint?: string,
  locale?: string,
  customCategories?: string[],
  learningRules?: { keyword: string; category: string }[],
  onProgress?: (progress: { through: number; total: number }) => void
): Promise<AiImportCallResult> {
  let pageRangeStart: number | undefined;
  let priorPageExtractions: { page: number; extraction: unknown }[] | undefined;
  let priorMissingPages: number[] | undefined;

  // Bounded the same way the server bounds itself (MAX_TOTAL_PAGES,
  // index.ts) — a defensive stop against an infinite client-side loop if
  // a future server bug ever returned nextPageStart forever.
  for (let round = 0; round < 60; round++) {
    console.log(`[ai-import client] round ${round + 1}: pageRangeStart=${pageRangeStart ?? 1}, priorCovered=${priorPageExtractions?.length ?? 0}, priorMissing=${priorMissingPages?.length ?? 0}`);
    const { response, error } = await invokeAiImportOnce(
      fileBase64,
      mediaType,
      docHint,
      locale,
      customCategories,
      learningRules,
      pageRangeStart,
      priorPageExtractions,
      priorMissingPages
    );
    if (error) {
      console.log(`[ai-import client] round ${round + 1} failed: ${error.type} — ${error.message}`);
      return { error };
    }

    if (response?.nextPageStart) {
      console.log(`[ai-import client] round ${round + 1} succeeded, continuing: nextPageStart=${response.nextPageStart}`);
      pageRangeStart = response.nextPageStart;
      priorPageExtractions = response.rawPageExtractions;
      priorMissingPages = response.rawMissingPages;
      if (onProgress) onProgress({ through: response.nextPageStart - 1, total: response.pagesProcessed?.total ?? response.nextPageStart });
      continue;
    }

    const extraction = response?.data as Extraction | undefined;
    if (!extraction) return { data: extraction };
    console.log(
      `[ai-import client] round ${round + 1}: complete${response?.pagesProcessed ? `, pagesProcessed=${JSON.stringify(response.pagesProcessed)}` : ''}`
    );
    // DATE HARDENING round 2 (2026-07-30) — see src/import/dateGuard.ts.
    // MILES TRAP (owner decision 2026-08-02) — see src/import/milesGuard.ts.
    // Both applied once, right here, so every downstream consumer
    // (mapExtraction mappers, the import preview screen) automatically
    // sees the corrected date/miles without needing its own fix.
    return {
      data: sanitizeExtractionMiles(sanitizeExtractionDates(extraction)),
      ...(response?.pagesProcessed ? { pagesProcessed: response.pagesProcessed } : {}),
    };
  }

  return {
    error: { type: 'anthropic_error', message: 'This document has too many pages to process — try splitting it into smaller files.' },
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
