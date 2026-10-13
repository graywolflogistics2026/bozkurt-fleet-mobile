import {
  isPrimeCarrier,
  buildPrimeReconciliation,
  checkPrimeOperatingStatementWeekly,
  applyPrimeOperatingStatementCheck,
  checkPrimeYtdReconciliation,
  readPrimeYtdSnapshotFromParsedJson,
  findMostRecentPrimeYtdSnapshot,
  filterToPrimeSettlementSubledger,
  type PrimeYtdSnapshot,
} from '@/src/import/primeOperatingStatement';
import { computeKpis } from '@/src/stats/kpi';
import type { Extraction } from '@/src/import/types';

// The REAL layout (golden settlement pass, owner decision 2026-10-13),
// with the golden Prime settlement's own printed figures (unit 283940,
// week ending 2026-08-21 — pages 4-6 of GRWLLG-OY-PrimeInc6.pdf).
const GOLDEN_OPERATING = {
  weekMiles: 2327,
  weekRevenueFromPrime: 3345.12,
  weekExtraPay: 175,
  weekFuelSurchargeBill: 1210.04,
  weekReeferFuelSurcharge: 20.82,
  weekSafetyIncentive: 16.35,
  weekServiceIncentive: 16.35,
  weekToll1099Pay: 0.07,
  weekTotalRevenue: 4783.75,
  weekFuelOilTax: 1953.78,
  weekMiscellaneous: 589.84,
  weekTotalVariableCosts: 2543.62,
  weekTotalFixedCost: 255.77,
  weekOtherIncomeAndExpense: 99.63,
  weekInterestIncome: 0.37,
  weekTotalOperatingExpenses: 2899.02,
  weekTotalStatement: 1884.73,
  ytdTotalRevenue: 24425.98,
  ytdMiles: 10146,
  ytdTotalStatement: 8099.66,
  weeksInService: 5,
};

function makeExtraction(overrides: Omit<Partial<NonNullable<Extraction['settlement']>>, 'carrier'> & { carrier?: string | null }): Extraction {
  return {
    docType: 'settlement',
    settlement: {
      weekEnding: '2026-08-21',
      carrier: overrides.carrier === undefined ? 'PRIME INC.' : overrides.carrier,
      grossRevenue: 4783.75,
      totalMiles: 2327,
      totalDeductions: 3212.19,
      reimbursements: 312.8,
      netPay: 1884.36,
      operating: GOLDEN_OPERATING,
      ...overrides,
    },
  } as Extraction;
}

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

describe('weekly check — the golden Prime settlement reconciles at TOTAL level', () => {
  test('revenue, miles, operating expenses and total statement all match', () => {
    const extraction = makeExtraction({});
    expect(checkPrimeOperatingStatementWeekly(extraction)).toEqual([]);
    expect(applyPrimeOperatingStatementCheck(extraction)).toBe(extraction);
  });

  test('the reconciliation line carries every compared figure, interest only here', () => {
    const r = buildPrimeReconciliation(makeExtraction({}))!;
    expect(r.totalRevenue).toBe(4783.75);
    expect(r.grossRevenue).toBe(4783.75);
    expect(r.miles).toBe(2327);
    // TOTAL OPERATING EXPENSES 2,899.02 = deductions 3,212.19 − reimbursed 312.80 − interest .37
    expect(r.totalDeductions! - r.reimbursements - r.interestIncome).toBeCloseTo(2899.02, 2);
    expect(r.totalOperatingExpenses).toBe(2899.02);
    // TOTAL STATEMENT 1,884.73 = net due 1,884.36 + interest .37 (the direct deposit)
    expect(r.netDue! + r.interestIncome).toBeCloseTo(1884.73, 2);
    expect(r.totalStatement).toBe(1884.73);
    expect(r.interestIncome).toBe(0.37);
  });

  test('reimbursements fall back to the reimbursement lines when the total is not printed', () => {
    const lines = [1, 10.37, 32.43, 76.04, 31.91, 18.13, 47.42, 52, 43.5].map((amount) => ({ amount }));
    const r = buildPrimeReconciliation(makeExtraction({ reimbursements: undefined, reimbursementItems: lines }))!;
    expect(r.reimbursements).toBeCloseTo(312.8, 2);
    expect(r.mismatches).toEqual([]);
  });

  test('a total Prime did not print (0 default) is never compared', () => {
    const extraction = makeExtraction({ operating: { ...GOLDEN_OPERATING, weekTotalOperatingExpenses: 0, weekTotalStatement: 0 }, netPay: 1 });
    expect(checkPrimeOperatingStatementWeekly(extraction)).toEqual([]);
  });

  test('no operating-statement data at all on a Prime settlement — silent no-op', () => {
    expect(buildPrimeReconciliation(makeExtraction({ operating: undefined }))).toBeNull();
    expect(checkPrimeOperatingStatementWeekly(makeExtraction({ operating: {} }))).toEqual([]);
  });
});

