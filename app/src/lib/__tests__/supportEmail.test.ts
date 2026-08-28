import { buildSupportMailtoUrl } from '@/src/lib/supportEmail';
import { SUPPORT_EMAIL } from '@/src/brand';
import type { BuildInfo } from '@/src/lib/buildInfoFormat';

const buildInfo: BuildInfo = {
  version: '1.2.3',
  updateId: 'abcdef1234567890',
  updateIdShort: 'abcdef12',
  channel: 'production',
  runtimeVersion: '1.2.3',
  gitCommitHash: '1234567890abcdef',
  gitCommitHashShort: '1234567',
  isEmbeddedLaunch: false,
};

describe('buildSupportMailtoUrl (owner decision 2026-08-05, FULL PARITY follow-up item J)', () => {
  it('targets SUPPORT_EMAIL', () => {
    const url = buildSupportMailtoUrl({ subject: 'Help', buildInfo, platform: 'ios' });
    expect(url).toContain(`mailto:${SUPPORT_EMAIL}?`);
  });

  it('includes the subject, build info, and platform', () => {
    const url = buildSupportMailtoUrl({ subject: 'App Support Request', buildInfo, platform: 'android' });
    expect(url).toContain(encodeURIComponent('App Support Request'));
    const decodedBody = decodeURIComponent(url.split('body=')[1]);
    expect(decodedBody).toContain('v1.2.3');
    expect(decodedBody).toContain('update abcdef12');
    expect(decodedBody).toContain('commit 1234567');
    expect(decodedBody).toContain('Platform: android');
  });

  it('includes the user id when provided, omits it when not', () => {
    const withUser = buildSupportMailtoUrl({ subject: 'x', buildInfo, platform: 'ios', userId: 'user-123' });
    expect(decodeURIComponent(withUser)).toContain('User ID: user-123');

    const withoutUser = buildSupportMailtoUrl({ subject: 'x', buildInfo, platform: 'ios' });
    expect(decodeURIComponent(withoutUser)).not.toContain('User ID:');
  });

  it('includes screen name and error message only when provided (crash-report case)', () => {
    const url = buildSupportMailtoUrl({
      subject: 'Crash Report',
      buildInfo,
      platform: 'ios',
      screenName: 'CashFlow',
      errorMessage: 'Cannot read property x of undefined',
    });
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('Screen: CashFlow');
    expect(decoded).toContain('Error: Cannot read property x of undefined');
  });

  it('never includes any financial figures — the body is built only from build/platform/user/screen/error fields', () => {
    const url = buildSupportMailtoUrl({ subject: 'Help', buildInfo, platform: 'ios', userId: 'user-123' });
    const decoded = decodeURIComponent(url);
    expect(decoded).not.toMatch(/\$\d/);
  });
});
