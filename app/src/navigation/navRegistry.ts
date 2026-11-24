import type { Href } from 'expo-router';
import { FEATURE_FLAGS, type FeatureFlagKey } from '@/src/config/featureFlags';

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

// NAV ORDER (owner decision 2026-08-24, device report — Tools was
// buried below Business/Intelligence in both the wide sidebar and the
// phone Menu sheet): Overview/Revenue/Expenses/Tools/Business/
// Intelligence/System — Tools sits directly under Expenses, ahead of
// Business, since its contents (Accountant Package, AI Advisor, Tax
// Estimator, Documents, ...) are reached far more often than the
// asset-management screens in Business. This app's beyond-legacy
// additions are appended into whichever group fits best. See
// WideSidebar.tsx's own header comment for the icon-strategy and "Assets
// vs Asset Register" naming notes — those design decisions live there,
// not here.
//
// RAW — deliberately unfiltered by feature flags (see NAV_GROUPS below,
// the filtered export every nav surface actually uses). Kept intact and
// exported so NAV SIMPLIFICATION (owner decision 2026-07-30, hiding Bank
// Statement + Credit Cards) never has to touch or delete a route entry
// here — only gate its visibility at the export boundary.
export const RAW_NAV_GROUPS: NavGroup[] = [
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
    titleKey: 'sidebar.sections.tools',
    items: [
      { href: '/(tabs)/more/asset-register', labelKey: 'nav.assetRegister', emoji: '🗄️' },
      { href: '/(tabs)/more/accountant-package', labelKey: 'nav.accountantPackage', emoji: '📁' },
      // "FOR PRIME INC DRIVERS" OUT-OF-POCKET EXPENSE TRACKER (owner
      // decision 2026-09-17) — a standalone, accountant-template-matching
      // monthly expense tool, deliberately distinct from Deductions/
      // Schedule-C (src/stats/primeDriverExpenses.ts's own header comment
      // has the full isolation guarantee).
      { href: '/(tabs)/more/prime-driver-expenses' as Href, labelKey: 'nav.primeDriverExpenses', emoji: '🧳' },
      // AI Advisor (SIMPLIFICATION PASS, owner decision) — the dedicated
      // free-form chat screen was removed; its one real capability (multi-
      // turn Q&A) was folded into AI Coach (ceo-mode.tsx's own "Ask a
      // question" section) before deletion, so nothing was lost.
      { href: '/(tabs)/more/tax-estimator', labelKey: 'nav.taxEstimator', emoji: '🧮' },
      // Share Weekly Profit (SIMPLIFICATION PASS, owner decision) — the
      // dedicated screen was removed; its own share-card pipeline
      // (src/components/shareCard/) is still fully used by CEO Mode's and
      // Scorecard's own "📤 Share" buttons, unaffected.
      { href: '/(tabs)/more/compliance', labelKey: 'nav.compliance', emoji: '🪪' },
      { href: '/(tabs)/more/documents' as Href, labelKey: 'nav.documents', emoji: '🗃️' },
      { href: '/(tabs)/more/category-learning' as Href, labelKey: 'nav.categoryLearning', emoji: '🧠' },
      { href: '/(tabs)/more/referral' as Href, labelKey: 'nav.referral', emoji: '🎁' },
      // ORPHAN CLEANUP TOOL (owner decision, docs/PENDING_SQL.md §70, item
      // 7) — a one-time, user-reviewable sweep for historical orphans
      // (pre-fix leftovers), same "repair-flow screen" precedent as Fix
      // Truck Assignments below.
      { href: '/(tabs)/more/data-cleanup' as Href, labelKey: 'nav.dataCleanup', emoji: '🧹' },
    ],
  },
  {
    titleKey: 'sidebar.sections.business',
    items: [
      { href: '/(tabs)/more/trucks', labelKey: 'nav.trucks', emoji: '🚚' },
      // MULTI-TRUCK MODEL (owner decision) — requirement 4 (per-truck
      // profitability comparison). The dedicated bulk "Fix Truck
      // Assignments" screen (requirement 3's original repair flow) was
      // removed (SIMPLIFICATION PASS, owner decision) — ordinary per-row
      // truck reassignment already exists on Deductions/Settlements/Fuel/
      // Maintenance/Tolls' own edit sheets, making a dedicated bulk screen
      // redundant.
      { href: '/(tabs)/more/truck-comparison' as Href, labelKey: 'nav.truckComparison', emoji: '📊' },
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
    titleKey: 'sidebar.sections.system',
    items: [{ href: '/(tabs)/more/settings', labelKey: 'nav.settings', emoji: '⚙️' }],
  },
];

// NAV SIMPLIFICATION (owner decision 2026-07-30): Bank Statement +
// Credit Cards hidden from every nav surface behind FEATURE_FLAGS.
// bankCreditCards (default off) — Capital Account is explicitly NOT
// gated (owner-contribution flow, draw tracking, and tax basis depend
// on it, confirmed decision). Code/tables/tests are untouched; flipping
// the flag back to `true` restores both routes everywhere instantly.
const FLAG_GATED_HREFS: Partial<Record<string, FeatureFlagKey>> = {
  '/(tabs)/more/bank-statements': 'bankCreditCards',
  '/(tabs)/more/credit-cards': 'bankCreditCards',
};

