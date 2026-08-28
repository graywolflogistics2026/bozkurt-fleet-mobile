import { useMemo } from 'react';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useSettlements } from '@/src/data/settlements';
import { useDeductions } from '@/src/data/deductions';
import { useComplianceItems } from '@/src/data/complianceItems';
import { useProfile } from '@/src/data/profile';
import { useFuelPurchases } from '@/src/data/fuelPurchases';
import { useTaxEstimate } from '@/src/data/taxEstimate';
import { useBenchmarks } from '@/src/data/benchmarks';
import { useTrucksList } from '@/src/data/trucks';
import { useMaintenanceRecords } from '@/src/data/maintenanceRecords';
import { useTolls } from '@/src/data/tolls';
import { useMaintenanceIntervals } from '@/src/data/maintenanceIntervals';
import { useTruckHealthConfig } from '@/src/data/truckHealthConfig';
import { calcTruckHealth, type HealthOverrides } from '@/src/truck/health';
import { buildWeeklyTrueProfitTrend, type TrueProfitWeeklyPoint } from '@/src/stats/trueProfit';
import { buildProfitAnalysis } from '@/src/stats/profitAnalysis';
import { calcComplianceStatus } from '@/src/compliance/status';
import { isDeductionNeedsReview } from '@/src/import/needsReview';
import { buildRecommendationCandidates, selectTopRecommendations, sumRecommendationImpact, type Recommendation } from '@/src/stats/aiRecommendations';

export type AiCoachSummary = {
  isLoading: boolean;
  latestWeek: TrueProfitWeeklyPoint | null;
  weeklyTrend: TrueProfitWeeklyPoint[];
  recommendations: Recommendation[];
  recommendationsTotalImpact: number;
  needsReviewCount: number;
  needsReviewEstValue: number;
  maintenanceAlertCount: number;
  complianceDueSoonCount: number;
};

