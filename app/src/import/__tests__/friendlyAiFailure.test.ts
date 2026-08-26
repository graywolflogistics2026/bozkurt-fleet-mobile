import { classifyAiImportFailureCategory } from '@/src/import/friendlyAiFailure';

describe('classifyAiImportFailureCategory', () => {
  test('billing_exhausted -> billingAuth', () => {
    expect(classifyAiImportFailureCategory('billing_exhausted')).toBe('billingAuth');
  });

  test('anthropic_error (legacy fallback) -> billingAuth', () => {
    expect(classifyAiImportFailureCategory('anthropic_error')).toBe('billingAuth');
  });

  test('rate_limited -> rateLimit', () => {
    expect(classifyAiImportFailureCategory('rate_limited')).toBe('rateLimit');
  });

  test('timeout and truncated -> timeoutOverload', () => {
    expect(classifyAiImportFailureCategory('timeout')).toBe('timeoutOverload');
    expect(classifyAiImportFailureCategory('truncated')).toBe('timeoutOverload');
  });

  test('oversized -> oversized', () => {
    expect(classifyAiImportFailureCategory('oversized')).toBe('oversized');
  });

  test('model_refusal, parse_failed, invalid_document -> invalidDocument', () => {
    expect(classifyAiImportFailureCategory('model_refusal')).toBe('invalidDocument');
    expect(classifyAiImportFailureCategory('parse_failed')).toBe('invalidDocument');
    expect(classifyAiImportFailureCategory('invalid_document')).toBe('invalidDocument');
  });

  test('internal -> internal', () => {
    expect(classifyAiImportFailureCategory('internal')).toBe('internal');
  });

  test('network_error -> offline', () => {
    expect(classifyAiImportFailureCategory('network_error')).toBe('offline');
  });

  // P1 fix (FULL SYSTEM AUDIT): bad_request and unauthenticated used to
  // fall through to null here, which meant they fell all the way through
  // to friendlyAiImportError()'s plain, NEVER-TRANSLATED English strings —
  // the exact "still shows raw English" bug reported. Both are now real
  // entries in this map.
  test('unauthenticated -> sessionExpired (a distinct fix — sign in again — from every other bucket)', () => {
    expect(classifyAiImportFailureCategory('unauthenticated')).toBe('sessionExpired');
  });

  test('bad_request -> internal (every real bad_request message is an app-side bug, not something the user caused)', () => {
    expect(classifyAiImportFailureCategory('bad_request')).toBe('internal');
  });

  // usage_limit_reached is the one type deliberately left OUT of this map
  // — it keeps its own genuinely dedicated UI (real used/allowance
  // figures from the server), never a generic bucket message.
  test('usage_limit_reached (and any truly unrecognized type) falls through to null', () => {
    expect(classifyAiImportFailureCategory('usage_limit_reached')).toBeNull();
    expect(classifyAiImportFailureCategory('some_future_unmapped_type')).toBeNull();
  });
});
