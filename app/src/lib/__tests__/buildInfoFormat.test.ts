import { shorten, formatBuildInfoLine, type BuildInfo } from '@/src/lib/buildInfoFormat';

function info(overrides: Partial<BuildInfo> = {}): BuildInfo {
  return {
    version: '1.0.0',
    updateId: null,
    updateIdShort: null,
    channel: null,
    runtimeVersion: null,
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
    expect(formatBuildInfoLine(info({ version: '1.0.0' }))).toBe('v1.0.0 · embedded build (no OTA update) · channel none · runtime unknown');
  });

  it('shows the short update id when an OTA update is running', () => {
    expect(formatBuildInfoLine(info({ version: '1.0.0', updateIdShort: 'abcd1234' }))).toBe(
      'v1.0.0 · update abcd1234 · channel none · runtime unknown'
    );
  });

  it('appends the commit hash when available', () => {
    expect(
      formatBuildInfoLine(info({ version: '1.0.0', updateIdShort: 'abcd1234', gitCommitHashShort: 'a1b2c3d' }))
    ).toBe('v1.0.0 · update abcd1234 · commit a1b2c3d · channel none · runtime unknown');
  });

  it('omits the commit segment entirely when unavailable (never shows a blank/placeholder segment)', () => {
    const line = formatBuildInfoLine(info({ version: '1.0.0', updateIdShort: 'abcd1234', gitCommitHashShort: null }));
    expect(line).not.toContain('commit');
  });

  // CHANNEL + RUNTIME VERSION (owner decision, device report: "vunknown ·
  // embedded build (no OTA update)" gave no way to diagnose WHY no update
  // had ever reached the device). Unlike the commit segment, these are
  // ALWAYS shown — even absent — because their absence is itself the
  // decisive diagnostic signal (a null channel means this build can never
  // receive an OTA update at all, regardless of what's published).
  it('shows "channel none" and "runtime unknown" when neither is available (an embedded/dev-client build)', () => {
    const line = formatBuildInfoLine(info());
    expect(line).toContain('channel none');
    expect(line).toContain('runtime unknown');
  });

  it('shows the real channel and runtime version when the build has them', () => {
    expect(
      formatBuildInfoLine(info({ version: '1.0.0', updateIdShort: 'abcd1234', channel: 'preview', runtimeVersion: '1.0.0' }))
    ).toBe('v1.0.0 · update abcd1234 · channel preview · runtime 1.0.0');
  });

  it('reproduces the literal reported device string, now with channel/runtime appended', () => {
    // The exact symptom from the device report, before this fix: "vunknown
    // · embedded build (no OTA update)" — version fell back to 'unknown'
    // (Constants.expoConfig?.version was unavailable) and there was no way
    // to tell whether a channel/runtime mismatch was the cause or whether
    // this build simply has no channel baked in at all.
    const line = formatBuildInfoLine(info({ version: 'unknown' }));
    expect(line).toBe('vunknown · embedded build (no OTA update) · channel none · runtime unknown');
  });
});
