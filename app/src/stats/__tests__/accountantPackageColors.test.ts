import { ACCOUNTANT_EXPORT_COLORS, ACCOUNTANT_SCREEN_COLORS } from '../accountantPackageColors';

// FULL VISUAL PARITY WITH WEB (owner decision, v2026.08.05-W chase) — the
// export colour map is the literal spec: pins these exact hex values so a
// future edit can't silently drift from what the web report itself uses.
describe('ACCOUNTANT_EXPORT_COLORS matches the spec exactly', () => {
  it('owner-paid rows are amber #fef3c7', () => {
    expect(ACCOUNTANT_EXPORT_COLORS.ownerPaidBg).toBe('#fef3c7');
  });

  it('the total deductible expenses row is red #fee2e2', () => {
    expect(ACCOUNTANT_EXPORT_COLORS.totalRowBg).toBe('#fee2e2');
  });

  it('gross income is green #dcfce7', () => {
    expect(ACCOUNTANT_EXPORT_COLORS.grossIncomeBg).toBe('#dcfce7');
  });

  it('capital contributions in are the lighter green #f0fdf4', () => {
    expect(ACCOUNTANT_EXPORT_COLORS.contributionsInBg).toBe('#f0fdf4');
  });

  it('owner draws out are light red #fef2f2', () => {
    expect(ACCOUNTANT_EXPORT_COLORS.drawsOutBg).toBe('#fef2f2');
  });

  it('capital assets section is blue #eff6ff with header #dbeafe', () => {
    expect(ACCOUNTANT_EXPORT_COLORS.capitalAssetsBg).toBe('#eff6ff');
    expect(ACCOUNTANT_EXPORT_COLORS.capitalAssetsHeaderBg).toBe('#dbeafe');
  });

  it('the lumper fees section header is amber #fef3c7', () => {
    expect(ACCOUNTANT_EXPORT_COLORS.lumperHeaderBg).toBe('#fef3c7');
  });

  it('per-category subtotal rows are grey #f1f5f9', () => {
    expect(ACCOUNTANT_EXPORT_COLORS.subtotalRowBg).toBe('#f1f5f9');
  });
});

// ON-SCREEN (dark theme) — same meanings, translucent overlays of the
// same hue family, never the light export hex values (which would be
// unreadable against this app's near-black background). Every key that
// exists on the export map must also exist on the screen map, and vice
// versa, so no surface is ever missing a colour the spec requires.
describe('ACCOUNTANT_SCREEN_COLORS — dark-mode-aware, same hue family as export', () => {
  it('has the exact same set of keys as the export colour map', () => {
    expect(Object.keys(ACCOUNTANT_SCREEN_COLORS).sort()).toEqual(Object.keys(ACCOUNTANT_EXPORT_COLORS).sort());
  });

  it('owner-paid rows use the amber (orange, #f59e0b) hue family', () => {
    expect(ACCOUNTANT_SCREEN_COLORS.ownerPaidBg).toMatch(/rgba\(245, 158, 11,/);
    expect(ACCOUNTANT_SCREEN_COLORS.lumperHeaderBg).toMatch(/rgba\(245, 158, 11,/);
  });

  it('total/red rows use the red (#ef4444) hue family', () => {
    expect(ACCOUNTANT_SCREEN_COLORS.totalRowBg).toMatch(/rgba\(239, 68, 68,/);
  });

  it('draws-out is a lighter opacity of the same red than the total row', () => {
    const totalOpacity = Number(ACCOUNTANT_SCREEN_COLORS.totalRowBg.match(/[\d.]+\)$/)?.[0].replace(')', ''));
    const drawsOpacity = Number(ACCOUNTANT_SCREEN_COLORS.drawsOutBg.match(/[\d.]+\)$/)?.[0].replace(')', ''));
    expect(drawsOpacity).toBeLessThan(totalOpacity);
  });

  it('income/contributions-in rows use the green (#22c55e) hue family', () => {
    expect(ACCOUNTANT_SCREEN_COLORS.grossIncomeBg).toMatch(/rgba\(34, 197, 94,/);
    expect(ACCOUNTANT_SCREEN_COLORS.contributionsInBg).toMatch(/rgba\(34, 197, 94,/);
  });

  it('contributions-in is a lighter opacity of the same green than gross income', () => {
    const grossOpacity = Number(ACCOUNTANT_SCREEN_COLORS.grossIncomeBg.match(/[\d.]+\)$/)?.[0].replace(')', ''));
    const contribOpacity = Number(ACCOUNTANT_SCREEN_COLORS.contributionsInBg.match(/[\d.]+\)$/)?.[0].replace(')', ''));
    expect(contribOpacity).toBeLessThan(grossOpacity);
  });

  it('capital assets rows use the accent blue (#2563eb) hue family, header stronger than body', () => {
    expect(ACCOUNTANT_SCREEN_COLORS.capitalAssetsBg).toMatch(/rgba\(37, 99, 235,/);
    expect(ACCOUNTANT_SCREEN_COLORS.capitalAssetsHeaderBg).toMatch(/rgba\(37, 99, 235,/);
    const bodyOpacity = Number(ACCOUNTANT_SCREEN_COLORS.capitalAssetsBg.match(/[\d.]+\)$/)?.[0].replace(')', ''));
    const headerOpacity = Number(ACCOUNTANT_SCREEN_COLORS.capitalAssetsHeaderBg.match(/[\d.]+\)$/)?.[0].replace(')', ''));
    expect(headerOpacity).toBeGreaterThan(bodyOpacity);
  });
});
