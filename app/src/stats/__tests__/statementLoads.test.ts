import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { statementLoadCount, statementOnlyLoadWeeks, type StatementLoadDocument, type StatementLoadSettlement } from '@/src/stats/statementLoads';
import { filterLoadsByTruckScope } from '@/src/stats/loadsScope';
import { mapSettlement } from '@/src/import/mapExtraction';
import type { Extraction } from '@/src/import/types';

// The owner's live shape (read-only SELECT, 2026-11-24), 15 latest weeks:
// 8 saved with "line details not saved" (25 printed loads, 0 rows), 6 saved
// with their lines (rows = loads; 08-22 has only a mileless Prime line), an
// extra mileless line in 08-14, plus one settlement with no document.
const NOT_SAVED: [string, number][] = [
  ['2026-11-20', 4],
  ['2026-10-23', 2],
  ['2026-10-16', 4],
  ['2026-10-09', 3],
  ['2026-10-02', 3],
  ['2026-09-25', 2],
  ['2026-09-11', 4],
  ['2026-08-14', 3],
];
const SAVED: [string, number][] = [
  ['2026-11-13', 3],
  ['2026-11-06', 2],
  ['2026-10-30', 3],
  ['2026-09-18', 2],
  ['2026-09-04', 3],
  ['2026-08-22', 0],
];
const load = (i: number, miles = 500) => ({ order: `O${i}`, from: 'Springfield, MO', to: `City ${i}`, loadedMiles: miles, emptyMiles: 40, revenue: 1000 + i });

function fixture() {
  const settlements: StatementLoadSettlement[] = [];
  const documents: StatementLoadDocument[] = [];
  const loadRows: { settlement_id: string | null }[] = [];
  for (const [we, n] of NOT_SAVED) {
    const loads: Record<string, unknown>[] = Array.from({ length: n }, (_, i) => load(i));
    if (we === '2026-08-14') loads.push({ order: '4845329', from: '', to: '', loadedMiles: 0, emptyMiles: 0, revenue: -47.34 });
    settlements.push({ id: `s-${we}`, week_ending: we, truck_id: 't1', carrier: 'Prime Inc', document_id: `d-${we}`, statement: { linesNotSaved: true } });
    documents.push({ id: `d-${we}`, parsed_json: { settlement: { carrier: 'Prime Inc', loads } } });
  }
  for (const [we, n] of SAVED) {
    const loads: Record<string, unknown>[] = Array.from({ length: n }, (_, i) => load(i));
    if (we === '2026-08-22') loads.push({ order: '5000001', from: '', to: '', loadedMiles: 0, emptyMiles: 0, revenue: 191.4 });
    settlements.push({ id: `s-${we}`, week_ending: we, truck_id: 't1', carrier: 'Prime Inc', document_id: `d-${we}`, statement: {} });
    documents.push({ id: `d-${we}`, parsed_json: { settlement: { carrier: 'Prime Inc', loads } } });
    for (let i = 0; i < n; i++) loadRows.push({ settlement_id: `s-${we}` });
  }
  settlements.push({ id: 's-nodoc', week_ending: '2026-08-07', truck_id: 't1', carrier: 'Prime Inc', document_id: null, statement: { linesNotSaved: true } });
  return { settlements, documents, loadRows };
}

