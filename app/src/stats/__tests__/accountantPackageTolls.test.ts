// ACCOUNTANT PACKAGE TOLLS (owner 2026-11-14): the Tolls & Fees screen's
// rule (src/stats/tollsSummary.ts), shared. On the owner's data: Withheld
// 796.97 (was 864.44), Out of pocket 30.50, Combined 827.47 (was 894.94),
// inside Combined tolls & fees 709.47 + scales 118.00.
import { buildLineItems, buildScheduleCTotals, groupLineItemsByScheduleCBucket, type AccountantScope } from '@/src/stats/accountantPackage';
import { ded, deductions, settlements, toll, tolls } from './fixtures/ownerTolls';

const r2 = (n: number) => Math.round(n * 100) / 100;
const items = (scope: AccountantScope, month: number | null = null, over: { deductions?: unknown[]; tolls?: unknown[] } = {}) =>
  buildLineItems((over.deductions ?? deductions) as never, [], [], (over.tolls ?? tolls) as never, 2026, month, scope, settlements);
// The Tolls & Scales rows only (the fixture also holds a non-toll line).
const sum = (scope: AccountantScope, month: number | null = null, over = {}) => r2(items(scope, month, over).filter((i) => i.deductible && i.category === 'Tolls & Scales').reduce((a, i) => a + i.amount, 0));

test('the owner\'s numbers: Withheld 796.97, Out of pocket 30.50, Combined 827.47', () => {
  expect([sum('withheld'), sum('outOfPocket'), sum('combined')]).toEqual([796.97, 30.5, 827.47]);
});

test('Combined: the Tolls & Scales category is split tolls & fees 709.47 / scales 118.00', () => {
  const li = items('combined');
  const totals = buildScheduleCTotals(li, []);
  const tollsCat = groupLineItemsByScheduleCBucket(li, totals, []).find((c) => c.tollsSplit)!;
  expect([r2(tollsCat.items.reduce((a, i) => a + i.amount, 0)), tollsCat.tollsSplit]).toEqual([827.47, { tolls: 709.47, scales: 118 }]);
  // Other categories carry no split.
  expect(groupLineItemsByScheduleCBucket(li, totals, []).filter((c) => c.tollsSplit)).toHaveLength(1);
});

test('itemized tolls rows of a settlement with a toll line are never listed (partial 09/18 breakdown, the three 0.25 fees)', () => {
  for (const scope of ['withheld', 'combined'] as const) {
    expect(items(scope).filter((i) => i.kind === 'toll')).toHaveLength(0);
    expect(items(scope).filter((i) => i.amount === 0.25)).toHaveLength(3);
    expect(items(scope).find((i) => i.description.startsWith('EZ EZ FAST LN TOLL0024'))!.amount).toBe(356.69);
  }
});

test('a hand-entered toll without a settlement is listed and counted (Out of pocket and Combined)', () => {
  const extra = { tolls: [...tolls, toll(null, 'I-90 plaza', 12.4, '2026-11-01', 'manual')] };
  expect([sum('withheld', null, extra), sum('outOfPocket', null, extra), sum('combined', null, extra)]).toEqual([796.97, 42.9, 839.87]);
  const row = items('outOfPocket', 11, extra).find((i) => i.kind === 'toll')!;
  expect([row.date, row.origin, row.tollKind]).toEqual(['2026-11-01', 'manual', 'tolls']);
});

test('settlement toll rows are dated by week ending, own rows by their own date', () => {
  // The fixture's withheld lines carry ded_date 2026-09-10; their weeks end
  // 08/07 ... 10/16. September holds 09/04 (0.25) and 09/18 (356.69) only.
  expect(sum('withheld', 9)).toBe(356.94);
  expect(sum('withheld', 8)).toBe(0.5);
  expect(sum('withheld', 10)).toBe(439.53);
  // Own CAT Scale tickets: 10/05 and 11/02.
  expect([sum('outOfPocket', 10), sum('outOfPocket', 11)]).toEqual([15.25, 15.25]);
  // A line printed in October on the week ending 11/06 belongs to November.
  const late = { deductions: [ded('s1106', 'EZ EZ FAST LN TOLL0003', 9, { ded_date: '2026-10-29' })] };
  const withWeek = buildLineItems(late.deductions as never, [], [], [], 2026, 11, 'withheld', [{ id: 's1106', week_ending: '2026-11-06' }]);
  expect(withWeek.map((i) => [i.date, i.amount])).toEqual([['2026-11-06', 9]]);
  // Without the settlements list (older callers) a row keeps its own date.
  expect(buildLineItems(late.deductions as never, [], [], [], 2026, 10, 'withheld').map((i) => i.date)).toEqual(['2026-10-29']);
});

test('non-toll deductions keep their own date', () => {
  const other = ded('s0918', 'TRAILER RENTAL', 50, { category: 'Truck & Trailer Rental', ded_date: '2026-09-10' });
  expect(buildLineItems([other] as never, [], [], [], 2026, 9, 'withheld', settlements).map((i) => [i.date, i.tollKind])).toEqual([['2026-09-10', undefined]]);
});
