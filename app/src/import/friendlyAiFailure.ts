// COST CONTROL & GRACEFUL DEGRADATION (owner decision 2026-08-24, FIVE
// ADDITIONS pass, PART 4 item 2; extended same-day "Edge Function
// returned a non-2xx status code" bug fix pass, item 2) — "FRIENDLY
// MESSAGING per failure type, never a raw error." Pure classification
// only; the actual localized copy lives in i18n
// (`importScreen.friendlyFailure.*`), read by whichever screen calls this
// (app/(tabs)/import/index.tsx today) — this module never returns
// hardcoded English text itself (CLAUDE.md invariant #11).
//
// Aligned with ai-import/index.ts's own 6-code machine taxonomy
// (billing_exhausted, rate_limited, timeout, oversized, invalid_document,
// internal) — every one of those 6 has its own bucket/copy here now,
// covering every failure surface the server can return, not just the
// original 4.
//
// STILL SHOWS RAW ENGLISH (P1 fix, FULL SYSTEM AUDIT): this file's own
// header comment used to claim bad_request/unauthenticated "keep their
// own existing, already-specific/dedicated UI" — that claim was simply
// wrong. Neither was ever in this map, so classifyAiImportFailureCategory()
// returned null for both, which falls through to
// friendlyAiImportError()'s (src/data/aiImportCall.ts) plain, HARDCODED
// English strings ('Your session expired — sign out and back in, then
// try again.' / 'This file could not be sent for processing.') — never
// routed through i18next's t(), unlike literally everything else in this
// app (CLAUDE.md invariant #11). Fixed by actually mapping both below.
export type FriendlyFailureCategory =
  | 'billingAuth'
  | 'rateLimit'
  | 'timeoutOverload'
  | 'oversized'
  | 'invalidDocument'
  | 'internal'
  | 'offline'
  | 'sessionExpired';

// Maps AiImportError.type values (src/data/aiImportCall.ts) onto the 8
// buckets above. usage_limit_reached is the one type deliberately NOT in
// this map — it keeps its own existing, genuinely dedicated UI (it shows
// real used/allowance figures from the server, which a generic bucket
// message can't).
export function classifyAiImportFailureCategory(errorType: string): FriendlyFailureCategory | null {
  switch (errorType) {
    case 'billing_exhausted':
      return 'billingAuth';
    // Legacy fallback (owner decision 2026-08-24) — 'anthropic_error' was
    // the OLD, less-specific code this pass split into billing_exhausted/
    // rate_limited/internal; kept mapped here only in case an in-flight
    // deploy still has an older ai-import version returning it for a
    // moment. New deploys never return it.
    case 'anthropic_error':
      return 'billingAuth';
    case 'rate_limited':
      return 'rateLimit';
    // Both a clean timeout and a token-ceiling truncation read to the user
    // as the same thing: "this is taking too long / is too much right
    // now" — same bucket, same message.
    case 'timeout':
    case 'truncated':
      return 'timeoutOverload';
    case 'oversized':
      return 'oversized';
    // The document itself couldn't be read/understood — a model refusal
    // or an unparseable response both read to the user as "we couldn't
    // read this document," regardless of which specific reason caused it.
    case 'model_refusal':
    case 'parse_failed':
    case 'invalid_document':
      return 'invalidDocument';
    case 'internal':
      return 'internal';
    // The client couldn't reach the function at all — from the user's own
    // perspective this and "I'm offline" are indistinguishable without a
    // dedicated connectivity check (not added — no new native dependency
    // for this pass, see CLAUDE.md's own precedent of deferring
    // expo-device/expo-application for the same reason).
    case 'network_error':
      return 'offline';
    // "Your session isn't valid" — a distinct fix (sign in again) from
    // every other bucket's "try again," so it gets its own message rather
    // than folding into 'internal'.
    case 'unauthenticated':
      return 'sessionExpired';
    // Every bad_request message ai-import actually returns is an
    // app-side request-shape bug ("retryJobId is required," "Only POST is
    // supported," "Request body must be valid JSON") — never something a
    // real user action causes or can fix themselves, so the generic
    // "something went wrong, try again" bucket is the right fit, not a
    // dedicated message explaining an internal validation detail.
    case 'bad_request':
      return 'internal';
    default:
      return null;
  }
}