describe('weekly check — flags a real mismatch', () => {
  test('revenue read from the LOAD REVENUE column (trap 6) — flagged, confidence low, figures untouched', () => {
    const extraction = makeExtraction({ grossRevenue: 4983.82 });
    expect(checkPrimeOperatingStatementWeekly(extraction)).toEqual([
      { field: 'revenue', extracted: 4983.82, operatingStatement: 4783.75 },
    ]);
    const result = applyPrimeOperatingStatementCheck(extraction);
    expect(result.confidence).toBe('low');
    expect(result.settlement?.grossRevenue).toBe(4983.82);
  });

  test('LTD/QTD miles 10,146 taken as the week (trap) — flagged', () => {
    expect(checkPrimeOperatingStatementWeekly(makeExtraction({ totalMiles: 10146 }))).toEqual([
      { field: 'miles', extracted: 10146, operatingStatement: 2327 },
    ]);
  });

  test('deductions missing a line — operating expenses flagged', () => {
    const issues = checkPrimeOperatingStatementWeekly(makeExtraction({ totalDeductions: 3188.69 }));
    expect(issues.map((i) => i.field)).toEqual(['operatingExpenses']);
  });

  test('net due misread — total statement flagged', () => {
    const issues = checkPrimeOperatingStatementWeekly(makeExtraction({ netPay: 1234.36 }));
    expect(issues.map((i) => i.field)).toEqual(['totalStatement']);
  });

  test('applyPrimeOperatingStatementCheck keeps an existing high confidence when everything matches', () => {
    const clean: Extraction = { ...makeExtraction({}), confidence: 'high' };
    expect(applyPrimeOperatingStatementCheck(clean).confidence).toBe('high');
  });
});

describe('checkPrimeYtdReconciliation — standing YTD check', () => {
  const primeYtd: PrimeYtdSnapshot = { revenue: 24425.98, miles: 10146, totalStatement: 8099.66, asOfWeekEnding: '2026-08-21' };

  test('agrees within tolerance (interest .66 YTD absorbed) — no mismatch', () => {
    expect(checkPrimeYtdReconciliation({ revenue: 24425.98, miles: 10146, netPay: 8099.0 }, primeYtd)).toEqual([]);
  });

  test('a missing week — all three fields diverge beyond tolerance', () => {
    expect(checkPrimeYtdReconciliation({ revenue: 19642.23, miles: 7819, netPay: 6214.93 }, primeYtd)).toEqual([
      { field: 'revenue', ours: 19642.23, prime: 24425.98 },
      { field: 'miles', ours: 7819, prime: 10146 },
      { field: 'totalStatement', ours: 6214.93, prime: 8099.66 },
    ]);
  });

  test('null snapshot — never a guess', () => {
    expect(checkPrimeYtdReconciliation({ revenue: 1, miles: 1, netPay: 1 }, null)).toEqual([]);
  });

  test('a zero-value field on the Prime side is never compared against', () => {
    const partial: PrimeYtdSnapshot = { revenue: 24425.98, miles: 0, totalStatement: 0, asOfWeekEnding: '2026-08-21' };
    expect(checkPrimeYtdReconciliation({ revenue: 100, miles: 999999, netPay: 999999 }, partial)).toEqual([
      { field: 'revenue', ours: 100, prime: 24425.98 },
    ]);
  });
});

describe('readPrimeYtdSnapshotFromParsedJson', () => {
  test('reads the real layout', () => {
    const parsedJson = { settlement: { carrier: 'PRIME INC.', operating: GOLDEN_OPERATING } };
    expect(readPrimeYtdSnapshotFromParsedJson(parsedJson, '2026-08-21')).toEqual({
      revenue: 24425.98,
      miles: 10146,
      totalStatement: 8099.66,
      asOfWeekEnding: '2026-08-21',
    });
  });

  test('reads a settlement imported before the real layout (old ytdRevenue / ytdNet keys)', () => {
    const parsedJson = { settlement: { carrier: 'Prime Inc', operating: { ytdRevenue: 19642.23, ytdMiles: 7819, ytdExpenses: 1, ytdNet: 6214.93 } } };
    expect(readPrimeYtdSnapshotFromParsedJson(parsedJson, '2026-08-14')).toEqual({
      revenue: 19642.23,
      miles: 7819,
      totalStatement: 6214.93,
      asOfWeekEnding: '2026-08-14',
    });
  });

  test('a non-Prime carrier inside the SAME parsed_json — returns null', () => {
    const parsedJson = { settlement: { carrier: 'Landstar', operating: GOLDEN_OPERATING } };
    expect(readPrimeYtdSnapshotFromParsedJson(parsedJson, '2026-08-21')).toBeNull();
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
      ['doc-old', { parsed_json: { settlement: { carrier: 'Prime Inc', operating: { ytdTotalRevenue: 19642.23, ytdMiles: 7819, ytdTotalStatement: 6214.93 } } } }],
      ['doc-new', { parsed_json: { settlement: { carrier: 'Prime Inc', operating: GOLDEN_OPERATING } } }],
      ['doc-other-carrier', { parsed_json: { settlement: { carrier: 'Landstar', operating: { ytdTotalRevenue: 5000, ytdMiles: 4000 } } } }],
    ]);
    const settlements = [
      { carrier: 'Prime Inc', week_ending: '2026-08-14', document_id: 'doc-old' },
      { carrier: 'Prime Inc', week_ending: '2026-08-21', document_id: 'doc-new' },
      { carrier: 'Landstar', week_ending: '2026-08-28', document_id: 'doc-other-carrier' },
    ];
    expect(findMostRecentPrimeYtdSnapshot(settlements, documentsById)?.asOfWeekEnding).toBe('2026-08-21');
  });

  test('skips a Prime settlement with no operating data, falling back to an older one', () => {
    const documentsById = new Map([
      ['doc-old', { parsed_json: { settlement: { carrier: 'Prime Inc', operating: { ytdTotalRevenue: 19642.23, ytdMiles: 7819 } } } }],
      ['doc-newest', { parsed_json: { settlement: { carrier: 'Prime Inc' } } }],
    ]);
    const settlements = [
      { carrier: 'Prime Inc', week_ending: '2026-08-14', document_id: 'doc-old' },
      { carrier: 'Prime Inc', week_ending: '2026-08-21', document_id: 'doc-newest' },
    ];
    expect(findMostRecentPrimeYtdSnapshot(settlements, documentsById)?.asOfWeekEnding).toBe('2026-08-14');
  });

  test('no settlements at all — null', () => {
    expect(findMostRecentPrimeYtdSnapshot([], new Map())).toBeNull();
  });
});

