// COST CONTROL & GRACEFUL DEGRADATION (owner decision 2026-08-24, FIVE
// ADDITIONS pass, PART 4 item 2) — "FRIENDLY MESSAGING per failure type,
// never a raw error." Pure classification only; the actual localized
// copy lives in i18n (`importScreen.friendlyFailure.*`), read by whichever
// screen calls this (app/(tabs)/import/index.tsx today) — this module
// never returns hardcoded English text itself (CLAUDE.md invariant #11).
export type FriendlyFailureCategory = 'billingAuth' | 'rateLimit' | 'timeoutOverload' | 'offline';

// Maps the existing AiImportError.type values (src/data/aiImportCall.ts)
// onto the 4 buckets the spec names explicitly. Types NOT in this map
// (model_refusal, parse_failed, bad_request, unauthenticated) keep their
// own existing, already-specific/actionable messages
// (friendlyAiImportError()) — this classifier only covers the 4 the spec
// asks to unify.
export function classifyAiImportFailureCategory(errorType: string): FriendlyFailureCategory | null {
  switch (errorType) {
    // A billing/auth-shaped problem on the AI provider's own side (a
    // missing/invalid ANTHROPIC_API_KEY, a non-2xx Anthropic response) —
    // ai-import's own 'anthropic_error' type already covers exactly this.
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
