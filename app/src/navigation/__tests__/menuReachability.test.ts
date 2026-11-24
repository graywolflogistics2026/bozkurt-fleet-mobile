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
    expect(menu).not.toContain('/(tabs)/transactions');
  });

  test('Assets & Equipment (owner 2026-11-24): a card on Capital Account titled nav.assetsEquipment; screen title unchanged; Equipment card stays', () => {
    const capital = read(screenFile('/(tabs)/more/capital-account'));
    expect(linksTo(capital, '/(tabs)/more/asset-register')).toBe(true);
    expect(capital).toContain("title={t('nav.assetsEquipment')}");
    expect(menuItems().map((i) => i.href as string)).not.toContain('/(tabs)/more/asset-register');
    expect(linksTo(read(screenFile('/(tabs)/more/asset-register')), '/(tabs)/more/equipment')).toBe(true);
    expect(read('app/(tabs)/more/_layout.tsx')).toContain("name=\"asset-register\" options={{ title: t('nav.assetRegister') }}");
  });

  test('final menu (owner 2026-11-24): 18 rows in 6 sections, exactly', () => {
    expect(menuSections().map((s) => [s.titleKey, s.items.map((i) => i.href as string)])).toEqual([
      ['sidebar.sections.revenue', ['/(tabs)/import', '/(tabs)/more/loads', '/(tabs)/more/settlements']],
      ['sidebar.sections.expenses', ['/(tabs)/more/fuel', '/(tabs)/more/maintenance', '/(tabs)/more/tolls', '/(tabs)/deductions']],
      ['sidebar.sections.overview', ['/(tabs)/more/operating-pnl', '/(tabs)/truck-health', '/(tabs)/more/ceo-mode']],
      ['sidebar.sections.business', ['/(tabs)/more/trucks', '/(tabs)/more/drivers', '/(tabs)/more/capital-account', '/(tabs)/more/documents', '/(tabs)/more/compliance']],
      ['sidebar.sections.taxAccounting', ['/(tabs)/more/accountant-package', '/(tabs)/more/tax-estimator']],
      ['sidebar.sections.system', ['/(tabs)/more/settings']],
    ]);
    expect(menuItems()).toHaveLength(18);
    // Renewals & Expiry Dates (compliance) is only a menu row now; its Documents card was removed (owner 2026-11-24).
    expect(read(screenFile('/(tabs)/more/documents'))).not.toContain('<RelatedScreenCard');
  });

  test('every screen that left the menu opens from its parent card or Settings', () => {
    expect(Object.fromEntries(Object.entries(MENU_REACHED_FROM).filter(([, r]) => r.kind === 'parent' || r.kind === 'settings').map(([h, r]) => [h, r.kind === 'parent' ? r.parent : 'settings']))).toEqual({
      '/(tabs)/more/reimbursements': '/(tabs)/more/other-income',
      '/(tabs)/more/other-income': '/(tabs)/more/tax-estimator',
      '/(tabs)/more/prime-driver-expenses': '/(tabs)/more/accountant-package',
      '/(tabs)/more/truck-comparison': '/(tabs)/more/trucks',
      '/(tabs)/more/equipment': '/(tabs)/more/asset-register',
      '/(tabs)/more/asset-register': '/(tabs)/more/capital-account',
      '/(tabs)/more/loans': '/(tabs)/more/capital-account',
      '/(tabs)/more/cash-flow': '/(tabs)/more/operating-pnl',
      '/(tabs)/more/profit-analysis': '/(tabs)/more/operating-pnl',
      '/(tabs)/more/scorecard': '/(tabs)/more/operating-pnl',
      '/(tabs)/transactions': '/(tabs)/more/operating-pnl',
      '/(tabs)/more/data-cleanup': '/(tabs)/more/category-learning',
      '/(tabs)/more/category-learning': 'settings',
      '/(tabs)/more/referral': 'settings',
    });
  });

  test('the daily screens are separate rows', () => {
    for (const h of ['/(tabs)/more/loads', '/(tabs)/more/settlements', '/(tabs)/more/fuel', '/(tabs)/more/maintenance', '/(tabs)/more/tolls', '/(tabs)/deductions']) {
      expect(menu).toContain(h);
    }
  });

  test('wide sidebar: Home on top (no heading), then exactly the menu rows', () => {
    expect(sidebarItems().map((i) => i.href as string)).toEqual(['/(tabs)', ...menu]);
    expect(sidebarSections().home?.href).toBe('/(tabs)');
  });

  test('Scorecard (owner 2026-11-23): card on Operating P&L, still on Reports and linked from Truck Comparison, never a menu/sidebar row', () => {
    const sc = '/(tabs)/more/scorecard';
    expect(MENU_REACHED_FROM[sc]).toEqual({ kind: 'parent', parent: '/(tabs)/more/operating-pnl' });
    expect(linksTo(read(screenFile('/(tabs)/more/operating-pnl')), sc)).toBe(true);
    const inReports = NAV_GROUPS.filter((g) => REPORTS_SECTIONS.includes(g.titleKey)).some((g) => g.items.some((i) => (i.href as string) === sc));
    expect(inReports).toBe(true);
    expect(linksTo(read(screenFile('/(tabs)/more/truck-comparison')), sc)).toBe(true);
    expect(sidebarItems().map((i) => i.href as string)).not.toContain(sc);
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

  test('hidden tab routes: Deductions and Truck Health are menu rows; Transactions is the Operating P&L card (owner 2026-11-24)', () => {
    for (const name of ['deductions', 'truck-health']) expect(MENU_ORDER).toContain(`/(tabs)/${name}`);
    expect(MENU_ORDER).not.toContain('/(tabs)/transactions');
    const pnl = read('app/(tabs)/more/operating-pnl.tsx');
    expect(linksTo(pnl, '/(tabs)/transactions')).toBe(true);
    // The card tells Transactions where back goes; Transactions maps it to Operating P&L.
    expect(pnl).toContain("params={{ from: 'operating-pnl' }}");
    const tx = read('app/(tabs)/transactions.tsx');
    expect(tx).toContain("'operating-pnl': '/(tabs)/more/operating-pnl'");
    expect(tx).toContain('hardwareBackPress');
  });
});
