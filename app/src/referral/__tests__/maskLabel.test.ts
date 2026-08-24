import { buildMaskedReferralLabel } from '@/src/referral/maskLabel';

describe('buildMaskedReferralLabel', () => {
  test('a full name becomes initials', () => {
    expect(buildMaskedReferralLabel('Ali Bozkurt', '2026-08-01T00:00:00Z')).toBe('A. B.');
  });

  test('a single name becomes a single initial', () => {
    expect(buildMaskedReferralLabel('Ali', '2026-08-01T00:00:00Z')).toBe('A.');
  });

  test('extra whitespace between names is tolerated', () => {
    expect(buildMaskedReferralLabel('  Ali   Bozkurt  ', '2026-08-01T00:00:00Z')).toBe('A. B.');
  });

  test('no name yet — falls back to the signup month, never a raw name/email', () => {
    expect(buildMaskedReferralLabel(null, '2026-08-15T00:00:00Z')).toBe('New member (August 2026)');
    expect(buildMaskedReferralLabel(undefined, '2026-08-15T00:00:00Z')).toBe('New member (August 2026)');
    expect(buildMaskedReferralLabel('', '2026-08-15T00:00:00Z')).toBe('New member (August 2026)');
  });

  test('whitespace-only name also falls back to the month', () => {
    expect(buildMaskedReferralLabel('   ', '2026-08-15T00:00:00Z')).toBe('New member (August 2026)');
  });

  test('the label never contains the full name verbatim', () => {
    const label = buildMaskedReferralLabel('Graywolf Logistics', '2026-08-01T00:00:00Z');
    expect(label).not.toContain('Graywolf');
    expect(label).not.toContain('Logistics');
  });
});
