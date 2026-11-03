import { shorten, formatBuildInfoLine, isEmbeddedBuild, NULL_NAMES, stamp, type BuildInfo } from '@/src/lib/buildInfoFormat';
import { mapCheckForUpdateOutcome, updateSlotText } from '@/src/lib/checkForUpdateFormat';

function info(overrides: Partial<BuildInfo> = {}): BuildInfo {
  return {
    version: '1.1.0',
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
  it('truncates to the default length of 8, or a custom length', () => {
    expect(shorten('abcdefghijklmnop')).toBe('abcdefgh');
    expect(shorten('abcdefghijklmnop', 7)).toBe('abcdefg');
    expect(shorten('abc')).toBe('abc');
  });
});

describe('formatBuildInfoLine (UPDATE VISIBILITY FIX, owner 2026-11-03)', () => {
  it('the device on build eabb0ee1 running an OTA update shows the real values', () => {
    const line = formatBuildInfoLine(
      info({
        buildVersion: '2',
        updateId: '0b7f3c1e-1111-2222-3333-444455556666',
        updateIdShort: '0b7f3c1e',
        updateCreatedAt: '2026-11-03T14:05:30.000Z',
        channel: 'preview',
        runtimeVersion: '1.1.0',
        gitCommitHashShort: 'e86e0ca',
        isEmbeddedLaunch: false,
      })
    );
    expect(line).toBe('v1.1.0 (build 2) · update 0b7f3c1e (2026-11-03 14:05 UTC) · commit e86e0ca · channel preview · runtime 1.1.0');
    expect(line).not.toContain('unknown');
    expect(line).not.toContain('embedded');
  });

  it('"embedded build" only when isEmbeddedLaunch is true AND updateId is null', () => {
    expect(formatBuildInfoLine(info({ channel: 'preview', runtimeVersion: '1.1.0' }))).toContain('embedded build (no OTA update)');
    // isEmbeddedLaunch true but an update id: the update, never "embedded".
    const withId = formatBuildInfoLine(info({ updateId: 'abcdef12-x', updateIdShort: 'abcdef12' }));
    expect(withId).toContain('update abcdef12');
    expect(withId).not.toContain('embedded');
    // Not embedded and no id: the API name.
    expect(formatBuildInfoLine(info({ isEmbeddedLaunch: false }))).toContain(`update ${NULL_NAMES.updateId}`);
    expect(isEmbeddedBuild(info())).toBe(true);
    expect(isEmbeddedBuild(info({ updateId: 'x', updateIdShort: 'x' }))).toBe(false);
  });

  it('a null value prints the API name, never "unknown" or "none"', () => {
    const line = formatBuildInfoLine(info({ version: NULL_NAMES.version, isEmbeddedLaunch: false }));
    expect(line).toBe(
      'vApplication.nativeApplicationVersion=null · update Updates.updateId=null · commit extra.gitCommitHash=null · channel Updates.channel=null · runtime Updates.runtimeVersion=null'
    );
    expect(line).not.toMatch(/unknown|channel none/);
  });

  it('an API that threw is named, and the other values still show', () => {
    const line = formatBuildInfoLine(info({ channel: 'preview', runtimeVersion: '1.1.0', updateIdShort: 'abcdef12', errors: ['Constants.expoConfig'] }));
    expect(line).toContain('channel preview');
    expect(line).toContain('runtime 1.1.0');
    expect(line).toContain('threw: Constants.expoConfig');
  });

  it('stamp gives a locale-free UTC minute, or null', () => {
    expect(stamp('2026-11-03T14:05:30.000Z')).toBe('2026-11-03 14:05');
    expect(stamp(null)).toBeNull();
    expect(stamp('not a date')).toBeNull();
  });
});

describe('Check for Update: download, then running vs downloaded', () => {
  it('a found update is reported as downloaded with its id and date', () => {
    const r = mapCheckForUpdateOutcome(true, { type: 'downloaded', manifestId: 'abc', createdAt: '2026-11-03T15:00:00Z' });
    expect(r).toMatchObject({ status: 'downloaded', manifestId: 'abc', createdAt: '2026-11-03T15:00:00Z' });
    expect(r.message).toContain('applies when the app restarts');
  });

  it('the running and downloaded slots read differently', () => {
    expect(updateSlotText({ updateId: '0b7f3c1e-1111', createdAt: new Date('2026-11-03T14:05:00Z') }, 'x')).toBe('0b7f3c1e · 2026-11-03 14:05 UTC');
    expect(updateSlotText({ isEmbeddedLaunch: true }, 'x')).toBe('embedded build');
    expect(updateSlotText(null, 'Updates.updateId=null')).toBe('Updates.updateId=null');
    expect(updateSlotText({}, 'downloadedUpdate.updateId=null')).toBe('downloadedUpdate.updateId=null');
  });
});
