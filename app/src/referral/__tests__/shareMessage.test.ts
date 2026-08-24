import { buildReferralShareMessage } from '@/src/referral/shareMessage';

describe('buildReferralShareMessage', () => {
  test('includes the body text, the code, and the deep link', () => {
    const message = buildReferralShareMessage({
      code: 'BOZKA-7F2K',
      body: 'Join me on BOZKA TRUCKING AI!',
      deepLink: 'bozkurtfleetos://sign-up?ref=BOZKA-7F2K',
    });
    expect(message).toContain('Join me on BOZKA TRUCKING AI!');
    expect(message).toContain('BOZKA-7F2K');
    expect(message).toContain('bozkurtfleetos://sign-up?ref=BOZKA-7F2K');
  });
});
