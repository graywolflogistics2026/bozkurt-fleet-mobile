// 08/28 DEVICE TEST, finding 3 (owner 2026-11-13): a week with no load
// prints TOTAL MILES 0 / 0 / 0. Zero is a number: the card shows 0 miles,
// the week has a known split (0 loaded, 0 empty), and Home says "No loaded
// miles this week" with Revenue/Mile and Cost/Mile n/a — never "No miles
// recorded yet" or "weeks without a loaded/empty breakdown".
import { PRIME_13_WEEKS } from '@/src/settlementReader/__tests__/fixtures/prime13Weeks';
import { LINES_0828, printedFromWeek } from '@/src/settlementReader/__tests__/fixtures/printedReading';
import { readThrough } from '@/src/settlementReader/__tests__/fixtures/runReader';
import { readMilesSplit, milesSplitUpdate } from '../milesSplit';
import { evaluateSettlementGate, headlineFromSettlement } from '../settlementGate';
import { sanitizeExtraction } from '../sanitizeExtraction';
import { calcMiles } from '@/src/stats/miles';

const ZERO_LINES = [
  { label: 'LOADED MILES', miles: '0' },
  { label: 'EMPTY MILES', miles: '0' },
  { label: 'TOTAL MILES', miles: '0' },
];

describe('readMilesSplit: a printed 0 is a known split', () => {
  test('Prime, no load, TOTAL MILES 0 -> 0 / 0 from the statement', () => {
    expect(readMilesSplit({ carrier: 'PRIME INC.', loads: [], milesLines: ZERO_LINES })).toMatchObject({ loaded: 0, empty: 0, total: 0, source: 'statement' });
    expect(readMilesSplit({ carrier: 'PRIME INC.', loads: [], milesLines: [{ label: 'TOTAL MILES', miles: '0' }] })).toMatchObject({ loaded: 0, empty: 0, total: 0 });
  });
  test('nothing printed stays unknown; a cumulative 0 alone is not the week', () => {
    expect(readMilesSplit({ carrier: 'PRIME INC.', loads: [], milesLines: [] }).source).toBeNull();
    expect(readMilesSplit({ carrier: 'PRIME INC.', loads: [], milesLines: [{ label: 'MILES YTD', miles: '0' }] }).source).toBeNull();
  });
  test('another carrier printing only TOTAL MILES 0 -> 0 / 0', () => {
    expect(readMilesSplit({ carrier: 'ACME', loads: [], milesLines: [{ label: 'TOTAL MILES', miles: 0 }] })).toMatchObject({ loaded: 0, empty: 0, total: 0 });
  });
  test('the save writes 0 / 0', () => {
    expect(milesSplitUpdate(readMilesSplit({ carrier: 'PRIME INC.', loads: [], milesLines: ZERO_LINES }), null)).toMatchObject({ loaded_miles: 0, empty_miles: 0, miles_split_source: 'statement' });
  });
});

test('08/28 card headline: Miles 0 (0 loaded, 0 empty), not "—"', () => {
  const w = PRIME_13_WEEKS.find((x) => x.weekEnding === '2026-08-28')!;
  const tr = readThrough(printedFromWeek(w, { lines: LINES_0828 }), { pages: 9, lastContentPage: 6, cashFlowPrinted: true, importDate: '2026-08-29' });
  const gate = evaluateSettlementGate(sanitizeExtraction(tr.extraction!), { importDate: '2026-08-29' });
  expect(gate && gate.status !== 'fail' ? gate.headline : null).toMatchObject({ miles: 0, loadedMiles: 0, emptyMiles: 0 });
});

test('a stored 0 / 0 week shows 0 miles on the certify card', () => {
  expect(headlineFromSettlement({ week_ending: '2026-08-28', carrier: 'PRIME INC.', gross: 191.4, net: -213.96, miles: 0, loaded_miles: 0, empty_miles: 0 }, 436.04).miles).toBe(0);
  expect(headlineFromSettlement({ week_ending: '2026-08-28', carrier: 'PRIME INC.', gross: 191.4, net: -213.96, miles: 0 }, 436.04).miles).toBeNull();
});

describe('calcMiles: noLoadedMiles only when every week is a known 0', () => {
  const s = (id: string, week: string, loaded: number | null, empty: number | null, miles = 0) => ({ id, truck_id: 't', week_ending: week, miles, loaded_miles: loaded, empty_miles: empty });
  test('a printed zero week: no breakdown warning, no loaded miles', () => {
    const r = calcMiles([s('a', '2026-08-28', 0, 0)], []);
    expect(r).toMatchObject({ totalMiles: 0, weeksWithoutBreakdown: 0, noLoadedMiles: true });
  });
  test('miles unknown (no split) stays "no breakdown", not "no loaded miles"', () => {
    expect(calcMiles([s('a', '2026-08-28', null, null)], [])).toMatchObject({ weeksWithoutBreakdown: 1, noLoadedMiles: false });
  });
  test('a window with real miles is not "no loaded miles"', () => {
    expect(calcMiles([s('a', '2026-08-28', 0, 0), s('b', '2026-09-04', 1770, 274, 2044)], []).noLoadedMiles).toBe(false);
  });
});