// CARRIER ISOLATION — mirrors carrierCodes.test.ts's "Prime codes never
// leak": a non-Prime settlement never triggers any part of this module.
describe('CARRIER ISOLATION: a non-Prime settlement never triggers any part of this reconciliation', () => {
  const nonPrimeCarriers = ['Landstar', 'Schneider National', 'Werner', 'Unknown Carrier LLC', '', null];

  test.each(nonPrimeCarriers)('weekly check is a no-op for carrier=%p even with mismatched operating data', (carrier) => {
    const extraction = makeExtraction({ carrier: carrier as string | null, grossRevenue: 1, totalMiles: 1, totalDeductions: 1, netPay: 1 });
    expect(buildPrimeReconciliation(extraction)).toBeNull();
    expect(checkPrimeOperatingStatementWeekly(extraction)).toEqual([]);
    expect(applyPrimeOperatingStatementCheck(extraction)).toBe(extraction);
  });

  test.each(nonPrimeCarriers)('readPrimeYtdSnapshotFromParsedJson is a no-op for carrier=%p', (carrier) => {
    expect(readPrimeYtdSnapshotFromParsedJson({ settlement: { carrier, operating: GOLDEN_OPERATING } }, '2026-08-21')).toBeNull();
  });
});

// ACCOUNTING MODEL — TWO LAYERS (owner decision 2026-08-28): the standing
// YTD check is fed ONLY the Prime sub-ledger.
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
        { id: 'r3', settlement_id: 'sett-other-1' },
      ]
    );
    expect(result.settlements).toEqual([primeSettlement]);
    expect(result.deductions.map((d) => d.id)).toEqual(['d1']);
    expect(result.reimbursements.map((r) => r.id)).toEqual(['r1']);
  });

  test('a non-Prime settlement on the same account never makes the YTD check flag a mismatch', () => {
    const primeYtd: PrimeYtdSnapshot = { revenue: 4783.75, miles: 2327, totalStatement: 1884.73, asOfWeekEnding: '2026-08-21' };
    const rows = [
      { id: 'sett-prime-1', carrier: 'Prime Inc', truck_id: null, week_ending: '2026-08-21', gross: 4783.75, net: 1884.36, miles: 2327 },
      { id: 'sett-other-1', carrier: 'Landstar', truck_id: null, week_ending: '2026-08-14', gross: 3000, net: 2000, miles: 1500 },
    ];
    const scope = filterToPrimeSettlementSubledger(rows, [], [], [], [], []);
    const kpi = computeKpis({
      trucks: [],
      settlements: scope.settlements,
      loads: [],
      deductions: scope.deductions,
      fuelPurchases: scope.fuelPurchases,
      maintenanceRecords: scope.maintenanceRecords,
      tolls: scope.tolls,
      reimbursements: scope.reimbursements,
      truckScope: null,
      manualMilesOverride: null,
      window: null,
    });
    expect(checkPrimeYtdReconciliation({ revenue: kpi.gross, miles: kpi.miles.total, netPay: kpi.bridge.netPay }, primeYtd)).toEqual([]);

    // CONTRAST — the unfiltered account would wrongly flag all three.
    const unfiltered = computeKpis({
      trucks: [],
      settlements: rows,
      loads: [],
      deductions: [],
      fuelPurchases: [],
      maintenanceRecords: [],
      tolls: [],
      reimbursements: [],
      truckScope: null,
      manualMilesOverride: null,
      window: null,
    });
    expect(
      checkPrimeYtdReconciliation({ revenue: unfiltered.gross, miles: unfiltered.miles.total, netPay: unfiltered.bridge.netPay }, primeYtd).map((m) => m.field)
    ).toEqual(['revenue', 'miles', 'totalStatement']);
  });
});
