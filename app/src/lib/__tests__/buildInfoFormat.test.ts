import { shorten, formatBuildInfoLine, type BuildInfo } from '@/src/lib/buildInfoFormat';

function info(overrides: Partial<BuildInfo> = {}): BuildInfo {
  return {
    version: '1.0.0',
    updateId: null,
    updateIdShort: null,
    channel: null,
    gitCommitHash: null,
    gitCommitHashShort: null,
    isEmbeddedLaunch: true,
    ...overrides,
  };
}

describe('shorten', () => {
  it('returns null for null/undefined', () => {
    expect(shorten(null)).toBeNull();
    expect(shorten(undefined)).toBeNull();
  });

  it('truncates to the default length of 8', () => {
    expect(shorten('abcdefghijklmnop')).toBe('abcdefgh');
  });

  it('respects a custom length', () => {
    expect(shorten('abcdefghijklmnop', 7)).toBe('abcdefg');
  });

  it('returns the string unchanged when shorter than the limit', () => {
    expect(shorten('abc')).toBe('abc');
  });
});

describe('formatBuildInfoLine (RUNTIME VISIBILITY, owner decision 2026-07-30)', () => {
  it('shows "embedded build" when there is no OTA update id', () => {
    expect(formatBuildInfoLine(info({ version: '1.0.0' }))).toBe('v1.0.0 · embedded build (no OTA update)');
  });

  it('shows the short update id when an OTA update is running', () => {
    expect(formatBuildInfoLine(info({ version: '1.0.0', updateIdShort: 'abcd1234' }))).toBe('v1.0.0 · update abcd1234');
  });

  it('appends the commit hash when available', () => {
    expect(
      formatBuildInfoLine(info({ version: '1.0.0', updateIdShort: 'abcd1234', gitCommitHashShort: 'a1b2c3d' }))
    ).toBe('v1.0.0 · update abcd1234 · commit a1b2c3d');
  });

  it('omits the commit segment entirely when unavailable (never shows a blank/placeholder segment)', () => {
    const line = formatBuildInfoLine(info({ version: '1.0.0', updateIdShort: 'abcd1234', gitCommitHashShort: null }));
    expect(line).not.toContain('commit');
  });
});