describe('statementOnlyLoadWeeks (view-only statement loads)', () => {
  test('owner live shape: the 8 not-saved weeks with 25 loads, newest first; saved weeks add nothing', () => {
    const { settlements, documents, loadRows } = fixture();
    const weeks = statementOnlyLoadWeeks(settlements, documents, loadRows);
    expect(weeks.map((w) => [w.weekEnding, w.loads.length])).toEqual(NOT_SAVED);
    expect(statementLoadCount(weeks)).toBe(25);
  });

  test('Prime loads without miles are hidden (08-14 keeps 3 of 4)', () => {
    const { settlements, documents, loadRows } = fixture();
    const aug14 = statementOnlyLoadWeeks(settlements, documents, loadRows).find((w) => w.weekEnding === '2026-08-14');
    expect(aug14?.loads.map((l) => l.order)).toEqual(['O0', 'O1', 'O2']);
  });

  test('fields: order, origin, destination, miles; no revenue line for the order means no amount', () => {
    const { settlements, documents, loadRows } = fixture();
    expect(statementOnlyLoadWeeks(settlements, documents, loadRows)[0].loads[0]).toEqual({
      key: 's-2026-11-20:0',
      order: 'O0',
      origin: 'Springfield, MO',
      destination: 'City 0',
      loadedMiles: 500,
      emptyMiles: 40,
      revenueFromLines: null,
    });
  });

  test('non-Prime carrier: every listed load is shown, mileless included', () => {
    const settlements: StatementLoadSettlement[] = [{ id: 's', week_ending: '2026-11-20', truck_id: null, carrier: 'Acme Freight', document_id: 'd', statement: { linesNotSaved: true } }];
    const documents = [{ id: 'd', parsed_json: { settlement: { carrier: 'Acme Freight', loads: [load(1), { order: 'X', loadedMiles: 0, emptyMiles: 0, revenue: 25 }] } } }];
    expect(statementOnlyLoadWeeks(settlements, documents, [])[0].loads).toHaveLength(2);
  });

  test('a not-saved week that already has load rows shows nothing extra', () => {
    const { settlements, documents } = fixture();
    expect(statementOnlyLoadWeeks(settlements, documents, [{ settlement_id: 's-2026-11-20' }]).map((w) => w.weekEnding)).not.toContain('2026-11-20');
  });

  test('no document, a missing document, no loads array or no parsed_json: nothing', () => {
    const s: StatementLoadSettlement = { id: 'a', week_ending: '2026-11-20', truck_id: null, carrier: null, document_id: 'gone', statement: { linesNotSaved: true } };
    expect(statementOnlyLoadWeeks([s], [], [])).toEqual([]);
    expect(statementOnlyLoadWeeks([{ ...s, document_id: null }], [], [])).toEqual([]);
    expect(statementOnlyLoadWeeks([s], [{ id: 'gone', parsed_json: { settlement: {} } }], [])).toEqual([]);
    expect(statementOnlyLoadWeeks([s], [{ id: 'gone', parsed_json: null }], [])).toEqual([]);
  });

  test('a week saved with its lines, or with no stored statement, shows nothing', () => {
    const s: StatementLoadSettlement = { id: 'a', week_ending: '2026-11-20', truck_id: null, carrier: 'Prime Inc', document_id: 'd', statement: null };
    const docs = [{ id: 'd', parsed_json: { settlement: { loads: [load(1)] } } }];
    expect(statementOnlyLoadWeeks([s], docs, [])).toEqual([]);
    expect(statementOnlyLoadWeeks([{ ...s, statement: { linesNotSaved: false } }], docs, [])).toEqual([]);
  });

  test('truck filter: the same rule as real loads (another truck hidden, no truck always shown)', () => {
    const settlements: StatementLoadSettlement[] = [
      { id: 'a', week_ending: '2026-11-20', truck_id: 't1', carrier: 'Prime Inc', document_id: 'da', statement: { linesNotSaved: true } },
      { id: 'b', week_ending: '2026-11-20', truck_id: 't2', carrier: 'Prime Inc', document_id: 'db', statement: { linesNotSaved: true } },
      { id: 'c', week_ending: '2026-11-13', truck_id: null, carrier: 'Prime Inc', document_id: 'dc', statement: { linesNotSaved: true } },
    ];
    const documents = ['da', 'db', 'dc'].map((id) => ({ id, parsed_json: { settlement: { loads: [load(1)] } } }));
    const weeks = statementOnlyLoadWeeks(settlements, documents, []);
    expect(filterLoadsByTruckScope(weeks, settlements, 't1').map((w) => w.settlementId)).toEqual(['a', 'c']);
    expect(filterLoadsByTruckScope(weeks, settlements, null)).toHaveLength(3);
  });
});