// Pure and exported so the gating logic itself is directly testable
// (arbitrary flag values in, not just the app's live default) —
// src/navigation/__tests__/navRegistry.test.ts exercises both the "off"
// (current default) and "on" states against this function.
export function filterNavGroupsByFlags(groups: NavGroup[], flags: Record<FeatureFlagKey, boolean>): NavGroup[] {
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => {
        const flagKey = FLAG_GATED_HREFS[item.href as string];
        return !flagKey || flags[flagKey];
      }),
    }))
    .filter((g) => g.items.length > 0);
}

// THE registry every nav surface (WideSidebar, MenuSheet, the More tab's
// flat list, Reports' section filter) actually renders from — RAW_NAV_GROUPS
// filtered through the live FEATURE_FLAGS. A route hidden here is hidden
// literally everywhere at once, by construction.
export const NAV_GROUPS: NavGroup[] = filterNavGroupsByFlags(RAW_NAV_GROUPS, FEATURE_FLAGS);

// Routes that already have their own bottom-tab icon on phones (Home,
// Transactions, Import, Deductions, Truck Health) — the More tab's own
// flat list (moreTabItems() below) deliberately excludes these, since
// they're already one tap away; WideSidebar/MenuSheet (which replace or
// supplement the tab bar) still include everything. Named explicitly here
// rather than left as implicit filtering logic at each call site.
// TAB BAR (owner decision 2026-11-23): Home | Import | Reports | Menu.
// Reports and Menu are not registry routes. Transactions left the tab bar;
// Deductions and Truck Health had already left it (Session 9e-B8) but were
// still listed here, so the More index hid them.
export const TAB_BAR_HREFS: readonly Href[] = ['/(tabs)', '/(tabs)/import'];

export function flattenNavItems(groups: NavGroup[] = NAV_GROUPS): NavItem[] {
  return groups.flatMap((g) => g.items);
}

// MENU SECTIONS (owner decisions 2026-11-23, docs/decisions/
// menu-simplification-proposal.md, Stage 2 — replaces Stage 1's flat list).
// The phone Menu sheet and the wide sidebar show these sections WITH
// headings, rows in this order, Settings last. Home is not a phone menu row
// (it is a tab); the wide sidebar puts Home on top, without a heading.
// The groups above stay internal: Reports (app/(tabs)/reports.tsx) and the
// daily-tip coverage map still read them, and every route stays in them.
// Screens that leave the menu become a card on a parent screen (or a
// button in Settings) and are listed in MENU_REACHED_FROM below.
export type MenuSection = { titleKey: string; hrefs: readonly string[] };

export const MENU_SECTIONS: readonly MenuSection[] = [
  {
    titleKey: 'sidebar.sections.revenue',
    hrefs: ['/(tabs)/import', '/(tabs)/more/loads', '/(tabs)/more/settlements'],
  },
  {
    titleKey: 'sidebar.sections.expenses',
    // Maintenance left the menu (owner 2026-11-24): a card on Truck Health.
    hrefs: ['/(tabs)/more/fuel', '/(tabs)/more/tolls', '/(tabs)/deductions'],
  },
  {
    titleKey: 'sidebar.sections.overview',
    hrefs: ['/(tabs)/more/operating-pnl', '/(tabs)/truck-health', '/(tabs)/more/ceo-mode'],
  },
  {
    titleKey: 'sidebar.sections.business',
    hrefs: [
      '/(tabs)/more/trucks',
      '/(tabs)/more/drivers',
      '/(tabs)/more/capital-account',
      '/(tabs)/more/documents',
      // Back as a row (owner 2026-11-23); the Documents card stays too.
      '/(tabs)/more/compliance',
    ],
  },
  {
    titleKey: 'sidebar.sections.taxAccounting',
    hrefs: ['/(tabs)/more/accountant-package', '/(tabs)/more/tax-estimator'],
  },
  {
    titleKey: 'sidebar.sections.system',
    hrefs: ['/(tabs)/more/settings'],
  },
];

// Every menu row, in order (all sections, flattened).
export const MENU_ORDER: readonly string[] = MENU_SECTIONS.flatMap((section) => section.hrefs);

// How every registry route that is NOT a menu row is still reached.
// src/navigation/__tests__/menuReachability.test.ts checks that every
// route is either in MENU_ORDER or here, and that each reason holds.
export type MenuReach =
  // A bottom-tab button (phones) / the sidebar's Home row (wide screens).
  | { kind: 'tab' }
  // A card on a parent screen (router.push to the child's own route, so
  // back returns to the parent). The parent is itself reachable: a menu
  // row, or a card/Settings button in turn.
  | { kind: 'parent'; parent: string }
  // A button in Settings.
  | { kind: 'settings' }
  // Hidden by a FEATURE_FLAGS key that is off (route kept).
  | { kind: 'featureFlag' };

