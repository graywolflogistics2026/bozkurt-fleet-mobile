import { shouldShowLaunchIntro } from '@/src/launch/launchIntroGate';

describe('shouldShowLaunchIntro — cold-start-only + deep-link/notification skip gating', () => {
  test('shows on a genuine cold start with no targeted-open signal', () => {
    expect(
      shouldShowLaunchIntro({ alreadyDecidedThisProcess: false, hasDeepLinkUrl: false, hasNotificationResponse: false })
    ).toBe(true);
  });

  test('never shows again once this process has already decided — the "never on return from background" rule', () => {
    expect(
      shouldShowLaunchIntro({ alreadyDecidedThisProcess: true, hasDeepLinkUrl: false, hasNotificationResponse: false })
    ).toBe(false);
  });

  test('the already-decided rule wins even if the OTHER two signals would otherwise have allowed it', () => {
    expect(
      shouldShowLaunchIntro({ alreadyDecidedThisProcess: true, hasDeepLinkUrl: false, hasNotificationResponse: false })
    ).toBe(false);
  });

  test('skips when opened via a deep link — "the user is going somewhere specific"', () => {
    expect(
      shouldShowLaunchIntro({ alreadyDecidedThisProcess: false, hasDeepLinkUrl: true, hasNotificationResponse: false })
    ).toBe(false);
  });

  test('skips when opened via a notification tap', () => {
    expect(
      shouldShowLaunchIntro({ alreadyDecidedThisProcess: false, hasDeepLinkUrl: false, hasNotificationResponse: true })
    ).toBe(false);
  });

  test('skips when both a deep link and a notification signal are present', () => {
    expect(
      shouldShowLaunchIntro({ alreadyDecidedThisProcess: false, hasDeepLinkUrl: true, hasNotificationResponse: true })
    ).toBe(false);
  });
});
