import { computeKpis, type KpiInputs } from '@/src/stats/kpi';
import { periodStartIso, type PeriodOption } from '@/src/stats/periodFilter';

// PER-TRUCK "Profit" (owner decision 2026-10-30, batch D item 8): the SAME
// figure Home shows for that truck and period — computeKpis() with the
// truck's scope (its own rows plus every fleet-level NULL-truck row) — next
// to Per-Truck Profitability's own "After truck cost estimate" (allocated
// fleet costs + the truck's fixed-cost estimate, truckComparison.ts), which
// stays the ranking figure.
export function periodWindow(period: PeriodOption, now: Date = new Date()): KpiInputs['window'] {
  const startIso = periodStartIso(period, now);
  return startIso ? { startIso, endIso: '9999-12-31' } : null;
}

export function truckHomeProfits(inputs: Omit<KpiInputs, 'truckScope' | 'window'>, truckIds: string[], window: KpiInputs['window']): Map<string, number> {
  return new Map(truckIds.map((id) => [id, computeKpis({ ...inputs, truckScope: id, window }, { explain: false }).net]));
}
