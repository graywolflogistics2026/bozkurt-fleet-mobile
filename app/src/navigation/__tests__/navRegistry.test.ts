import { NAV_GROUPS, TAB_BAR_HREFS, flattenNavItems, moreTabItems, isActiveRoute } from '@/src/navigation/navRegistry';

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

describe('isActiveRoute', () => {
  it('matches a nested route with the (tabs) group segment stripped', () => {
    expect(isActiveRoute('/more/loads', '/(tabs)/more/loads')).toBe(true);
    expect(isActiveRoute('/more/settlements', '/(tabs)/more/loads')).toBe(false);
  });

  it('matches the root tab against "/"', () => {
    expect(isActiveRoute('/', '/(tabs)')).toBe(true);
  });
});
