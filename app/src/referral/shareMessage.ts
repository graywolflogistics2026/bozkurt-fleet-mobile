// REFERRAL PROGRAM — SHARE MESSAGE (owner decision 2026-08-24, item R4):
// a short, pre-written invite message in the user's own language. Pure
// string composition (no i18n library call inside — the caller passes
// already-translated `body`/`brand` strings so this stays trivially
// testable without a real i18n instance).
export function buildReferralShareMessage(params: { code: string; body: string; deepLink: string }): string {
  return `${params.body}\n\n${params.code}\n${params.deepLink}`;
}
