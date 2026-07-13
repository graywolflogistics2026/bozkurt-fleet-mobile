// Customizable dashboard (CLAUDE.md invariant #17, PROMPTS.md Session 9a
// item 8) — a stable per-card id (NOT the i18n key, so relabeling the
// default later doesn't orphan a saved layout) for every one of the ~20
// Dashboard cards, in today's default order/grouping. docs/PENDING_SQL.md
// §19 documents profiles.dashboard_layout's shape: an ordered array of
// { id, visible, label } — id matches one of these, label null means "use
// the i18n default", absence from the array or visible:false hides it.
export const DEFAULT_CARD_ORDER = [
  'totalRevenue',
  'totalDeductions',
  'netToOwner',
  'milesDriven',
  'ytdPerDiemDays',
  'perDiemDeduction',
  'perDiemSummary',
  'weeksInService',
  'avgNetPerWeek',
  'businessBalance',
  'revenuePerMile',
  'costPerMile',
  'profitPerMile',
  'revenueExpenseTrend',
  'estTotalTax',
  'quarterlyPayment',
  'weeklyTaxReserve',
  'effectiveRate',
  'scorpPreview',
  'capitalAccountStrip',
  'recentLoads',
  'truckCard',
  'fleetOverview',
  'driverOverview',
] as const;

export type DashboardCardId = (typeof DEFAULT_CARD_ORDER)[number];

// Dashboard redesign (device feedback round 2, owner decision 2026-07-13):
// these cards are hidden from the fresh/never-touched default layout —
// absorbed into the new zoned design (perDiemSummary merges
// ytdPerDiemDays+perDiemDeduction into one compact card; totalRevenue is
// absorbed by the Zone 1 trend chart) or simply de-prioritized — but stay
// fully available in Customize, where a user can still toggle them back
// on. Applied in mergeDashboardLayout() below so this is true both for a
// brand-new user AND for an existing saved layout that's never explicitly
// touched that specific card's visibility.
const DEFAULT_HIDDEN_CARD_IDS = new Set<string>([
  'totalRevenue',
  'ytdPerDiemDays',
  'perDiemDeduction',
  'milesDriven',
  'weeksInService',
  'avgNetPerWeek',
  'businessBalance',
  'effectiveRate',
  'scorpPreview',
]);

