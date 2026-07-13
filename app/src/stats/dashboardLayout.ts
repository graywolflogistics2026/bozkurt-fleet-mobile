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

export type DashboardCardConfig = { id: string; visible: boolean; label: string | null };

// Merges a saved layout (from profiles.dashboard_layout, possibly stale —
// missing newer cards, or carrying an id for a card that no longer exists)
// with the current default order: known stored entries keep the user's
// order/visibility/label; any card missing from storage (new card added in
// a later release, or the user has never customized) is appended at the
// end, visible by default; any stored id that no longer matches a real
// card is dropped silently.
export function mergeDashboardLayout(stored: unknown, defaultOrder: readonly string[] = DEFAULT_CARD_ORDER): DashboardCardConfig[] {
  const validIds = new Set<string>(defaultOrder);
  const storedList = Array.isArray(stored) ? (stored as Array<Partial<DashboardCardConfig>>) : [];

  const seen = new Set<string>();
  const merged: DashboardCardConfig[] = [];

  for (const entry of storedList) {
    if (!entry || typeof entry.id !== 'string' || !validIds.has(entry.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push({ id: entry.id, visible: entry.visible !== false, label: entry.label ?? null });
  }

  for (const id of defaultOrder) {
    if (!seen.has(id)) merged.push({ id, visible: !DEFAULT_HIDDEN_CARD_IDS.has(id), label: null });
  }

  return merged;
}

export function isDefaultLayout(stored: unknown): boolean {
  return stored == null;
}
