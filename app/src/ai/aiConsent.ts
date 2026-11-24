// AI CONSENT (owner decision 2026-11-23, App Store guideline 5.1.2(i);
// docs/decisions/ai-consent-proposal.md, docs/PENDING_SQL.md §89). Pure
// rules only — no React, no Supabase — so every branch is unit-tested
// (src/ai/__tests__/aiConsent.test.ts).
//
// One consent for every AI feature. Stored on profiles:
//   ai_consent_at       when the user tapped Allow; null = not allowed
//   ai_consent_version  the consent text version the user last answered
//                       (Allow OR Not now); null = never asked
// Granted = ai_consent_at set AND ai_consent_version is the current
// version. Bumping AI_CONSENT_VERSION (a change to what is sent or to whom)
// asks every user again.

export const AI_CONSENT_VERSION = '2026-11-23';

// The error type ai-import and ai-advisor return when the caller has no
// consent (server check, owner decision 4).
export const AI_CONSENT_REQUIRED = 'ai_consent_required';

export type AiConsentRecord = { at: string | null; version: string | null };

export type AiConsentState =
  // Not read yet, or the read failed (offline, timeout). Unknown defaults
  // to SHOW the gate, same rule as every other gate (src/auth/profileGates.ts).
  | { kind: 'unknown' }
  // The two columns do not exist yet (§89 not run). The server check is not
  // deployed before §89 either (ship order), so the app behaves as before:
  // no gate, AI allowed.
  | { kind: 'unavailable' }
  | { kind: 'loaded'; record: AiConsentRecord };

export function hasAiConsent(state: AiConsentState, currentVersion: string = AI_CONSENT_VERSION): boolean {
  if (state.kind === 'unavailable') return true;
  if (state.kind === 'unknown') return false;
  return state.record.at != null && state.record.version === currentVersion;
}

// The first-launch gate: after ToS, before the tutorial. Shown once per
// consent version, whatever the answer was.
export function resolveNeedsAiConsent(input: {
  hasSession: boolean;
  needsTos: boolean;
  state: AiConsentState;
  currentVersion?: string;
}): boolean {
  if (!input.hasSession || input.needsTos) return false;
  if (input.state.kind === 'unavailable') return false;
  if (input.state.kind === 'unknown') return true;
  return input.state.record.version !== (input.currentVersion ?? AI_CONSENT_VERSION);
}

// What one answer writes. Not now and Settings > Privacy "off" both clear
// ai_consent_at but still record the version, so the gate does not ask again.
export function consentWrite(
  allow: boolean,
  nowIso: string,
  currentVersion: string = AI_CONSENT_VERSION
): { ai_consent_at: string | null; ai_consent_version: string } {
  return { ai_consent_at: allow ? nowIso : null, ai_consent_version: currentVersion };
}

type PostgrestLikeError = { code?: string | null; message?: string | null } | null | undefined;

// Postgres "undefined column" (42703) or PostgREST's schema-cache miss
// (PGRST204), or any message naming one of the two columns.
export function isMissingConsentColumnError(err: PostgrestLikeError): boolean {
  if (!err) return false;
  if (err.code === '42703' || err.code === 'PGRST204') return true;
  return /ai_consent_(at|version)/.test(err.message ?? '');
}

// The result of `select ai_consent_at, ai_consent_version` (null = the read
// timed out).
export function consentStateFromFetch(
  result: { data: { ai_consent_at?: string | null; ai_consent_version?: string | null } | null; error: PostgrestLikeError } | null
): AiConsentState {
  if (!result) return { kind: 'unknown' };
  if (result.error) return isMissingConsentColumnError(result.error) ? { kind: 'unavailable' } : { kind: 'unknown' };
  // No profiles row yet (sign-up trigger race): never asked.
  if (!result.data) return { kind: 'loaded', record: { at: null, version: null } };
  return { kind: 'loaded', record: { at: result.data.ai_consent_at ?? null, version: result.data.ai_consent_version ?? null } };
}

export function isAiConsentRequiredError(err: { type?: string | null } | null | undefined): boolean {
  return err?.type === AI_CONSENT_REQUIRED;
}
