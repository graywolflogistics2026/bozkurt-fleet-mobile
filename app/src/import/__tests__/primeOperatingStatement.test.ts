import {
  isPrimeCarrier,
  checkPrimeYtdReconciliation,
  readPrimeYtdSnapshotFromParsedJson,
  findMostRecentPrimeYtdSnapshot,
  filterToPrimeSettlementSubledger,
  type PrimeYtdSnapshot,
} from '@/src/import/primeOperatingStatement';
import { computeKpis } from '@/src/stats/kpi';

// The weekly check of the Prime statement page (every line, every printed
// subtotal, the deposit) is tested in settlementStatement.test.ts. This
// file covers the carrier gate, the standing YTD check and the Prime
// sub-ledger filter.

// W/E 8/21 YTD column: YTD SETTLEMENT TO OPERATOR 8,099.66.
const YTD_OPERATING = { ytdTotalRevenue: 24425.98, ytdMiles: 10146, ytdTotalStatement: 8099.66, ytdSettlementToOperator: 8099.66, weeksInService: 5 };

describe('isPrimeCarrier', () => {
  test('matches Prime Inc in any real-world spelling', () => {
    expect(isPrimeCarrier('Prime Inc')).toBe(true);
    expect(isPrimeCarrier('PRIME INC')).toBe(true);
    expect(isPrimeCarrier('Prime, Inc.')).toBe(true);
    expect(isPrimeCarrier('prime inc')).toBe(true);
  });

  test('any other carrier, or none, is not Prime', () => {
    expect(isPrimeCarrier('Landstar')).toBe(false);
    expect(isPrimeCarrier('Schneider National')).toBe(false);
    expect(isPrimeCarrier('Werner')).toBe(false);
    expect(isPrimeCarrier(null)).toBe(false);
    expect(isPrimeCarrier(undefined)).toBe(false);
    expect(isPrimeCarrier('')).toBe(false);
    expect(isPrimeCarrier('Prime Logistics Partners')).toBe(false);
  });
});

describe('checkPrimeYtdReconciliation — standing YTD check (revenue, miles)', () => {
  const primeYtd: PrimeYtdSnapshot = { revenue: 24425.98, miles: 10146, totalStatement: 8099.66, settlementToOperator: 8099.66, asOfWeekEnding: '2026-08-21' };

  test('agrees within tolerance — no mismatch', () => {
    expect(checkPrimeYtdReconciliation({ revenue: 24425.98, miles: 10146 }, primeYtd)).toEqual([]);
  });

  test('a missing week — revenue and miles diverge beyond tolerance', () => {
    expect(checkPrimeYtdReconciliation({ revenue: 19642.23, miles: 7819 }, primeYtd)).toEqual([
      { field: 'revenue', ours: 19642.23, prime: 24425.98 },
      { field: 'miles', ours: 7819, prime: 10146 },
    ]);
  });

  test('deposits are never compared here (informational only, never a warning — owner decision 2026-10-13)', () => {
    expect(checkPrimeYtdReconciliation({ revenue: 24425.98, miles: 10146 }, { ...primeYtd, totalStatement: 1 })).toEqual([]);
  });

  test('null snapshot — never a guess', () => {
    expect(checkPrimeYtdReconciliation({ revenue: 1, miles: 1 }, null)).toEqual([]);
  });
});

describe('readPrimeYtdSnapshotFromParsedJson', () => {
  test('reads the YTD totals', () => {
    const parsedJson = { settlement: { carrier: 'PRIME INC.', operating: YTD_OPERATING } };
    expect(readPrimeYtdSnapshotFromParsedJson(parsedJson, '2026-08-21')).toEqual({
      revenue: 24425.98,
      miles: 10146,
      totalStatement: 8099.66,
      settlementToOperator: 8099.66,
      asOfWeekEnding: '2026-08-21',
    });
  });

  test('reads a settlement imported under an older layout (ytdRevenue / ytdNet keys)', () => {
    const parsedJson = { settlement: { carrier: 'Prime Inc', operating: { ytdRevenue: 19642.23, ytdMiles: 7819, ytdNet: 6214.93 } } };
    expect(readPrimeYtdSnapshotFromParsedJson(parsedJson, '2026-08-14')).toEqual({
      revenue: 19642.23,
      miles: 7819,
      totalStatement: 6214.93,
      settlementToOperator: 0,
      asOfWeekEnding: '2026-08-14',
    });
  });

  test('a non-Prime carrier inside the SAME parsed_json — returns null', () => {
    expect(readPrimeYtdSnapshotFromParsedJson({ settlement: { carrier: 'Landstar', operating: YTD_OPERATING } }, '2026-08-21')).toBeNull();
  });

  test('no operating section, no settlement, or null parsed_json — all return null', () => {
    expect(readPrimeYtdSnapshotFromParsedJson({ settlement: { carrier: 'Prime Inc' } }, '2026-08-01')).toBeNull();
    expect(readPrimeYtdSnapshotFromParsedJson({}, '2026-08-01')).toBeNull();
    expect(readPrimeYtdSnapshotFromParsedJson(null, '2026-08-01')).toBeNull();
  });
});

