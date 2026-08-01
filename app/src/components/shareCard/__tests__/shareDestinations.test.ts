import { SHARE_DESTINATIONS } from '@/src/components/shareCard/shareDestinations';

// UX MEGA-PASS item F (owner decision 2026-07-31): WhatsApp, SMS/Messages,
// and Copy Image added to the shared destination list every share-card
// screen renders from.
describe('SHARE_DESTINATIONS', () => {
  it('includes the 3 new destinations added this pass', () => {
    const keys = SHARE_DESTINATIONS.map((d) => d.key);
    expect(keys).toContain('whatsapp');
    expect(keys).toContain('sms');
    expect(keys).toContain('copy');
  });

  it('the copy destination has no scheme — handled as a pure clipboard action, never opens an app', () => {
    const copy = SHARE_DESTINATIONS.find((d) => d.key === 'copy');
    expect(copy?.scheme).toBeUndefined();
  });

  it('every other destination has a scheme to check with Linking.canOpenURL', () => {
    for (const dest of SHARE_DESTINATIONS) {
      if (dest.key === 'copy') continue;
      expect(dest.scheme).toBeTruthy();
    }
  });

  it('has no duplicate keys', () => {
    const keys = SHARE_DESTINATIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
