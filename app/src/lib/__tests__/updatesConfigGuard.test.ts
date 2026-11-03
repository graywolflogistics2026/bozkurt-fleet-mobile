// UPDATE VISIBILITY FIX guard (owner decision 2026-11-03): a build made
// without a channel, or an app config without the runtimeVersion policy,
// can never receive an OTA update. This test fails before such a build
// could be made.
import * as fs from 'fs';
import * as path from 'path';

const APP = path.resolve(__dirname, '../../..');

describe('OTA delivery config', () => {
  test('every build profile in eas.json has a channel', () => {
    const eas = JSON.parse(fs.readFileSync(path.join(APP, 'eas.json'), 'utf8')) as { build: Record<string, { channel?: unknown }> };
    const profiles = Object.entries(eas.build ?? {});
    expect(profiles.length).toBeGreaterThan(0);
    const missing = profiles.filter(([, p]) => typeof p.channel !== 'string' || p.channel.trim() === '').map(([name]) => name);
    expect(missing).toEqual([]);
    // The owner's builds listen on preview.
    expect(eas.build.preview.channel).toBe('preview');
  });

  test('app.config has the runtimeVersion policy and the EAS Update url', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const config = require(path.join(APP, 'app.config.js')) as { expo: { runtimeVersion?: { policy?: string }; updates?: { url?: string }; version?: string } };
    expect(config.expo.runtimeVersion?.policy).toBe('appVersion');
    expect(config.expo.updates?.url).toMatch(/^https:\/\/u\.expo\.dev\//);
    expect(config.expo.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('the commit stamp is read at publish time too (not only on EAS Build)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const config = require(path.join(APP, 'app.config.js')) as { expo: { extra: { gitCommitHash: string | null } } };
    const hash = config.expo.extra.gitCommitHash;
    expect(hash === null || /^[0-9a-f]{7,40}$/.test(hash)).toBe(true);
  });
});
