import type { HealthStatus } from '@/src/truck/health';
import type { ComplianceUrgency } from '@/src/compliance/status';
import type { TrendDirection } from '@/src/stats/heroStats';

export type ChipStatus = 'green' | 'amber' | 'red';

export type FleetHealthChips = {
  truck: ChipStatus; // compliance items (DOT/IRP/insurance/CDL/medical card/etc.)
  maintenance: ChipStatus; // Truck Health interval statuses (oil, tires, ...)
  taxes: ChipStatus; // business_balance vs. the upcoming quarterly payment
  cashFlow: ChipStatus; // this-week-vs-last-week net profit direction
};

export type FleetHealthResult = {
  score: number; // 0-100, sum of 4 chips worth up to 25 each
  chips: FleetHealthChips;
};

export type FleetHealthInputs = {
  truckHealthStatuses: HealthStatus[];
  complianceUrgencies: ComplianceUrgency[];
  // businessBalance / upcoming quarterlyPayment — null when there's no
  // quarterly payment to compare against yet (e.g. no tax data loaded),
  // which reads as "nothing to flag" rather than a false red/amber.
  taxReserveRatio: number | null;
  cashFlowDirection: TrendDirection;
};

function maintenanceChip(statuses: HealthStatus[]): ChipStatus {
  if (statuses.some((s) => s === 'overdue')) return 'red';
  if (statuses.some((s) => s === 'due_soon')) return 'amber';
  return 'green';
}

function truckChip(urgencies: ComplianceUrgency[]): ChipStatus {
  if (urgencies.some((u) => u === 'overdue')) return 'red';
  if (urgencies.some((u) => u === 'due_soon')) return 'amber';
  return 'green';
}

function taxesChip(ratio: number | null): ChipStatus {
  if (ratio == null) return 'green';
  if (ratio < 0.5) return 'red';
  if (ratio < 1) return 'amber';
  return 'green';
}

function cashFlowChip(direction: TrendDirection): ChipStatus {
  if (direction === 'down') return 'red';
  if (direction === 'flat') return 'amber';
  return 'green';
}

function chipPoints(status: ChipStatus): number {
  return status === 'green' ? 25 : status === 'amber' ? 12 : 0;
}

// Fleet Health Score (Session 9d item 2, owner + design-advisor vision —
// dashboard "cockpit" gauge): a single 0-100 composite from 4 equally-
// weighted (25pt) inputs, each also surfaced as its own green/amber/red
// status chip so a glance at the chips explains WHY the score is what it
// is, not just the number. Deliberately composed only from data this
// account's own account already holds (CLAUDE.md invariant #22) — no
// live telemetry of any kind.
export function calcFleetHealthScore(inputs: FleetHealthInputs): FleetHealthResult {
  const chips: FleetHealthChips = {
    truck: truckChip(inputs.complianceUrgencies),
    maintenance: maintenanceChip(inputs.truckHealthStatuses),
    taxes: taxesChip(inputs.taxReserveRatio),
    cashFlow: cashFlowChip(inputs.cashFlowDirection),
  };
  const score = chipPoints(chips.truck) + chipPoints(chips.maintenance) + chipPoints(chips.taxes) + chipPoints(chips.cashFlow);
  return { score, chips };
}