// AI COACH FULLY VISIBLE ON HOME (owner decision 2026-08-24, device
// testing item 2): this is the exact briefing derivation ceo-mode.tsx
// already built (recommendation candidates -> top 3, needs-review/
// maintenance/compliance counts) — extracted into the ONE shared hook
// both ceo-mode.tsx and Home (app/(tabs)/index.tsx) now read from, rather
// than Home re-deriving a second, possibly-drifting copy of the same
// calculation. react-query dedupes these queries by key, so calling this
// hook alongside a screen's own already-active queries for the same table
// (e.g. Home's own useSettlements()) does not double-fetch.
export function useAiCoachSummary(): AiCoachSummary {
  const settlementsQuery = useSettlements();
  const deductionsQuery = useDeductions();
  const complianceQuery = useComplianceItems();
  const profileQuery = useProfile();
  const fuelQuery = useFuelPurchases();
  const taxQuery = useTaxEstimate();
  const benchmarksQuery = useBenchmarks();
  const { activeTruckId } = useActiveTruck();
  const trucksQuery = useTrucksList();
  const recordsQuery = useMaintenanceRecords(activeTruckId ? { truck_id: activeTruckId } : undefined);
  const intervalsQuery = useMaintenanceIntervals(activeTruckId);
  const healthConfigQuery = useTruckHealthConfig(activeTruckId);
  // Fleet-wide (not truck-scoped like recordsQuery above, which is only for
  // Truck Health) — matches Home's/Scorecard's/Profit Analysis' own
  // unscoped true-profit inputs so this figure can never disagree with
  // theirs for a multi-truck fleet.
  const allMaintenanceQuery = useMaintenanceRecords();
  const tollsQuery = useTolls();

  const isLoading =
    settlementsQuery.isLoading ||
    deductionsQuery.isLoading ||
    complianceQuery.isLoading ||
    profileQuery.isLoading ||
    fuelQuery.isLoading ||
    taxQuery.isLoading ||
    trucksQuery.isLoading;

  const weeklyTrend = useMemo(
    () =>
      buildWeeklyTrueProfitTrend(
        settlementsQuery.data ?? [],
        deductionsQuery.data ?? [],
        fuelQuery.data ?? [],
        allMaintenanceQuery.data ?? [],
        tollsQuery.data ?? []
      ),
    [settlementsQuery.data, deductionsQuery.data, fuelQuery.data, allMaintenanceQuery.data, tollsQuery.data]
  );
  const latestWeek = weeklyTrend[weeklyTrend.length - 1] ?? null;

  // NEEDS-REVIEW count (CLAUDE.md invariant #14) — reads the ONE shared
  // isDeductionNeedsReview() (src/import/needsReview.ts) rather than
  // re-deriving its own copy of the "NEEDS REVIEW: " prefix check, which
  // is exactly what let a reviewed row keep showing up here even after
  // being marked reviewed elsewhere (owner decision 2026-08-24, device
  // testing round — the fix).
  const needsReviewCount = useMemo(
    () => (deductionsQuery.data ?? []).filter(isDeductionNeedsReview).length,
    [deductionsQuery.data]
  );
  const needsReviewEstValue = useMemo(
    () =>
      (deductionsQuery.data ?? [])
        .filter(isDeductionNeedsReview)
        .reduce((sum, d) => sum + Number(d.amount ?? 0), 0),
    [deductionsQuery.data]
  );

  const complianceDueSoonCount = useMemo(
    () =>
      (complianceQuery.data ?? []).filter(
        (item) => calcComplianceStatus(item.due_date, new Date(), item.reminder_lead_days).urgency !== 'ok'
      ).length,
    [complianceQuery.data]
  );

  // Maintenance orange/red count, scoped to the active truck — same
  // truck-scoping convention as every other Dashboard stat (CLAUDE.md
  // invariant #7).
  const truck = useMemo(() => trucksQuery.data?.find((tr) => tr.id === activeTruckId) ?? null, [trucksQuery.data, activeTruckId]);
  const truckHealthResults = useMemo(() => {
    if (!truck || !intervalsQuery.data) return [];
    const intervals = intervalsQuery.data.map((iv) => ({
      category: iv.category,
      trackingMode: iv.tracking_mode,
      intervalMiles: iv.interval_miles,
      intervalHours: iv.interval_hours,
      bundledWithCategory: iv.bundled_with_category,
      enabled: iv.enabled,
    }));
    const records = (recordsQuery.data ?? []).map((r) => ({
      serviceType: r.service_type,
      odometer: r.odometer,
      engineHours: r.engine_hours,
      serviceDate: r.service_date,
    }));
    const overrides = (healthConfigQuery.data?.overrides ?? {}) as HealthOverrides;
    return calcTruckHealth(intervals, records, truck.current_odometer ?? 0, truck.apu_hours ?? 0, overrides);
  }, [truck, intervalsQuery.data, recordsQuery.data, healthConfigQuery.data]);
  const maintenanceAlertCount = useMemo(
    () => truckHealthResults.filter((r) => r.status === 'due_soon' || r.status === 'overdue').length,
    [truckHealthResults]
  );

  const profitAnalysisRollup = useMemo(
    () =>
      buildProfitAnalysis(
        settlementsQuery.data ?? [],
        fuelQuery.data ?? [],
        allMaintenanceQuery.data ?? [],
        deductionsQuery.data ?? [],
        30,
        new Date(),
        tollsQuery.data ?? []
      ),
    [settlementsQuery.data, fuelQuery.data, allMaintenanceQuery.data, deductionsQuery.data, tollsQuery.data]
  );
  const fuelBenchmark = useMemo(
    () => (benchmarksQuery.data ?? []).find((b) => b.metric === 'fuel_pct_of_revenue') ?? null,
    [benchmarksQuery.data]
  );
  // REMOVE BUSINESS BALANCE TRACKING (owner decision 2026-08-27) — this
  // recommendation used to compare the quarterly tax payment against
  // profiles.business_balance; that column is now permanently frozen
  // (nothing writes it anymore), so using it here would silently compare
  // against a stale, increasingly-wrong number instead of a real one.
  // Disabled outright rather than left to quietly mislead —
  // buildRecommendationCandidates() already treats `null` as "don't
  // offer this recommendation at all," same as when no tax estimate
  // exists yet.
  const taxReserveShortfall: number | null = null;
  const recommendations = useMemo(() => {
    const candidates = buildRecommendationCandidates({
      fuelPctOfRevenue: profitAnalysisRollup.fuelPctOfRevenue,
      fuelBenchmarkHigh: fuelBenchmark?.high ?? null,
      monthlyRevenue: profitAnalysisRollup.revenue,
      needsReviewCount,
      needsReviewEstValue,
      taxReserveShortfall,
      maintenanceAlertCount,
      complianceDueSoonCount,
    });
    return selectTopRecommendations(candidates, 3);
  }, [profitAnalysisRollup, fuelBenchmark, needsReviewCount, needsReviewEstValue, taxReserveShortfall, maintenanceAlertCount, complianceDueSoonCount]);
  const recommendationsTotalImpact = useMemo(() => sumRecommendationImpact(recommendations), [recommendations]);

  return {
    isLoading,
    latestWeek,
    weeklyTrend,
    recommendations,
    recommendationsTotalImpact,
    needsReviewCount,
    needsReviewEstValue,
    maintenanceAlertCount,
    complianceDueSoonCount,
  };
}
