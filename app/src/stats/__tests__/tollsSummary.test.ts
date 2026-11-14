// TOLLS & FEES SCREEN (owner 2026-11-13): the owner's real rows give
// tolls & fees 709.47, scales 118.00, total 827.47 in every period that
// holds them; the itemized tolls rows never count on top of their line.
import { buildTollsSummary, tollKindOf, type TollsDeductionIn, type TollsSettlementIn, type TollsTableIn } from '@/src/stats/tollsSummary';

const NOW = new Date(2026, 10, 13); // 2026-11-13
const PRIME = 'PRIME INC';

const settlements: TollsSettlementIn[] = [
  { id: 's0807', week_ending: '2026-08-07', carrier: PRIME },
  { id: 's0821', week_ending: '2026-08-21', carrier: PRIME },
  { id: 's0904', week_ending: '2026-09-04', carrier: PRIME },
  { id: 's0918', week_ending: '2026-09-18', carrier: PRIME },
  { id: 's1002', week_ending: '2026-10-02', carrier: PRIME },
  { id: 's1016', week_ending: '2026-10-16', carrier: PRIME },
];

let n = 0;
const ded = (settlement_id: string | null, description: string, amount: number, over: Partial<TollsDeductionIn> = {}): TollsDeductionIn => ({
  id: `d${++n}`,
  category: 'Tolls & Scales',
  description,
  amount,
  ded_date: over.ded_date ?? '2026-09-10',
  settlement_id,
  source: settlement_id ? 'settlement' : 'import',
  ...over,
});
const toll = (settlement_id: string | null, plaza: string, amount: number, toll_date: string, source = 'settlement'): TollsTableIn => ({
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
const deductions: TollsDeductionIn[] = [
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
const tolls: TollsTableIn[] = [
  ...[8, 8, 8, 8, 8, 8, 8, 10.72].map((a, i) => toll('s0918', i % 2 ? 'NJTP' : 'HCTRA', a, '2026-09-0' + (i + 1))),
  toll('s0807', 'Transponder Fee', 0.25, '2026-08-07'),
  toll('s0821', 'Transponder Fee', 0.25, '2026-08-21'),
  toll('s0904', 'Transponder Fee', 0.25, '2026-09-04'),
];

const build = (over: Partial<Parameters<typeof buildTollsSummary>[0]> = {}) =>
  buildTollsSummary({ deductions, tolls, settlements, period: 'all', now: NOW, ...over });

test('the owner\'s numbers: tolls & fees 709.47, scales 118.00, total 827.47 (All, YTD)', () => {
  for (const period of ['all', 'ytd'] as const) {
    const s = build({ period });
    expect([s.tolls, s.scales, s.total]).toEqual([709.47, 118, 827.47]);
  }
  expect(tolls.reduce((a, t) => a + (t.amount ?? 0), 0)).toBeCloseTo(67.47, 2);
});

test('no double count: tolls rows of a settlement with a toll line are its breakdown, never in the total', () => {
  const s = build();
  expect(s.entries.filter((e) => e.table === 'tolls')).toHaveLength(0);
  const line0918 = s.entries.find((e) => e.description.startsWith('EZ EZ FAST LN TOLL0024'))!;
  // Partial breakdown: 66.72 itemized under a 356.69 line; the line stays 356.69.
  expect(line0918.amount).toBe(356.69);
  expect(line0918.breakdown).toHaveLength(8);
  expect(line0918.breakdown.reduce((a, b) => a + b.amount, 0)).toBeCloseTo(66.72, 2);
  expect(line0918.date).toBe('2026-09-18');
});

test('the three 0.25 transponder fees duplicate their settlement\'s 0.25 toll line: counted once', () => {
  const s = build();
  const quarters = s.entries.filter((e) => e.amount === 0.25);
  expect(quarters.map((e) => [e.table, e.date, e.breakdown.length])).toEqual([
    ['deductions', '2026-09-04', 1],
    ['deductions', '2026-08-21', 1],
    ['deductions', '2026-08-07', 1],
  ]);
});

test('a hand-entered toll (no settlement) and a settlement without a toll line count; marked paid by me / withheld', () => {
  const extra = [toll(null, 'I-90 plaza', 12.4, '2026-11-01', 'manual'), toll('s1016', 'NJTP', 3.1, '2026-10-14')];
  const s = build({ tolls: [...tolls, ...extra] });
  // s1016 has only drivewyze/weight lines... its drivewyze line IS a toll/fee line: covered.
  expect(s.total).toBe(r(827.47 + 12.4));
  const manual = s.entries.find((e) => e.description === 'I-90 plaza')!;
  expect([manual.table, manual.withheld, manual.kind, manual.date]).toEqual(['tolls', false, 'tolls', '2026-11-01']);
  // A settlement with only weight-ticket lines: its tolls row counts.
  const s2 = buildTollsSummary({
    deductions: [ded('sX', 'WA ADV FOR WEIGHT TICKETS', 17.5)],
    tolls: [toll('sX', 'NJTP', 3.1, '2026-10-14')],
    settlements: [{ id: 'sX', week_ending: '2026-10-16', carrier: PRIME }],
    period: 'all',
    now: NOW,
  });
  expect([s2.tolls, s2.scales, s2.total]).toEqual([3.1, 17.5, 20.6]);
  const t = s2.entries.find((e) => e.table === 'tolls')!;
  expect([t.withheld, t.carrier, t.date]).toEqual([true, PRIME, '2026-10-16']);
  const own = build().entries.filter((e) => !e.withheld);
  expect(own.map((e) => e.amount)).toEqual([15.25, 15.25]);
});

test('period: settlement rows by week ending, own rows by their own date', () => {
  // This Month (November): only the 11/02 CAT Scale ticket.
  expect([build({ period: 'thisMonth' }).total, build({ period: 'thisMonth' }).scales]).toEqual([15.25, 15.25]);
  // 3M (from 2026-08-15): drops only 08/07's 0.25 line.
  expect(build({ period: '3M' }).total).toBe(827.22);
  // A withheld line dated before its week ending follows the week ending.
  const s = buildTollsSummary({
    deductions: [ded('sN', 'EZ EZ FAST LN TOLL0003', 9, { ded_date: '2026-10-29' })],
    tolls: [],
    settlements: [{ id: 'sN', week_ending: '2026-11-06', carrier: PRIME }],
    period: 'thisMonth',
    now: NOW,
  });
  expect(s.total).toBe(9);
});

test('the scales rule', () => {
  expect(tollKindOf('WA ADV FOR WEIGHT TICKETS')).toBe('scales');
  expect(tollKindOf('CAT Scale weigh ticket')).toBe('scales');
  expect(tollKindOf('SCALES')).toBe('scales');
  expect(tollKindOf('PW DRVWYZE WGH STN')).toBe('tolls');
  expect(tollKindOf('EZ EZ FAST LN TOLL0024 thru 09/09')).toBe('tolls');
  expect(tollKindOf('Transponder Fee')).toBe('tolls');
  expect(tollKindOf(null)).toBe('tolls');
});

function r(x: number) {
  return Math.round(x * 100) / 100;
}
