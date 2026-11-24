import {
  AI_CONSENT_REQUIRED,
  AI_CONSENT_VERSION,
  consentStateFromFetch,
  consentWrite,
  hasAiConsent,
  isAiConsentRequiredError,
  isMissingConsentColumnError,
  resolveNeedsAiConsent,
  type AiConsentState,
} from '@/src/ai/aiConsent';
import {
  __resetAiConsentGateForTests,
  isAiConsentDeclinedError,
  isAiConsentGranted,
  registerAiConsentGate,
  requestAiConsent,
  requireAiConsent,
} from '@/src/ai/aiConsentGate';

const loaded = (at: string | null, version: string | null): AiConsentState => ({ kind: 'loaded', record: { at, version } });
const NOW = '2026-11-23T12:00:00.000Z';

describe('hasAiConsent', () => {
  test('granted only with a time AND the current version', () => {
    expect(hasAiConsent(loaded(NOW, AI_CONSENT_VERSION))).toBe(true);
    expect(hasAiConsent(loaded(null, AI_CONSENT_VERSION))).toBe(false); // Not now / withdrawn
    expect(hasAiConsent(loaded(null, null))).toBe(false); // never asked (every existing user)
    expect(hasAiConsent(loaded(NOW, 'older-version'))).toBe(false); // the text changed: ask again
  });
  test('unknown is not consent; unavailable (§89 not run) keeps the old behavior', () => {
    expect(hasAiConsent({ kind: 'unknown' })).toBe(false);
    expect(hasAiConsent({ kind: 'unavailable' })).toBe(true);
  });
});

describe('resolveNeedsAiConsent (first-launch gate, after ToS)', () => {
  const base = { hasSession: true, needsTos: false };
  test('existing user who was never asked sees it once', () => {
    expect(resolveNeedsAiConsent({ ...base, state: loaded(null, null) })).toBe(true);
  });
  test('answered for this version (Allow or Not now): not shown again', () => {
    expect(resolveNeedsAiConsent({ ...base, state: loaded(NOW, AI_CONSENT_VERSION) })).toBe(false);
    expect(resolveNeedsAiConsent({ ...base, state: loaded(null, AI_CONSENT_VERSION) })).toBe(false);
  });
  test('a new consent version asks again', () => {
    expect(resolveNeedsAiConsent({ ...base, state: loaded(NOW, AI_CONSENT_VERSION), currentVersion: 'next' })).toBe(true);
  });
  test('never before ToS, never without a session', () => {
    expect(resolveNeedsAiConsent({ hasSession: true, needsTos: true, state: loaded(null, null) })).toBe(false);
    expect(resolveNeedsAiConsent({ hasSession: false, needsTos: false, state: loaded(null, null) })).toBe(false);
  });
  test('unknown defaults to SHOW; unavailable never shows', () => {
    expect(resolveNeedsAiConsent({ ...base, state: { kind: 'unknown' } })).toBe(true);
    expect(resolveNeedsAiConsent({ ...base, state: { kind: 'unavailable' } })).toBe(false);
  });
});

describe('consentWrite', () => {
  test('Allow writes the time and the version', () => {
    expect(consentWrite(true, NOW)).toEqual({ ai_consent_at: NOW, ai_consent_version: AI_CONSENT_VERSION });
  });
  test('Not now / withdraw clears the time but records the version (no re-ask)', () => {
    const w = consentWrite(false, NOW);
    expect(w).toEqual({ ai_consent_at: null, ai_consent_version: AI_CONSENT_VERSION });
    expect(hasAiConsent(loaded(w.ai_consent_at, w.ai_consent_version))).toBe(false);
    expect(resolveNeedsAiConsent({ hasSession: true, needsTos: false, state: loaded(w.ai_consent_at, w.ai_consent_version) })).toBe(false);
  });
});

describe('consentStateFromFetch', () => {
  test('timeout -> unknown; other error -> unknown', () => {
    expect(consentStateFromFetch(null)).toEqual({ kind: 'unknown' });
    expect(consentStateFromFetch({ data: null, error: { code: '08006', message: 'connection failure' } })).toEqual({ kind: 'unknown' });
  });
  test('missing column (§89 not run) -> unavailable', () => {
    expect(consentStateFromFetch({ data: null, error: { code: '42703', message: 'column profiles.ai_consent_at does not exist' } })).toEqual({ kind: 'unavailable' });
    expect(consentStateFromFetch({ data: null, error: { code: 'PGRST204', message: 'x' } })).toEqual({ kind: 'unavailable' });
    expect(isMissingConsentColumnError({ message: "Could not find the 'ai_consent_version' column" })).toBe(true);
    expect(isMissingConsentColumnError(null)).toBe(false);
  });
  test('no profiles row yet -> never asked', () => {
    expect(consentStateFromFetch({ data: null, error: null })).toEqual(loaded(null, null));
  });
  test('row -> loaded record', () => {
    expect(consentStateFromFetch({ data: { ai_consent_at: NOW, ai_consent_version: AI_CONSENT_VERSION }, error: null })).toEqual(loaded(NOW, AI_CONSENT_VERSION));
  });
});

test('isAiConsentRequiredError matches the server error type only', () => {
  expect(isAiConsentRequiredError({ type: AI_CONSENT_REQUIRED })).toBe(true);
  expect(isAiConsentRequiredError({ type: 'rate_limited' })).toBe(false);
  expect(isAiConsentRequiredError(undefined)).toBe(false);
});

describe('aiConsentGate registry', () => {
  afterEach(() => __resetAiConsentGateForTests());

  test('fails closed with no provider registered', async () => {
    expect(isAiConsentGranted()).toBe(false);
    await expect(requestAiConsent()).resolves.toBe(false);
  });

  test('granted: no sheet is opened', async () => {
    const prompt = jest.fn(async () => true);
    registerAiConsentGate({ isGranted: () => true, prompt });
    await expect(requestAiConsent()).resolves.toBe(true);
    expect(prompt).not.toHaveBeenCalled();
  });

  test('not granted: the sheet decides; parallel callers share one sheet', async () => {
    let answer: (v: boolean) => void = () => {};
    const prompt = jest.fn(() => new Promise<boolean>((r) => (answer = r)));
    registerAiConsentGate({ isGranted: () => false, prompt });
    const a = requestAiConsent();
    const b = requestAiConsent();
    answer(true);
    await expect(Promise.all([a, b])).resolves.toEqual([true, true]);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(isAiConsentGranted()).toBe(false); // the silent check never prompts
  });

  test('requireAiConsent throws a declined error with the given message', async () => {
    registerAiConsentGate({ isGranted: () => false, prompt: async () => false });
    const err = await requireAiConsent('AI features are off.').catch((e) => e);
    expect(isAiConsentDeclinedError(err)).toBe(true);
    expect((err as Error).message).toBe('AI features are off.');
  });

  test('unregistering only removes the same gate', () => {
    const first = registerAiConsentGate({ isGranted: () => true, prompt: async () => true });
    registerAiConsentGate({ isGranted: () => true, prompt: async () => true });
    first();
    expect(isAiConsentGranted()).toBe(true);
  });
});
