// MENU (owner decisions 2026-11-23, docs/decisions/
// menu-simplification-proposal.md, Stage 2): every route in the registry
// stays reachable — a menu row, a tab, a card on a parent screen (itself
// reachable), a Settings button, the Reports tab, or an explicit feature
// flag. The menu has section headings again (Stage 2).
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  MENU_ORDER,
  MENU_REACHED_FROM,
  MENU_SECTIONS,
  NAV_GROUPS,
  RAW_NAV_GROUPS,
  filterNavGroupsByFlags,
  flattenNavItems,
  menuItems,
  menuSections,
  sidebarItems,
  sidebarSections,
  SIDEBAR_ONLY_AFTER,
} from '@/src/navigation/navRegistry';
import { FEATURE_FLAGS, type FeatureFlagKey } from '@/src/config/featureFlags';

const ROOT = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const rawHrefs = flattenNavItems(RAW_NAV_GROUPS).map((i) => i.href as string);
// Same sections as app/(tabs)/reports.tsx REPORTS_SECTION_KEYS.
const REPORTS_SECTIONS = ['sidebar.sections.intelligence', 'sidebar.sections.tools'];
// A route's screen file: '/(tabs)/more/x' -> 'app/(tabs)/more/x.tsx'.
const screenFile = (href: string) => `app/${href.replace('/(tabs)', '(tabs)')}.tsx`;
// The file names the child's route as a literal (a card's href / router.push).
const linksTo = (src: string, href: string) => src.includes(`'${href}'`) || src.includes(`"${href}"`);

// A route is reachable when it is a menu row, a tab, a Settings button, on
// Reports, or a card on a parent that is itself reachable (chains such as
// Data Cleanup -> Category Learning -> Settings).
function isReachable(href: string, seen: Set<string> = new Set()): boolean {
  if (MENU_ORDER.includes(href)) return true;
  if (seen.has(href)) return false;
  seen.add(href);
  const reach = MENU_REACHED_FROM[href];
  if (!reach) return false;
  if (reach.kind === 'parent') return isReachable(reach.parent, seen);
  return true;
}

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

  test('every route resolves to a menu row, tab, Settings, Reports or flag (no loops)', () => {
    expect(rawHrefs.filter((h) => !isReachable(h))).toEqual([]);
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
        // The parent screen file really links to the child's route.
        expect([href, linksTo(read(screenFile(reach.parent)), href)]).toEqual([href, true]);
      } else if (reach.kind === 'settings') {
        expect([href, linksTo(settings, href)]).toEqual([href, true]);
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

describe('the menu (owner decisions 2026-11-23)', () => {
  const menu = menuItems().map((i) => i.href as string);

  test('phone menu: no Home row, no Scorecard row, Settings last, Revenue first', () => {
    expect(menu).not.toContain('/(tabs)');
    expect(menu).not.toContain('/(tabs)/more/scorecard');
    expect(menu[menu.length - 1]).toBe('/(tabs)/more/settings');
    expect(menu.slice(0, 3)).toEqual(['/(tabs)/import', '/(tabs)/more/loads', '/(tabs)/more/settlements']);
    expect(menu).toContain('/(tabs)/transactions');
  });

  test('the daily screens are separate rows', () => {
    for (const h of ['/(tabs)/more/loads', '/(tabs)/more/settlements', '/(tabs)/more/fuel', '/(tabs)/more/maintenance', '/(tabs)/more/tolls', '/(tabs)/deductions']) {
      expect(menu).toContain(h);
    }
  });

  test('wide sidebar: Home on top (no heading), then the menu rows, plus Scorecard after its anchor row', () => {
    const side = sidebarItems().map((i) => i.href as string);
    const expected = ['/(tabs)', ...menu];
    for (const [href, after] of Object.entries(SIDEBAR_ONLY_AFTER)) {
      expect(menu).toContain(after); // the anchor is a real menu row
      expected.splice(expected.indexOf(after) + 1, 0, href);
    }
    expect(side).toEqual(expected);
    expect(Object.keys(SIDEBAR_ONLY_AFTER)).toContain('/(tabs)/more/scorecard');
    // Sidebar-only rows are never phone menu rows.
    for (const href of Object.keys(SIDEBAR_ONLY_AFTER)) expect(menu).not.toContain(href);
    expect(sidebarSections().home?.href).toBe('/(tabs)');
  });

  test('phone sheet and wide sidebar show the same section headings, in order', () => {
    const titles = menuSections().map((s) => s.titleKey);
    expect(titles).toEqual(MENU_SECTIONS.map((s) => s.titleKey));
    expect(sidebarSections().sections.map((s) => s.titleKey)).toEqual(titles);
    const en = JSON.parse(read('src/i18n/locales/en.json'));
    for (const key of titles) {
      const name = key.replace('sidebar.sections.', '');
      expect([key, typeof en.sidebar.sections[name]]).toEqual([key, 'string']);
    }
    const sheet = read('src/components/MenuSheet.tsx');
    const sidebar = read('src/components/WideSidebar.tsx');
    expect(sheet).toContain('menuSections()');
    expect(sidebar).toContain('sidebarSections()');
    for (const src of [sheet, sidebar]) expect(src).toContain('t(section.titleKey)');
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
