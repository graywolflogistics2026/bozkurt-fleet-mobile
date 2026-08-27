import { buildActionEvent, buildScreenOpenEvent, normalizeScreenName, shouldTrack } from '@/src/analytics/usageTracking';

describe('buildScreenOpenEvent — screen events carry nothing beyond the bare fact', () => {
  test('produces a kind=screen row with no status, no financial content', () => {
    const now = new Date('2026-08-27T12:00:00Z');
    const event = buildScreenOpenEvent('user-1', '/(tabs)/more/loans', now);
    expect(event).toEqual({
      user_id: 'user-1',
      kind: 'screen',
      name: '/(tabs)/more/loans',
      status: null,
      created_at: '2026-08-27T12:00:00.000Z',
    });
  });

  test('normalizes the screen name through the same rule normalizeScreenName exports', () => {
    const event = buildScreenOpenEvent('user-1', '/(tabs)/more/loans/', new Date());
    expect(event.name).toBe('/(tabs)/more/loans');
  });
});

describe('buildActionEvent — action events always carry a real status', () => {
  test('started', () => {
    const now = new Date('2026-08-27T12:00:00Z');
    const event = buildActionEvent('user-1', 'document_import', 'started', now);
    expect(event).toEqual({
      user_id: 'user-1',
      kind: 'action',
      name: 'document_import',
      status: 'started',
      created_at: '2026-08-27T12:00:00.000Z',
    });
  });

  test('completed', () => {
    const event = buildActionEvent('user-1', 'document_import', 'completed', new Date('2026-08-27T12:05:00Z'));
    expect(event.status).toBe('completed');
  });
});

describe('shouldTrack — the client-side short-circuit', () => {
  test('tracks by default (opted-out is false, the column default)', () => {
    expect(shouldTrack(false)).toBe(true);
  });

  test('tracks when the profile has not loaded yet (null/undefined never blocks — the server-side RLS check is the real guarantee)', () => {
    expect(shouldTrack(null)).toBe(true);
    expect(shouldTrack(undefined)).toBe(true);
  });

  test('does not track once explicitly opted out', () => {
    expect(shouldTrack(true)).toBe(false);
  });
});

describe('normalizeScreenName — a route can never silently double-count under two spellings', () => {
  test('leaves the bare root alone', () => {
    expect(normalizeScreenName('/')).toBe('/');
  });

  test('strips a trailing slash on anything longer than the bare root', () => {
    expect(normalizeScreenName('/(tabs)/more/settings/')).toBe('/(tabs)/more/settings');
  });

  test('leaves an already-normalized path untouched', () => {
    expect(normalizeScreenName('/(tabs)/more/settings')).toBe('/(tabs)/more/settings');
  });

  test('falls back to the root for an empty string', () => {
    expect(normalizeScreenName('')).toBe('/');
  });
});
