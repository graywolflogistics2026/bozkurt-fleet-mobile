import type { Href } from 'expo-router';

// NAV PARITY FIX (owner decision 2026-07-30, device evidence: "Documents"
// missing from the WideSidebar's TOOLS group despite being reachable from
// the More tab's own screen). Root cause: `app/(tabs)/more/index.tsx`
// used to maintain its OWN separate, hand-written item list — Equipment
// and then Documents were added there but never to this one (which
// WideSidebar.tsx AND MenuSheet.tsx both already rendered directly), so
// they silently never appeared on the wide-screen sidebar or the phone
// hamburger-menu sheet. This file is now the ONE registry every nav
// surface derives from — WideSidebar, MenuSheet, the More tab's flat
// list, and Reports' grouped-section filter (app/(tabs)/reports.tsx) —
// so this specific class of bug (a route added to one surface's item
// list but not another's) is structurally impossible going forward: there
// is only one list to add a route to.
export type NavItem = { href: Href; labelKey: string; emoji: string };
export type NavGroup = { titleKey: string; items: NavItem[] };

// Legacy Parity Checklist grouping (Overview/Revenue/Expenses/Business/
// Intelligence/Tools/System), with this app's beyond-legacy additions
// appended into whichever group fits best. See WideSidebar.tsx's own
// header comment for the icon-strategy and "Assets vs Asset Register"
// naming notes — those design decisions live there, not here.
export const NAV_GROUPS: NavGroup[] = [
  {
    titleKey: 'sidebar.sections.overview',
    items: [
      { href: '/(tabs)', labelKey: 'nav.dashboard', emoji: '📊' },
      { href: '/(tabs)/transactions' as Href, labelKey: 'nav.transactions', emoji: '💳' },
    ],
  },
  {
    titleKey: 'sidebar.sections.revenue',
    items: [
      { href: '/(tabs)/import', labelKey: 'nav.import', emoji: '➕' },
      { href: '/(tabs)/more/loads', labelKey: 'nav.loads', emoji: '🚛' },
      { href: '/(tabs)/more/settlements', labelKey: 'nav.settlements', emoji: '📋' },
      { href: '/(tabs)/more/reimbursements', labelKey: 'nav.reimbursements', emoji: '↩️' },
      { href: '/(tabs)/more/other-income', labelKey: 'nav.otherIncome', emoji: '💵' },
    ],
  },
  {
    titleKey: 'sidebar.sections.expenses',
    items: [
      { href: '/(tabs)/more/fuel', labelKey: 'nav.fuel', emoji: '⛽' },
      { href: '/(tabs)/more/maintenance', labelKey: 'nav.maintenance', emoji: '🔧' },
      { href: '/(tabs)/more/tolls', labelKey: 'nav.tolls', emoji: '🛣️' },
      { href: '/(tabs)/deductions', labelKey: 'nav.deductions', emoji: '🧾' },
    ],
  },
  {
    titleKey: 'sidebar.sections.business',
    items: [
      { href: '/(tabs)/more/trucks', labelKey: 'nav.trucks', emoji: '🚚' },
      { href: '/(tabs)/more/equipment' as Href, labelKey: 'nav.equipment', emoji: '🛠️' },
      { href: '/(tabs)/more/drivers', labelKey: 'nav.drivers', emoji: '🧑‍✈️' },
      { href: '/(tabs)/more/capital-account', labelKey: 'nav.capitalAccount', emoji: '💰' },
      { href: '/(tabs)/more/operating-pnl', labelKey: 'nav.operatingPnl', emoji: '📊' },
    ],
  },
  {
    titleKey: 'sidebar.sections.intelligence',
    items: [
      { href: '/(tabs)/truck-health', labelKey: 'nav.truckHealth', emoji: '🚛' },
      { href: '/(tabs)/more/cash-flow', labelKey: 'nav.cashFlow', emoji: '🏦' },
      { href: '/(tabs)/more/scorecard', labelKey: 'nav.scorecard', emoji: '🏆' },
      { href: '/(tabs)/more/loans', labelKey: 'nav.loans', emoji: '📄' },
      { href: '/(tabs)/more/credit-cards', labelKey: 'nav.creditCards', emoji: '💳' },
      { href: '/(tabs)/more/bank-statements', labelKey: 'nav.bankStatements', emoji: '🏛️' },
      { href: '/(tabs)/more/profit-analysis', labelKey: 'nav.profitAnalysis', emoji: '📈' },
      { href: '/(tabs)/more/ceo-mode', labelKey: 'nav.ceoMode', emoji: '🐺' },
    ],
  },
  {
    titleKey: 'sidebar.sections.tools',
    items: [
      { href: '/(tabs)/more/asset-register', labelKey: 'nav.assetRegister', emoji: '🗄️' },
      { href: '/(tabs)/more/accountant-package', labelKey: 'nav.accountantPackage', emoji: '📁' },
      { href: '/(tabs)/more/ai-advisor', labelKey: 'nav.aiAdvisor', emoji: '🤖' },
      { href: '/(tabs)/more/tax-estimator', labelKey: 'nav.taxEstimator', emoji: '🧮' },
      { href: '/(tabs)/more/share-profit', labelKey: 'nav.shareProfit', emoji: '📤' },
      { href: '/(tabs)/more/compliance', labelKey: 'nav.compliance', emoji: '🪪' },
      { href: '/(tabs)/more/documents' as Href, labelKey: 'nav.documents', emoji: '🗃️' },
      { href: '/(tabs)/more/dashboard-customize', labelKey: 'nav.dashboardCustomize', emoji: '🧩' },
    ],
  },
  {
    titleKey: 'sidebar.sections.system',
    items: [{ href: '/(tabs)/more/settings', labelKey: 'nav.settings', emoji: '⚙️' }],
  },
];

// Routes that already have their own bottom-tab icon on phones (Home,
// Transactions, Import, Deductions, Truck Health) — the More tab's own
// flat list (moreTabItems() below) deliberately excludes these, since
// they're already one tap away; WideSidebar/MenuSheet (which replace or
// supplement the tab bar) still include everything. Named explicitly here
// rather than left as implicit filtering logic at each call site.
export const TAB_BAR_HREFS: readonly Href[] = [
  '/(tabs)',
  '/(tabs)/transactions' as Href,
  '/(tabs)/import',
  '/(tabs)/deductions',
  '/(tabs)/truck-health',
];

export function flattenNavItems(groups: NavGroup[] = NAV_GROUPS): NavItem[] {
  return groups.flatMap((g) => g.items);
}

export function moreTabItems(groups: NavGroup[] = NAV_GROUPS): NavItem[] {
  return flattenNavItems(groups).filter((item) => !TAB_BAR_HREFS.includes(item.href));
}

// expo-router's usePathname() strips group segments like "(tabs)" from
// the resolved path, so an href of '/(tabs)/more/loads' resolves to
// '/more/loads', and the root '/(tabs)' resolves to '/'.
export function isActiveRoute(pathname: string, href: string): boolean {
  const stripped = href.replace('/(tabs)', '') || '/';
  return pathname === stripped;
}