// REVENUE FROM THE WEEK'S REVENUE LINES (owner 2026-11-25, line-details
// gate proposal stage 1). The reader's per-load figure is never shown.
describe('statement load revenue from the revenue lines', () => {
  const notSaved = (id: string, we: string): StatementLoadSettlement => ({
    id,
    week_ending: we,
    truck_id: 't1',
    carrier: 'Prime Inc',
    document_id: 'd-' + id,
    statement: { linesNotSaved: true },
  });

  // Week ending 2026-10-02 (owner's stored reading): the reader's loads list
  // is the TRIP column (sums to 3,410.09 = 2,455.26 / 0.72); the TRIP
  // REVENUE lines are the owner's amounts and sum to REVENUE FROM PRIME INC.
  const oct02Settlement = {
    carrier: 'PRIME INC.',
    loads: [
      { order: '5150001', from: 'Joplin, MO', to: 'Dallas, TX', loadedMiles: 380, emptyMiles: 20, revenue: 2156.01 },
      { order: '5150002', from: 'Dallas, TX', to: 'Tulsa, OK', loadedMiles: 260, emptyMiles: 15, revenue: 879.26 },
      { order: '5150003', from: 'Tulsa, OK', to: 'Springfield, MO', loadedMiles: 180, emptyMiles: 10, revenue: 374.82 },
    ],
    revenueItems: [
      { code: 'RV', desc: 'TRIP REVENUE', order: '5150001', amount: 1552.33 },
      { code: 'RV', desc: 'FUEL SURCHARGE', order: '5150001', amount: 210.5 },
      { code: 'RV', desc: 'TRIP REVENUE', order: '5150002', amount: 633.07 },
      { code: 'RV', desc: 'TRIP REVENUE', order: '5150003', amount: '269.86' },
    ],
  };

  test('10-02: amounts are the TRIP REVENUE lines (2,455.26), not the reader loads list (3,410.09)', () => {
    const weeks = statementOnlyLoadWeeks([notSaved('oct02', '2026-10-02')], [{ id: 'd-oct02', parsed_json: { settlement: oct02Settlement } }], []);
    const loads = weeks[0].loads;
    expect(oct02Settlement.loads.reduce((sum, l) => sum + l.revenue, 0)).toBeCloseTo(3410.09, 2);
    expect(loads.map((l) => l.revenueFromLines)).toEqual([1552.33, 633.07, 269.86]);
    expect(loads.reduce((sum, l) => sum + (l.revenueFromLines ?? 0), 0)).toBeCloseTo(2455.26, 2);
  });

  test('several load revenue lines of one order are summed; a load with no line shows no amount', () => {
    const settlement = {
      carrier: 'Prime Inc',
      loads: [
        { order: 'A1', loadedMiles: 500, emptyMiles: 0, revenue: 9999 },
        { order: 'B2', loadedMiles: 300, emptyMiles: 0, revenue: 8888 },
        { order: '', loadedMiles: 100, emptyMiles: 0, revenue: 7777 },
      ],
      revenueItems: [
        { desc: 'TRIP REVENUE', order: 'A1', amount: 1000 },
        { desc: 'LINEHAUL', order: 'A1', amount: -47.34 },
        { desc: 'STOP OFF PAY', order: 'B2', amount: 50 },
      ],
    };
    const loads = statementOnlyLoadWeeks([notSaved('x', '2026-10-09')], [{ id: 'd-x', parsed_json: { settlement } }], [])[0].loads;
    expect(loads.map((l) => l.revenueFromLines)).toEqual([952.66, null, null]);
  });

  test('another carrier: the Prime line rule does not apply, so no amount is shown', () => {
    const settlement = {
      carrier: 'Acme Freight',
      loads: [{ order: 'A1', loadedMiles: 500, emptyMiles: 0, revenue: 1200 }],
      revenueItems: [{ desc: 'TRIP REVENUE', order: 'A1', amount: 1200 }],
    };
    const s = { ...notSaved('acme', '2026-10-09'), carrier: 'Acme Freight' };
    expect(statementOnlyLoadWeeks([s], [{ id: 'd-acme', parsed_json: { settlement } }], [])[0].loads[0].revenueFromLines).toBeNull();
  });

  // Week ending 2026-11-13 (owner's saved, passing week): the loads check
  // passed, so the save stores each load's reader figure. Those figures and
  // the TRIP REVENUE lines are the same amounts, order by order: the view
  // shows what a real load row carries.
  test('11-13: the amount per order equals what the save stores on the real load row', () => {
    const nov13 = {
      carrier: 'PRIME INC.',
      weekEnding: '2026-11-13',
      loads: [
        { order: '5247312', from: 'Springfield, MO', to: 'Laredo, TX', loadedMiles: 900, emptyMiles: 40, revenue: 1884.74 },
        { order: '5248723', from: 'Laredo, TX', to: 'Memphis, TN', loadedMiles: 780, emptyMiles: 30, revenue: 1589.11 },
        { order: '5256356', from: 'Memphis, TN', to: 'Fontana, CA', loadedMiles: 1800, emptyMiles: 60, revenue: 3614.23 },
      ],
      revenueItems: [
        { code: 'RV', desc: 'TRIP REVENUE', order: '5247312', amount: 1884.74 },
        { code: 'RV', desc: 'TRIP REVENUE', order: '5248723', amount: 1589.11 },
        { code: 'RV', desc: 'TRIP REVENUE', order: '5256356', amount: 3614.23 },
      ],
      operating: { lines: [{ section: 'revenue', label: 'REVENUE FROM PRIME INC.', amount: 7088.08 }] },
    };
    const saved = mapSettlement({ docType: 'settlement', settlement: nov13 } as unknown as Extraction, 'user', 't1').loads;
    const shown = statementOnlyLoadWeeks([notSaved('nov13', '2026-11-13')], [{ id: 'd-nov13', parsed_json: { settlement: nov13 } }], [])[0].loads;
    expect(saved.map((l) => [l.order_number, l.revenue])).toEqual([
      ['5247312', 1884.74],
      ['5248723', 1589.11],
      ['5256356', 3614.23],
    ]);
    expect(shown.map((l) => [l.order, l.revenueFromLines])).toEqual(saved.map((l) => [l.order_number, l.revenue]));
    expect(shown.reduce((sum, l) => sum + (l.revenueFromLines ?? 0), 0)).toBeCloseTo(7088.08, 2);
  });
});

// ISOLATION (owner 2026-11-24): view-only items never reach a calculation,
// stats, export or backup module. Only the two screens import this file.
describe('statementLoads isolation', () => {
  const ROOT = join(__dirname, '..', '..', '..');
  const ALLOWED = ['app/(tabs)/more/loads.tsx', 'app/(tabs)/more/settlements.tsx'];
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '__tests__') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }
  test('only the Loads screen and the settlement detail import it', () => {
    const importers = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'app'))]
      .filter((p) => /statementLoads'/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(ROOT, p).split(sep).join('/'));
    expect(importers.filter((f) => !ALLOWED.includes(f))).toEqual([]);
  });
});