export const MENU_REACHED_FROM: Readonly<Record<string, MenuReach>> = {
  '/(tabs)': { kind: 'tab' },
  // Owner 2026-11-23: Scorecard is hidden from the menu; a card on Operating
  // P&L (its way in on wide screens too), and still on the Reports tab and
  // linked from Truck Comparison.
  '/(tabs)/more/scorecard': { kind: 'parent', parent: '/(tabs)/more/operating-pnl' },
  // Owner 2026-11-24: Transactions (hidden tab route) is a card on Operating
  // P&L; back from it returns there (transactions.tsx useBackToParent).
  '/(tabs)/transactions': { kind: 'parent', parent: '/(tabs)/more/operating-pnl' },
  // Owner 2026-11-24: a card on Truck Health; back from it returns there
  // (maintenance.tsx useBackToParent, from=truck-health).
  '/(tabs)/more/maintenance': { kind: 'parent', parent: '/(tabs)/truck-health' },
  // Owner 2026-11-23: a card on Other Income (reimbursements reduce expenses, never income).
  '/(tabs)/more/reimbursements': { kind: 'parent', parent: '/(tabs)/more/other-income' },
  // Owner 2026-11-23: a card on Tax Estimator.
  '/(tabs)/more/other-income': { kind: 'parent', parent: '/(tabs)/more/tax-estimator' },
  // Owner 2026-11-23: a card on Accountant Package (visible to every user, as before).
  '/(tabs)/more/prime-driver-expenses': { kind: 'parent', parent: '/(tabs)/more/accountant-package' },
  // Owner 2026-11-23: a card on Trucks.
  '/(tabs)/more/truck-comparison': { kind: 'parent', parent: '/(tabs)/more/trucks' },
  // Owner 2026-11-23: a card on Asset Register (menu row "Assets & Equipment").
  '/(tabs)/more/equipment': { kind: 'parent', parent: '/(tabs)/more/asset-register' },
  // Owner 2026-11-24: Assets & Equipment (Asset Register) is a card on Capital Account, next to Loans.
  '/(tabs)/more/asset-register': { kind: 'parent', parent: '/(tabs)/more/capital-account' },
  // Owner 2026-11-23: a card on Capital Account.
  '/(tabs)/more/loans': { kind: 'parent', parent: '/(tabs)/more/capital-account' },
  // Owner 2026-11-23: a card on Operating P&L.
  '/(tabs)/more/cash-flow': { kind: 'parent', parent: '/(tabs)/more/operating-pnl' },
  // Owner 2026-11-23: a card on Operating P&L.
  '/(tabs)/more/profit-analysis': { kind: 'parent', parent: '/(tabs)/more/operating-pnl' },
  // Owner 2026-11-23: a card on Category Learning (navigation only).
  '/(tabs)/more/data-cleanup': { kind: 'parent', parent: '/(tabs)/more/category-learning' },
  // Owner 2026-11-23: a button in Settings > Tools.
  '/(tabs)/more/category-learning': { kind: 'settings' },
  // Owner 2026-11-23: a button in Settings > Tools.
  '/(tabs)/more/referral': { kind: 'settings' },
  '/(tabs)/more/credit-cards': { kind: 'featureFlag' },
  '/(tabs)/more/bank-statements': { kind: 'featureFlag' },
};

const byHref = (groups: NavGroup[]) => new Map(flattenNavItems(groups).map((i) => [i.href as string, i]));

export type MenuSectionItems = { titleKey: string; items: NavItem[] };

// The phone Menu sheet: sections with headings (flag-hidden routes drop
// out; a section left empty is dropped).
export function menuSections(groups: NavGroup[] = NAV_GROUPS): MenuSectionItems[] {
  const items = byHref(groups);
  return MENU_SECTIONS.map((section) => ({
    titleKey: section.titleKey,
    items: section.hrefs.map((href) => items.get(href)).filter((i): i is NavItem => !!i),
  })).filter((section) => section.items.length > 0);
}

// The phone menu's rows, flattened in order.
export function menuItems(groups: NavGroup[] = NAV_GROUPS): NavItem[] {
  return menuSections(groups).flatMap((section) => section.items);
}

// The wide sidebar (768px+, no tab bar): Home on top (no heading), then
// the same menu sections with their headings (owner 2026-11-23: no
// sidebar-only rows; Scorecard opens from its Operating P&L card).
export function sidebarSections(groups: NavGroup[] = NAV_GROUPS): { home: NavItem | null; sections: MenuSectionItems[] } {
  return { home: byHref(groups).get('/(tabs)') ?? null, sections: menuSections(groups) };
}

// The wide sidebar's rows, flattened in order (Home first).
export function sidebarItems(groups: NavGroup[] = NAV_GROUPS): NavItem[] {
  const { home, sections } = sidebarSections(groups);
  return [...(home ? [home] : []), ...sections.flatMap((section) => section.items)];
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
