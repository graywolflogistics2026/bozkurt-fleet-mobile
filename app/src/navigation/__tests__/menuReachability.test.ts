// FLAT MENU (owner decision 2026-11-23, docs/decisions/
// menu-simplification-proposal.md): every route in the registry stays
// reachable — a menu row, a tab, a card on a parent screen that is a menu
// row, a Settings button, the Reports tab, or an explicit feature flag.
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  MENU_ORDER,
  MENU_REACHED_FROM,
  NAV_GROUPS,
  RAW_NAV_GROUPS,
  filterNavGroupsByFlags,
  flattenNavItems,
  menuItems,
  sidebarItems,
  SIDEBAR_ONLY_AFTER,
} from '@/src/navigation/navRegistry';
import { FEATURE_FLAGS, type FeatureFlagKey } from '@/src/config/featureFlags';

const ROOT = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const rawHrefs = flattenNavItems(RAW_NAV_GROUPS).map((i) => i.href as string);
// Same sections as app/(tabs)/reports.tsx REPORTS_SECTION_KEYS.
const REPORTS_SECTIONS = ['sidebar.sections.intelligence', 'sidebar.sections.tools'];

describe('every route is reachable', () => {
  test('each registry route is a menu row XOR has a MENU_REACHED_FROM reason', () => {
    const missing = rawHrefs.filter((h) => !MENU_ORDER.includes(h) && !MENU_REACHED_FROM[h]);
    const both = rawHrefs.filter((h) => MENU_ORDER.includes(h) && MENU_REACHED_FROM[h]);
    expect({ missing, both }).toEqual({ missing: [], both: [] });
  });

  test('menu and reach lists name only real routes, no duplicates', () => {
    expect([...MENU_ORDER, ...Object.keys(MENU_REACHED_FROM)].filter((h) => !rawHrefs.includes(h))).toEqual([]);
    expect(new Set(MENU_ORDER).size).toBe(MENU_ORDER.length);
  });

  test('each reason holds', () => {
    const layout = read('app/(tabs)/_layout.tsx');
    const settings = read('app/(tabs)/more/settings.tsx');
    for (const [href, reach] of Object.entries(MENU_REACHED_FROM)) {
      if (reach.kind === 'tab') {
        // A visible tab on phones (no `href: null`) and the sidebar's Home row.
        const name = href === '/(tabs)' ? 'index' : href.replace('/(tabs)/', '');
        expect(layout).toMatch(new RegExp(`<Tabs\\.Screen\\s+name="${name}"(?![^>]*href: null)`));
        expect(sidebarItems().map((i) => i.href as string)).toContain(href);
      } else if (reach.kind === 'parent') {
        expect(MENU_ORDER).toContain(reach.parent);
        const file = `app/${reach.parent.replace('/(tabs)', '(tabs)')}.tsx`;
        expect(read(file)).toContain(href);
      } else if (reach.kind === 'settings') {
        expect(settings).toContain(href);
      } else if (reach.kind === 'reports') {
        // Phones: on the Reports tab (a tab bar exists only below 768px).
        const inReports = NAV_GROUPS.filter((g) => REPORTS_SECTIONS.includes(g.titleKey)).some((g) => g.items.some((i) => (i.href as string) === href));
        expect(inReports).toBe(true);
        // Wide screens have no Reports tab: it must be a sidebar row.
        expect(sidebarItems().map((i) => i.href as string)).toContain(href);
      } else {
        // Hidden only while its flag is off; on, it is back in the registry output.
        const allOn = Object.fromEntries(Object.keys(FEATURE_FLAGS).map((k) => [k, true])) as Record<FeatureFlagKey, boolean>;
        expect(flattenNavItems(NAV_GROUPS).map((i) => i.href as string)).not.toContain(href);
        expect(flattenNavItems(filterNavGroupsByFlags(RAW_NAV_GROUPS, allOn)).map((i) => i.href as string)).toContain(href);
      }
    }
  });
});

describe('the flat menu (owner decisions 2026-11-23)', () => {
  const menu = menuItems().map((i) => i.href as string);

  test('phone menu: no Home row, no Scorecard row, Settings last, owner order', () => {
    expect(menu).not.toContain('/(tabs)');
    expect(menu).not.toContain('/(tabs)/more/scorecard');
    expect(menu[menu.length - 1]).toBe('/(tabs)/more/settings');
    expect(menu.slice(0, 4)).toEqual(['/(tabs)/import', '/(tabs)/more/loads', '/(tabs)/more/settlements', '/(tabs)/more/other-income']);
    expect(menu).toContain('/(tabs)/transactions');
  });

  test('the daily screens are separate rows', () => {
    for (const h of ['/(tabs)/more/loads', '/(tabs)/more/settlements', '/(tabs)/more/fuel', '/(tabs)/more/maintenance', '/(tabs)/more/tolls', '/(tabs)/deductions']) {
      expect(menu).toContain(h);
    }
  });

  test('wide sidebar: Home on top, then the menu rows, plus Scorecard right after Profit Analysis', () => {
    const side = sidebarItems().map((i) => i.href as string);
    const expected = ['/(tabs)', ...menu];
    expected.splice(expected.indexOf('/(tabs)/more/profit-analysis') + 1, 0, '/(tabs)/more/scorecard');
    expect(side).toEqual(expected);
    // Sidebar-only rows are never phone menu rows.
    for (const href of Object.keys(SIDEBAR_ONLY_AFTER)) expect(menu).not.toContain(href);
  });

  test('MenuSheet and WideSidebar render the flat lists, with no section headings', () => {
    const sheet = read('src/components/MenuSheet.tsx');
    const sidebar = read('src/components/WideSidebar.tsx');
    expect(sheet).toContain('menuItems()');
    expect(sidebar).toContain('sidebarItems()');
    for (const src of [sheet, sidebar]) expect(src).not.toMatch(/titleKey|sidebar\.sections/);
  });
});

describe('tab bar (owner decision 2026-11-23)', () => {
  const layout = read('app/(tabs)/_layout.tsx');
  const screens = [...layout.matchAll(/<Tabs\.Screen\s+name="([^"]+)"([\s\S]*?)\/>/g)].map((m) => ({ name: m[1], hidden: /href: null/.test(m[2]) }));

  test('visible tabs, in order: Home | Import | Reports | Menu', () => {
    expect(screens.filter((s) => !s.hidden).map((s) => s.name)).toEqual(['index', 'import', 'reports', 'more']);
  });

  test('Transactions, Deductions and Truck Health keep their routes (hidden from the bar only)', () => {
    expect(screens.filter((s) => s.hidden).map((s) => s.name).sort()).toEqual(['deductions', 'transactions', 'truck-health']);
  });

  test('every hidden tab route is a menu row', () => {
    for (const name of ['transactions', 'deductions', 'truck-health']) expect(MENU_ORDER).toContain(`/(tabs)/${name}`);
  });
});
