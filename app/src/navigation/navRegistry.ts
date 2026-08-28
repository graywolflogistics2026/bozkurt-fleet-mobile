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
