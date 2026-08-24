import { classifyAiImportFailureCategory } from '@/src/import/friendlyAiFailure';

describe('classifyAiImportFailureCategory', () => {
  test('anthropic_error -> billingAuth', () => {
    expect(classifyAiImportFailureCategory('anthropic_error')).toBe('billingAuth');
  });

  test('rate_limited -> rateLimit', () => {
    expect(classifyAiImportFailureCategory('rate_limited')).toBe('rateLimit');
  });

  test('timeout and truncated -> timeoutOverload', () => {
    expect(classifyAiImportFailureCategory('timeout')).toBe('timeoutOverload');
    expect(classifyAiImportFailureCategory('truncated')).toBe('timeoutOverload');
  });

  test('network_error -> offline', () => {
    expect(classifyAiImportFailureCategory('network_error')).toBe('offline');
  });

  test('every other type falls through to null (keeps its own existing message)', () => {
    for (const type of ['model_refusal', 'parse_failed', 'bad_request', 'unauthenticated', 'usage_limit_reached']) {
      expect(classifyAiImportFailureCategory(type)).toBeNull();
    }
  });
});
