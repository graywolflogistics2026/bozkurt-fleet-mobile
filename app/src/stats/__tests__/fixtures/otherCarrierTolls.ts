// A second carrier with NO approved statement (owner 2026-11-24,
// docs/decisions/toll-rule-profit-core-proposal.md §4): a toll line 40.00
// whose itemized plazas (3 tolls rows, 40.00) were saved too, plus an own
// toll 12.40 paid by the owner. Before the toll rule reached the profit
// core the plazas counted on top of their line: expenses 292.40, profit
// 2,707.60. With it: expenses 252.40, profit 2,747.60.
export const TRUCK = 'T1';
export const NOW = new Date(2026, 9, 25); // 2026-10-25

export const settlement = {
  id: 's-acme',
  week_ending: '2026-10-23',
  carrier: 'ACME FREIGHT',
  truck_id: TRUCK,
  gross: 3000,
  net: 2760,
  miles: 1000,
  statement: null,
};

const withheld = (id: string, category: string, description: string, amount: number, over: Record<string, unknown> = {}) => ({
  id,
  category,
  description,
  amount,
  ded_date: '2026-10-23',
  settlement_id: 's-acme',
  source: 'settlement',
  tax_deductible: false,
  truck_id: null as string | null,
  ...over,
});

export const tollLine = withheld('d-toll', 'Tolls & Scales', 'TOLLS THRU 10/20', 40);
export const insurance = withheld('d-ins', 'Insurance—Truck', 'INSURANCE', 200);
export const deductions = [tollLine, insurance];

export const plaza = (id: string, plaza: string, amount: number, toll_date: string, over: Record<string, unknown> = {}) => ({
  id,
  plaza,
  network: 'ezpass',
  amount,
  toll_date,
  settlement_id: 's-acme' as string | null,
  source: 'settlement',
  truck_id: null as string | null,
  ...over,
});

// The toll line's own breakdown (40.00).
export const plazas = [plaza('t1', 'HCTRA', 15, '2026-10-18'), plaza('t2', 'NJTP', 15, '2026-10-19'), plaza('t3', 'HCTRA', 10, '2026-10-20')];
export const ownToll = { id: 't-own', plaza: 'PA TPK', network: 'other', amount: 12.4, toll_date: '2026-10-21', settlement_id: null, source: 'manual', truck_id: null };
export const tolls = [...plazas, ownToll];

export const BEFORE = { expenses: 292.4, profit: 2707.6, bridgeDifference: -40 };
export const AFTER = { expenses: 252.4, profit: 2747.6, bridgeDifference: 0 };
