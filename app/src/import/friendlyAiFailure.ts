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
export type FriendlyFailureCategory = 'billingAuth' | 'rateLimit' | 'timeoutOverload' | 'oversized' | 'invalidDocument' | 'internal' | 'offline';

// Maps AiImportError.type values (src/data/aiImportCall.ts) onto the 7
// buckets above. Types NOT in this map (bad_request, unauthenticated,
// usage_limit_reached) keep their own existing, already-specific/
// dedicated UI (usage_limit_reached shows real used/allowance figures;
// bad_request/unauthenticated are the app's own request-shape/session
// errors, not AI-service failures) — this classifier only covers
// AI-service-failure-shaped codes.
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
    default:
      return null;
  }
}
