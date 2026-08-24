import { useEffect, useMemo, useRef } from 'react';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useTrucksList } from '@/src/data/trucks';
import { useMaintenanceRecords } from '@/src/data/maintenanceRecords';
import { useMaintenanceIntervals } from '@/src/data/maintenanceIntervals';
import { useTruckHealthConfig } from '@/src/data/truckHealthConfig';
import { useComplianceItems } from '@/src/data/complianceItems';
import { useSettlements } from '@/src/data/settlements';
import { useDeductions } from '@/src/data/deductions';
import { useFuelPurchases } from '@/src/data/fuelPurchases';
import { useTolls } from '@/src/data/tolls';
import { useTaxConfig } from '@/src/data/taxConfig';
import { useTaxYearData } from '@/src/data/taxYearData';
import { useFleetStats } from '@/src/data/dashboardStats';
import { useProfile, useUpdateProfile } from '@/src/data/profile';
import { useAuth } from '@/src/context/AuthContext';
import { calcTruckHealth, type HealthOverrides, type HealthResult } from '@/src/truck/health';
import { calcComplianceStatus, type ComplianceStatusResult } from '@/src/compliance/status';
import { isComplianceTypeVisibleForRole, resolveRolePromptNeeded, type ProfileRole } from '@/src/alerts/roleFilter';
import { buildMissingDataNudgeCandidates, type NudgeCandidate } from '@/src/alerts/missingDataNudges';
import { selectNudgesToShow, recordNudgesShown, silenceNudgeTopic, unsilenceNudgeTopic, type NudgeState } from '@/src/alerts/nudgeFrequency';
import { buildWeeklyTrueProfitTrend } from '@/src/stats/trueProfit';
import { trailingAverageNet } from '@/src/stats/goalProgress';
import { calcCurrentYearDepreciation } from '@/src/tax/depreciation';
import type { ComplianceItem } from '@/src/types/db';

export type DueComplianceRow = { item: ComplianceItem; status: ComplianceStatusResult };