describe('findMostRecentPrimeYtdSnapshot', () => {
  test('picks the LATEST Prime settlement that actually has operating data', () => {
    const documentsById = new Map([
      ['doc-old', { parsed_json: { settlement: { carrier: 'Prime Inc', operating: { ytdTotalRevenue: 19642.23, ytdMiles: 7819 } } } }],
      ['doc-new', { parsed_json: { settlement: { carrier: 'Prime Inc', operating: YTD_OPERATING } } }],
      ['doc-other', { parsed_json: { settlement: { carrier: 'Landstar', operating: { ytdTotalRevenue: 5000, ytdMiles: 4000 } } } }],
    ]);
    const settlements = [
      { carrier: 'Prime Inc', week_ending: '2026-08-14', document_id: 'doc-old' },
      { carrier: 'Prime Inc', week_ending: '2026-08-21', document_id: 'doc-new' },
      { carrier: 'Landstar', week_ending: '2026-08-28', document_id: 'doc-other' },
    ];
    expect(findMostRecentPrimeYtdSnapshot(settlements, documentsById)?.asOfWeekEnding).toBe('2026-08-21');
  });

  test('no settlements at all — null', () => {
    expect(findMostRecentPrimeYtdSnapshot([], new Map())).toBeNull();
  });

  test.each(['Landstar', 'Werner', '', null])('never picks a non-Prime settlement (carrier=%p)', (carrier) => {
    const documentsById = new Map([['doc-1', { parsed_json: { settlement: { carrier, operating: YTD_OPERATING } } }]]);
    expect(
      findMostRecentPrimeYtdSnapshot([{ carrier: carrier as string | null, week_ending: '2026-08-21', document_id: 'doc-1' }], documentsById)
    ).toBeNull();
  });
});

describe('filterToPrimeSettlementSubledger — LAYER 1 isolation', () => {
  const primeSettlement = { id: 'sett-prime-1', carrier: 'Prime Inc' };
  const otherSettlement = { id: 'sett-other-1', carrier: 'Landstar' };

  test('keeps only rows tied to a Prime settlement — deductions and reimbursements alike', () => {
    const result = filterToPrimeSettlementSubledger(
      [primeSettlement, otherSettlement],
      [
        { id: 'd1', settlement_id: 'sett-prime-1' },
        { id: 'd2', settlement_id: null },
        { id: 'd3', settlement_id: 'sett-other-1' },
      ],
      [],
      [],
      [],
      [
        { id: 'r1', settlement_id: 'sett-prime-1' },
        { id: 'r2', settlement_id: null },
      ]
    );
    expect(result.settlements).toEqual([primeSettlement]);
    expect(result.deductions.map((d) => d.id)).toEqual(['d1']);
    expect(result.reimbursements.map((r) => r.id)).toEqual(['r1']);
  });

  test('a non-Prime settlement on the same account never makes the YTD check flag a mismatch', () => {
    const primeYtd: PrimeYtdSnapshot = { revenue: 4783.75, miles: 2327, totalStatement: 1884.73, settlementToOperator: 1884.73, asOfWeekEnding: '2026-08-21' };
    const rows = [
      { id: 'sett-prime-1', carrier: 'Prime Inc', truck_id: null, week_ending: '2026-08-21', gross: 4783.75, net: 1884.36, miles: 2327 },
      { id: 'sett-other-1', carrier: 'Landstar', truck_id: null, week_ending: '2026-08-14', gross: 3000, net: 2000, miles: 1500 },
    ];
    const base = { trucks: [], loads: [], deductions: [], fuelPurchases: [], maintenanceRecords: [], tolls: [], reimbursements: [], truckScope: null, window: null };
    const scope = filterToPrimeSettlementSubledger(rows, [], [], [], [], []);
    const kpi = computeKpis({ ...base, settlements: scope.settlements });
    expect(checkPrimeYtdReconciliation({ revenue: kpi.gross, miles: kpi.miles.total }, primeYtd)).toEqual([]);
    const unfiltered = computeKpis({ ...base, settlements: rows });
    expect(checkPrimeYtdReconciliation({ revenue: unfiltered.gross, miles: unfiltered.miles.total }, primeYtd).map((m) => m.field)).toEqual([
      'revenue',
      'miles',
    ]);
  });
});