// Collapsible titled sections (owner decision 2026-07-13, "Dashboard
// sections" addition to the redesign) — mirrors the sidebar/menu-sheet
// grouping language (WideSidebar.tsx's GROUPS) at a coarser grain: not
// every Dashboard card belongs to one of these 4, only the ones the
// redesign's Zones 1-5 cover. Everything else (capitalAccountStrip,
// recentLoads, truckCard, fleetOverview, driverOverview, and every
// still-hidden-by-default card above) stays unsectioned (section: null)
// — rendered below the 4 sections, unchanged, no collapse behavior.
export const SECTION_IDS = ['overview', 'money', 'onTheRoad', 'taxes'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

// i18n key for each section's title — read by both the Dashboard itself
// and dashboard-customize.tsx's section picker.
export const SECTION_LABEL_KEYS: Record<SectionId, string> = {
  overview: 'dashboard.sections.overview',
  money: 'dashboard.sections.money',
  onTheRoad: 'dashboard.sections.onTheRoad',
  taxes: 'dashboard.sections.taxes',
};

// Default section for every card that has one — deliberately includes
// the hidden-by-default atomic per-diem/tax cards (ytdPerDiemDays,
// perDiemDeduction, effectiveRate) so that if a user re-enables one via
// Customize, it lands somewhere sensible instead of unsectioned.
const DEFAULT_CARD_SECTIONS: Partial<Record<string, SectionId>> = {
  revenueExpenseTrend: 'overview',
  netToOwner: 'money',
  totalDeductions: 'money',
  perDiemSummary: 'onTheRoad',
  ytdPerDiemDays: 'onTheRoad',
  perDiemDeduction: 'onTheRoad',
  revenuePerMile: 'onTheRoad',
  costPerMile: 'onTheRoad',
  profitPerMile: 'onTheRoad',
  estTotalTax: 'taxes',
  quarterlyPayment: 'taxes',
  weeklyTaxReserve: 'taxes',
  effectiveRate: 'taxes',
};

// i18n key for each card's DEFAULT label — read by the customize screen so
// it can show "Total Revenue" etc. next to the reorder/hide/rename controls
// even before the user has touched anything.
export const CARD_LABEL_KEYS: Record<DashboardCardId, string> = {
  totalRevenue: 'dashboard.totalRevenue',
  totalDeductions: 'dashboard.totalDeductions',
  netToOwner: 'dashboard.netToOwner',
  milesDriven: 'dashboard.milesDriven',
  ytdPerDiemDays: 'dashboard.ytdPerDiemDays',
  perDiemDeduction: 'dashboard.perDiemDeduction',
  perDiemSummary: 'dashboard.perDiemSummaryTitle',
  weeksInService: 'dashboard.weeksInService',
  avgNetPerWeek: 'dashboard.avgNetPerWeek',
  businessBalance: 'dashboard.businessBalance',
  revenuePerMile: 'dashboard.revenuePerMile',
  costPerMile: 'dashboard.costPerMile',
  profitPerMile: 'dashboard.profitPerMile',
  revenueExpenseTrend: 'dashboard.revenueExpenseTrendTitle',
  estTotalTax: 'dashboard.estTotalTax',
  quarterlyPayment: 'dashboard.quarterlyPayment',
  weeklyTaxReserve: 'dashboard.weeklyTaxReserve',
  effectiveRate: 'dashboard.effectiveRate',
  scorpPreview: 'dashboard.scorpPreviewTitle',
  capitalAccountStrip: 'dashboard.capitalAccountTitle',
  recentLoads: 'dashboard.recentLoadsTitle',
  truckCard: 'dashboard.truckCardLabel',
  fleetOverview: 'dashboard.fleetOverviewTitle',
  driverOverview: 'dashboard.driverOverviewTitle',
};

export type DashboardCardConfig = { id: string; visible: boolean; label: string | null; section: SectionId | null };

// Merges a saved layout (from profiles.dashboard_layout, possibly stale —
// missing newer cards, or carrying an id for a card that no longer exists)
// with the current default order: known stored entries keep the user's
// order/visibility/label/section; any card missing from storage (new card
// added in a later release, or the user has never customized) is appended
// at the end, visible by default; any stored id that no longer matches a
// real card is dropped silently.
//
// section backward-compat: an entry saved BEFORE the "Dashboard sections"
// addition has no `section` key at all (`undefined`), which is treated as
// "use the default for this id" — distinct from a user explicitly moving a
// card to "no section" (`section: null` stored), which is preserved as-is.
export function mergeDashboardLayout(stored: unknown, defaultOrder: readonly string[] = DEFAULT_CARD_ORDER): DashboardCardConfig[] {
  const validIds = new Set<string>(defaultOrder);
  const storedList = Array.isArray(stored) ? (stored as Array<Partial<DashboardCardConfig>>) : [];

  const seen = new Set<string>();
  const merged: DashboardCardConfig[] = [];

  for (const entry of storedList) {
    if (!entry || typeof entry.id !== 'string' || !validIds.has(entry.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push({
      id: entry.id,
      visible: entry.visible !== false,
      label: entry.label ?? null,
      section: entry.section !== undefined ? entry.section : (DEFAULT_CARD_SECTIONS[entry.id] ?? null),
    });
  }

  for (const id of defaultOrder) {
    if (!seen.has(id)) merged.push({ id, visible: !DEFAULT_HIDDEN_CARD_IDS.has(id), label: null, section: DEFAULT_CARD_SECTIONS[id] ?? null });
  }

  return merged;
}

export function isDefaultLayout(stored: unknown): boolean {
  return stored == null;
}
