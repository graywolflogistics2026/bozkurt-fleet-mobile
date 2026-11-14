// The owner's real toll rows (read-only SQL, 2026-11-13), shared by the
// Tolls & Fees screen and Accountant Package tests. Totals: tolls & fees
// 709.47, scales 118.00, total 827.47; the tolls table alone 67.47.
import type { TollsDeductionIn, TollsSettlementIn, TollsTableIn } from '@/src/stats/tollsSummary';

export const NOW = new Date(2026, 10, 13); // 2026-11-13
export const PRIME = 'PRIME INC';

export const settlements: TollsSettlementIn[] = [
  { id: 's0807', week_ending: '2026-08-07', carrier: PRIME },
  { id: 's0821', week_ending: '2026-08-21', carrier: PRIME },
  { id: 's0904', week_ending: '2026-09-04', carrier: PRIME },
  { id: 's0918', week_ending: '2026-09-18', carrier: PRIME },
  { id: 's1002', week_ending: '2026-10-02', carrier: PRIME },
  { id: 's1016', week_ending: '2026-10-16', carrier: PRIME },
];

let n = 0;
export const ded = (settlement_id: string | null, description: string, amount: number, over: Partial<TollsDeductionIn> = {}): TollsDeductionIn => ({
  id: `d${++n}`,
  category: 'Tolls & Scales',
  description,
  amount,
  ded_date: over.ded_date ?? '2026-09-10',
  settlement_id,
  source: settlement_id ? 'settlement' : 'import',
  ...over,
});
export const toll = (settlement_id: string | null, plaza: string, amount: number, toll_date: string, source = 'settlement'): TollsTableIn => ({
  id: `t${++n}`,
  plaza,
  network: 'ezpass',
  amount,
  toll_date,
  settlement_id,
  source,
});

// 16 withheld lines = 796.97 (toll/fee 709.47 + weight tickets 87.50) and
// 2 own CAT Scale tickets 15.25 each.
export const deductions: TollsDeductionIn[] = [
  ded('s0918', 'EZ EZ FAST LN TOLL0024 thru 09/09', 356.69),
  ded('s0807', 'EZ EZ FAST LN TOLL0001', 0.25),
  ded('s0821', 'EZ EZ FAST LN TOLL0001', 0.25),
  ded('s0904', 'EZ EZ FAST LN TOLL0001', 0.25),
  ...[50, 50, 50, 50, 50, 50, 52.03].map((a, i) => ded(i < 4 ? 's1002' : 's1016', 'PW DRVWYZE WGH STN', a)),
  ...[17.5, 17.5, 17.5, 17.5, 17.5].map((a, i) => ded(i < 3 ? 's1002' : 's1016', 'WA ADV FOR WEIGHT TICKETS', a)),
  ded(null, 'CAT Scale weigh ticket', 15.25, { ded_date: '2026-10-05' }),
  ded(null, 'CAT Scale weigh ticket', 15.25, { ded_date: '2026-11-02' }),
  // Not a toll: another category never counts.
  ded('s0918', 'EZ PASS REFILL', 99, { category: 'Other' }),
];

// The tolls table: 11 rows = 67.47, all settlement rows.
export const tolls: TollsTableIn[] = [
  ...[8, 8, 8, 8, 8, 8, 8, 10.72].map((a, i) => toll('s0918', i % 2 ? 'NJTP' : 'HCTRA', a, '2026-09-0' + (i + 1))),
  toll('s0807', 'Transponder Fee', 0.25, '2026-08-07'),
  toll('s0821', 'Transponder Fee', 0.25, '2026-08-21'),
  toll('s0904', 'Transponder Fee', 0.25, '2026-09-04'),
];

