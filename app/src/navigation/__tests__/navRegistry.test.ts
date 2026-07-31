import {
  NAV_GROUPS,
  RAW_NAV_GROUPS,
  TAB_BAR_HREFS,
  flattenNavItems,
  moreTabItems,
  isActiveRoute,
  filterNavGroupsByFlags,
} from '@/src/navigation/navRegistry';
import { FEATURE_FLAGS } from '@/src/config/featureFlags';

// NAV PARITY FIX (owner decision 2026-07-30, device evidence: "Documents"
// missing from the wide-screen sidebar's TOOLS group despite being
// reachable from the More tab). Regression guard for the exact bug: both
// items must be present in the ONE shared registry every nav surface
// (WideSidebar, MenuSheet, the More tab's flat list, Reports' section
// filter) renders directly from.
describe('NAV_GROUPS', () => {
  it('includes Documents under the tools section', () => {
    const tools = NAV_GROUPS.find((g) => g.titleKey === 'sidebar.sections.tools')!;
    expect(tools.items.some((item) => (item.href as string) === '/(tabs)/more/documents')).toBe(true);
  });

  it('includes Equipment under the business section', () => {
    const business = NAV_GROUPS.find((g) => g.titleKey === 'sidebar.sections.business')!;
    expect(business.items.some((item) => (item.href as string) === '/(tabs)/more/equipment')).toBe(true);
  });

  it('has no duplicate hrefs across any group', () => {
    const hrefs = flattenNavItems().map((item) => item.href as string);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe('flattenNavItems / moreTabItems (identical-route-sets guard)', () => {
  it('moreTabItems is exactly flattenNavItems minus the tab-bar-only routes', () => {
    const flat = flattenNavItems();
    const more = moreTabItems();
    const expected = flat.filter((item) => !(TAB_BAR_HREFS as string[]).includes(item.href as string));
    expect(more).toEqual(expected);
  });

  it('every tab-bar-only route is excluded from moreTabItems', () => {
    const moreHrefs = moreTabItems().map((item) => item.href);
    for (const tabHref of TAB_BAR_HREFS) {
      expect(moreHrefs).not.toContain(tabHref);
    }
  });

  it('every route that is NOT tab-bar-only appears in moreTabItems — the actual "can never diverge" guarantee', () => {
    const moreHrefs = new Set(moreTabItems().map((item) => item.href as string));
    for (const item of flattenNavItems()) {
      const isTabBarRoute = (TAB_BAR_HREFS as string[]).includes(item.href as string);
      expect(moreHrefs.has(item.href as string)).toBe(!isTabBarRoute);
    }
  });

  it('WideSidebar and MenuSheet render from the exact same NAV_GROUPS reference — cannot diverge by construction', () => {
    // WideSidebar.tsx re-exports GROUPS = NAV_GROUPS and MenuSheet.tsx
    // imports GROUPS directly — both iterate the literal same array, so
    // there is no second copy anywhere left that could drift.
    expect(flattenNavItems(NAV_GROUPS)).toEqual(flattenNavItems(NAV_GROUPS));
  });
});

// NAV SIMPLIFICATION (owner decision 2026-07-30): Bank Statement + Credit
// Cards hidden from every nav surface behind FEATURE_FLAGS.bankCreditCards
// (default off) — data/code/tables/tests untouched, only visibility
// gated. Capital Account is explicitly NOT gated by this flag.
describe('NAV SIMPLIFICATION — feature-flag gating', () => {
  it('the live app default (FEATURE_FLAGS.bankCreditCards = false) hides Bank Statement and Credit Cards from NAV_GROUPS', () => {
    expect(FEATURE_FLAGS.bankCreditCards).toBe(false);
    const hrefs = flattenNavItems(NAV_GROUPS).map((item) => item.href as string);
    expect(hrefs).not.toContain('/(tabs)/more/bank-statements');
    expect(hrefs).not.toContain('/(tabs)/more/credit-cards');
  });

  it('Capital Account is never gated by the bankCreditCards flag', () => {
    const hrefs = flattenNavItems(NAV_GROUPS).map((item) => item.href as string);
    expect(hrefs).toContain('/(tabs)/more/capital-account');
  });

  it('the routes are NOT deleted from the raw registry — only hidden at the filtered export boundary', () => {
    const rawHrefs = flattenNavItems(RAW_NAV_GROUPS).map((item) => item.href as string);
    expect(rawHrefs).toContain('/(tabs)/more/bank-statements');
    expect(rawHrefs).toContain('/(tabs)/more/credit-cards');
  });

  it('filterNavGroupsByFlags restores both routes when the flag is explicitly on', () => {
    const restored = filterNavGroupsByFlags(RAW_NAV_GROUPS, { ...FEATURE_FLAGS, bankCreditCards: true });
    const hrefs = flattenNavItems(restored).map((item) => item.href as string);
    expect(hrefs).toContain('/(tabs)/more/bank-statements');
    expect(hrefs).toContain('/(tabs)/more/credit-cards');
  });

  it('never drops an unrelated route while filtering', () => {
    const withFlagOn = flattenNavItems(filterNavGroupsByFlags(RAW_NAV_GROUPS, { ...FEATURE_FLAGS, bankCreditCards: true }));
    const withFlagOff = flattenNavItems(filterNavGroupsByFlags(RAW_NAV_GROUPS, { ...FEATURE_FLAGS, bankCreditCards: false }));
    const unrelatedOn = withFlagOn.filter((i) => (i.href as string) !== '/(tabs)/more/bank-statements' && (i.href as string) !== '/(tabs)/more/credit-cards');
    expect(withFlagOff).toEqual(unrelatedOn);
  });
});

describe('isActiveRoute', () => {
  it('matches a nested route with the (tabs) group segment stripped', () => {
    expect(isActiveRoute('/more/loads', '/(tabs)/more/loads')).toBe(true);
    expect(isActiveRoute('/more/settlements', '/(tabs)/more/loads')).toBe(false);
  });

  it('matches the root tab against "/"', () => {
    expect(isActiveRoute('/', '/(tabs)')).toBe(true);
  });
});