// Shared "what needs my attention" source for the Dashboard top-bar bell
// badge (Session 9e-B1) and the Alerts screen it opens — both are separate
// screens/components (native header vs. a routed screen) so each calls this
// hook independently rather than passing the count through navigation
// params; react-query's cache means this is not a duplicate network fetch
// in practice. Truck Health "due" mirrors index.tsx's own truckHealthResults
// calculation (CLAUDE.md invariant #4 — calcTruckHealth is the one source
// of truth for health status).
//
// ROLE-AWARE ALERTS + MISSING-DATA NUDGES + FREQUENCY DISCIPLINE (owner
// decision 2026-08-24, NEXT PASS items D1-D3): compliance rows are now
// filtered by profiles.role (src/alerts/roleFilter.ts) before they ever
// reach the caller — a company driver never sees a truck-only compliance
// item, full stop, not just visually de-emphasized. Missing-data nudges
// (src/alerts/missingDataNudges.ts) are computed the same way, then passed
// through the frequency-cap engine (src/alerts/nudgeFrequency.ts) against
// profiles.nudge_state before being returned — a nudge this hook returns
// is, by construction, one that's actually allowed to show right now.
export function useAlertsData() {
  const { session } = useAuth();
  const { activeTruck } = useActiveTruck();
  const activeTruckId = activeTruck?.id ?? null;
  const trucksListQuery = useTrucksList();
  const maintRecordsQuery = useMaintenanceRecords(activeTruckId ? { truck_id: activeTruckId } : undefined);
  const maintIntervalsQuery = useMaintenanceIntervals(activeTruckId);
  const healthConfigQuery = useTruckHealthConfig(activeTruckId);
  const complianceQuery = useComplianceItems();
  const settlementsQuery = useSettlements();
  const deductionsQuery = useDeductions();
  const profileQuery = useProfile();
  const updateProfile = useUpdateProfile();
  // "UNLOCK" NUDGES (owner decision 2026-08-24, FIVE ADDITIONS pass, PART
  // 1) — additional fetches feeding the new detectors' real numbers: a
  // fleet-wide true-profit trend for the goal-suggestion figure (same
  // trailing-4-week convention as Part 3's goal prefill), the fleet-wide
  // canonical CPM for the missing-miles nudge, tax_config/tax_year_data for
  // the entity-type/per-diem-rate nudges.
  const fuelQuery = useFuelPurchases();
  const tollsQuery = useTolls();
  const allMaintenanceQuery = useMaintenanceRecords();
  const taxConfigQuery = useTaxConfig();
  const taxYearDataQuery = useTaxYearData();
  const fleetStatsQuery = useFleetStats(null);

  const role: ProfileRole = (profileQuery.data?.role as ProfileRole) ?? null;

  const activeTruckRow = useMemo(
    () => trucksListQuery.data?.find((tr) => tr.id === activeTruckId) ?? null,
    [trucksListQuery.data, activeTruckId]
  );

  const truckHealthResults = useMemo<HealthResult[]>(() => {
    if (!activeTruckRow || !maintIntervalsQuery.data) return [];
    const intervals = maintIntervalsQuery.data.map((iv) => ({
      category: iv.category,
      trackingMode: iv.tracking_mode,
      intervalMiles: iv.interval_miles,
      intervalHours: iv.interval_hours,
      bundledWithCategory: iv.bundled_with_category,
      enabled: iv.enabled,
    }));
    const records = (maintRecordsQuery.data ?? []).map((r) => ({
      serviceType: r.service_type,
      odometer: r.odometer,
      engineHours: r.engine_hours,
      serviceDate: r.service_date,
    }));
    const overrides = (healthConfigQuery.data?.overrides ?? {}) as HealthOverrides;
    return calcTruckHealth(intervals, records, activeTruckRow.current_odometer ?? 0, activeTruckRow.apu_hours ?? 0, overrides);
  }, [activeTruckRow, maintIntervalsQuery.data, maintRecordsQuery.data, healthConfigQuery.data]);

  const dueMaintenance = useMemo(
    () => truckHealthResults.filter((r) => r.status === 'overdue' || r.status === 'due_soon'),
    [truckHealthResults]
  );

  const dueCompliance = useMemo<DueComplianceRow[]>(
    () =>
      (complianceQuery.data ?? [])
        .filter((item) => isComplianceTypeVisibleForRole(role, item.type))
        .map((item) => ({ item, status: calcComplianceStatus(item.due_date) }))
        .filter((row) => row.status.urgency === 'overdue' || row.status.urgency === 'due_soon'),
    [complianceQuery.data, role]
  );

  const currentTaxYear = new Date().getFullYear();
  const depreciationPreviewTotal = useMemo(() => {
    return (trucksListQuery.data ?? []).reduce((sum, t) => {
      if (t.cost_basis_ownership_mode === 'lease' || t.depreciation_method) return sum;
      if (!t.purchase_price) return sum;
      const yearPlacedInService = t.purchase_date ? new Date(t.purchase_date).getFullYear() : currentTaxYear;
      const preview = calcCurrentYearDepreciation(
        { purchasePrice: t.purchase_price, ownershipMode: 'paid', method: 'full', yearPlacedInService, spreadYears: null },
        'tractor',
        currentTaxYear
      );
      return sum + preview.currentYearDepreciation;
    }, 0);
  }, [trucksListQuery.data, currentTaxYear]);

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
  const suggestedWeeklyGoal = trailingAverageNet(weeklyTrend);

  const nudgeCandidates = useMemo<NudgeCandidate[]>(
    () =>
      buildMissingDataNudgeCandidates({
        settlements: settlementsQuery.data ?? [],
        trucks: trucksListQuery.data ?? [],
        deductions: deductionsQuery.data ?? [],
        role,
        currentCpm: fleetStatsQuery.data?.cpm.costPerMile ?? null,
        depreciationPreviewTotal,
        weeklyGoal: profileQuery.data ? (profileQuery.data.weekly_goal ?? null) : undefined,
        suggestedWeeklyGoal,
        existingComplianceTypes: complianceQuery.data ? complianceQuery.data.map((c) => c.type) : undefined,
        isComplianceTypeVisibleForRole,
        entityTypeSet: taxConfigQuery.data ? !!taxConfigQuery.data.entity_type : undefined,
        homeState: profileQuery.data ? (profileQuery.data.home_state ?? null) : undefined,
        deductionsCount: deductionsQuery.data ? deductionsQuery.data.length : undefined,
        cfBankBalance: profileQuery.data ? (profileQuery.data.cf_bank_balance ?? null) : undefined,
        perDiemDailyRate: taxYearDataQuery.data?.data.per_diem.daily_rate ?? null,
        checkPerDiemZeroMileWeek: (settlementsQuery.data?.length ?? 0) > 0,
      }),
    [
      settlementsQuery.data,
      trucksListQuery.data,
      deductionsQuery.data,
      role,
      fleetStatsQuery.data,
      depreciationPreviewTotal,
      profileQuery.data,
      suggestedWeeklyGoal,
      complianceQuery.data,
      taxConfigQuery.data,
      taxYearDataQuery.data,
    ]
  );

  const nudgeState: NudgeState = (profileQuery.data?.nudge_state as NudgeState) ?? {};
  const accountCreatedAt = session?.user?.created_at ?? null;

  const visibleNudges = useMemo(
    () => selectNudgesToShow(nudgeCandidates, nudgeState, accountCreatedAt, new Date()),
    // nudgeState is intentionally read fresh each render (not memo-keyed on
    // its own identity) — see the recordShown effect below, which is what
    // actually keeps this from re-showing the same topic every render.
    [nudgeCandidates, nudgeState, accountCreatedAt]
  );

  // Record "shown" exactly once per newly-surfaced topic set — a plain
  // render-time computation (visibleNudges above) must never itself carry
  // the side effect of persisting state, or every re-render would count as
  // a fresh "shown". The ref guards against re-firing the mutation for the
  // same topic list on every re-render (e.g. a parent re-render with no
  // real data change) while still catching a genuinely new topic later.
  const recordedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (visibleNudges.length === 0 || !profileQuery.data) return;
    const key = visibleNudges
      .map((n) => n.topic)
      .sort()
      .join(',');
    if (recordedKeyRef.current === key) return;
    recordedKeyRef.current = key;
    const nextState = recordNudgesShown(nudgeState, visibleNudges.map((n) => n.topic), new Date());
    updateProfile.mutate({ nudge_state: nextState });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleNudges, profileQuery.data]);

  function silenceNudge(topic: NudgeCandidate['topic']) {
    updateProfile.mutate({ nudge_state: silenceNudgeTopic(nudgeState, topic, new Date()) });
  }

  function unsilenceNudge(topic: NudgeCandidate['topic']) {
    updateProfile.mutate({ nudge_state: unsilenceNudgeTopic(nudgeState, topic) });
  }

  const rolePromptNeeded = resolveRolePromptNeeded(role, profileQuery.data?.role_prompt_dismissed_at);

  function setRole(newRole: Exclude<ProfileRole, null>) {
    updateProfile.mutate({ role: newRole });
  }

  function dismissRolePrompt() {
    updateProfile.mutate({ role_prompt_dismissed_at: new Date().toISOString() });
  }

  return {
    dueMaintenance,
    dueCompliance,
    nudges: visibleNudges,
    silenceNudge,
    unsilenceNudge,
    rolePromptNeeded,
    setRole,
    dismissRolePrompt,
    count: dueMaintenance.length + dueCompliance.length + visibleNudges.length,
    isLoading: trucksListQuery.isLoading || complianceQuery.isLoading || profileQuery.isLoading,
  };
}
