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

  test('every other type falls through to null (keeps its own existing message)', () => {
    for (const type of ['bad_request', 'unauthenticated', 'usage_limit_reached']) {
      expect(classifyAiImportFailureCategory(type)).toBeNull();
    }
  });
});
