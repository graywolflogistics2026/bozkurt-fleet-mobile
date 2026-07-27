import { useMemo } from 'react';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useTrucksList } from '@/src/data/trucks';
import { useMaintenanceRecords } from '@/src/data/maintenanceRecords';
import { useMaintenanceIntervals } from '@/src/data/maintenanceIntervals';
import { useTruckHealthConfig } from '@/src/data/truckHealthConfig';
import { useComplianceItems } from '@/src/data/complianceItems';
import { calcTruckHealth, type HealthOverrides, type HealthResult } from '@/src/truck/health';
import { calcComplianceStatus, type ComplianceStatusResult } from '@/src/compliance/status';
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
export function useAlertsData() {
  const { activeTruck } = useActiveTruck();
  const activeTruckId = activeTruck?.id ?? null;
  const trucksListQuery = useTrucksList();
  const maintRecordsQuery = useMaintenanceRecords(activeTruckId ? { truck_id: activeTruckId } : undefined);
  const maintIntervalsQuery = useMaintenanceIntervals(activeTruckId);
  const healthConfigQuery = useTruckHealthConfig(activeTruckId);
  const complianceQuery = useComplianceItems();

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
        .map((item) => ({ item, status: calcComplianceStatus(item.due_date) }))
        .filter((row) => row.status.urgency === 'overdue' || row.status.urgency === 'due_soon'),
    [complianceQuery.data]
  );

  return {
    dueMaintenance,
    dueCompliance,
    count: dueMaintenance.length + dueCompliance.length,
    isLoading: trucksListQuery.isLoading || complianceQuery.isLoading,
  };
}
