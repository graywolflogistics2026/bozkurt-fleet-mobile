import { backTargetFor } from '@/src/navigation/backIntent';
import { RAW_NAV_GROUPS, flattenNavItems } from '@/src/navigation/navRegistry';

describe('backTargetFor', () => {
  it('every top-level tab route back-targets Home directly', () => {
    expect(backTargetFor('/(tabs)')).toBe('home');
    expect(backTargetFor('/(tabs)/transactions')).toBe('home');
    expect(backTargetFor('/(tabs)/import')).toBe('home');
    expect(backTargetFor('/(tabs)/deductions')).toBe('home');
    expect(backTargetFor('/(tabs)/truck-health')).toBe('home');
    expect(backTargetFor('/(tabs)/reports')).toBe('home');
    // more/index itself is the tab's own root screen, not a "detail"
    // reached from within the stack.
    expect(backTargetFor('/(tabs)/more')).toBe('home');
  });

  it('every screen nested under /(tabs)/more/ back-targets the More menu first, then Home', () => {
    expect(backTargetFor('/(tabs)/more/cash-flow')).toBe('moreIndex');
    expect(backTargetFor('/(tabs)/more/settlements')).toBe('moreIndex');
    expect(backTargetFor('/(tabs)/more/ceo-mode')).toBe('moreIndex');
    expect(backTargetFor('/(tabs)/more/tax-estimator')).toBe('moreIndex');
    expect(backTargetFor('/(tabs)/more/capital-account')).toBe('moreIndex');
  });

  // Regression guard: every real route in the shared nav registry
  // classifies to a known back target — a new route added under
  // /(tabs)/more/ (or as a new top-level tab) is automatically covered
  // by the same rule, never silently falls through unclassified.
  it('classifies every route in the shared nav registry', () => {
    const hrefs = flattenNavItems(RAW_NAV_GROUPS).map((item) => item.href as string);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(['home', 'moreIndex']).toContain(backTargetFor(href));
    }
  });
});
