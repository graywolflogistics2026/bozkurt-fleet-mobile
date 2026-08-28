import {
  isPrimeCarrier,
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

function makeExtraction(overrides: Partial<Extraction['settlement']> & { carrier?: string }): Extraction {
  return {
    docType: 'settlement',
    settlement: {
      weekEnding: '2026-08-01',
      carrier: overrides.carrier ?? 'Prime Inc',
      grossRevenue: 3200,
      totalMiles: 2500,
      totalDeductions: 900,
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
  });
});

// A REALISTIC Prime operating-statement layout, matching docs/
// CARRIER_CODES.md's own vocabulary — reconciles correctly (no mismatch)
// when the extraction and the operating statement agree.
describe('checkPrimeOperatingStatementWeekly — reconciles correctly', () => {
  test('a Prime settlement where extraction matches the operating statement exactly', () => {
    const extraction = makeExtraction({
      grossRevenue: 3200,
      totalMiles: 2500,
      totalDeductions: 900,
      operating: { weekRevenue: 3200, weekMiles: 2500, weekExpenses: 900, ytdRevenue: 96000, ytdMiles: 75000, ytdExpenses: 27000 },
    });
    expect(checkPrimeOperatingStatementWeekly(extraction)).toEqual([]);
    expect(applyPrimeOperatingStatementCheck(extraction)).toBe(extraction);
  });

  test('within the documented tolerance ($1, 1 mile) — no mismatch', () => {
    const extraction = makeExtraction({
      grossRevenue: 3200.4,
      totalMiles: 2500,
      totalDeductions: 899.6,
      operating: { weekRevenue: 3200, weekMiles: 2501, weekExpenses: 900 },
    });
    expect(checkPrimeOperatingStatementWeekly(extraction)).toEqual([]);
  });

  test('an operating-statement field left at its zero default is never compared against', () => {
    const extraction = makeExtraction({
      grossRevenue: 3200,
      totalMiles: 2500,
      totalDeductions: 900,
      operating: { weekRevenue: 3200, weekMiles: 0, weekExpenses: 0 },
    });
    expect(checkPrimeOperatingStatementWeekly(extraction)).toEqual([]);
  });

  test('no operating-statement data at all on a Prime settlement — silent no-op', () => {
    const extraction = makeExtraction({ grossRevenue: 3200, totalMiles: 2500, totalDeductions: 900 });
    expect(checkPrimeOperatingStatementWeekly(extraction)).toEqual([]);
  });
});

// An artificially mismatched case gets flagged via the EXISTING
// needs-review machinery (confidence downgraded to 'low').
describe('checkPrimeOperatingStatementWeekly / applyPrimeOperatingStatementCheck — flags a real mismatch', () => {
  test('revenue off by more than $1 — flagged and confidence downgraded', () => {
    const extraction = makeExtraction({
      grossRevenue: 3050,
      totalMiles: 2500,
      totalDeductions: 900,
      operating: { weekRevenue: 3200, weekMiles: 2500, weekExpenses: 900 },
    });
    const issues = checkPrimeOperatingStatementWeekly(extraction);
    expect(issues).toEqual([{ field: 'revenue', extracted: 3050, operatingStatement: 3200 }]);

    const result = applyPrimeOperatingStatementCheck(extraction);
    expect(result.confidence).toBe('low');
    // Never touches the underlying figures themselves — informational only.
    expect(result.settlement?.grossRevenue).toBe(3050);
  });

  test('miles off by more than 1 — flagged', () => {
    const extraction = makeExtraction({
      grossRevenue: 3200,
      totalMiles: 2400,
      totalDeductions: 900,
      operating: { weekRevenue: 3200, weekMiles: 2500, weekExpenses: 900 },
    });
    expect(checkPrimeOperatingStatementWeekly(extraction)).toEqual([{ field: 'miles', extracted: 2400, operatingStatement: 2500 }]);
  });

  test('expenses off by more than $1 — flagged', () => {
    const extraction = makeExtraction({
      grossRevenue: 3200,
      totalMiles: 2500,
      totalDeductions: 700,
      operating: { weekRevenue: 3200, weekMiles: 2500, weekExpenses: 900 },
    });
    expect(checkPrimeOperatingStatementWeekly(extraction)).toEqual([{ field: 'expenses', extracted: 700, operatingStatement: 900 }]);
  });

  test('multiple mismatched fields are all reported', () => {
    const extraction = makeExtraction({
      grossRevenue: 3050,
      totalMiles: 2400,
      totalDeductions: 700,
      operating: { weekRevenue: 3200, weekMiles: 2500, weekExpenses: 900 },
    });
    const issues = checkPrimeOperatingStatementWeekly(extraction);
    expect(issues.map((i) => i.field).sort()).toEqual(['expenses', 'miles', 'revenue']);
  });

  test('applyPrimeOperatingStatementCheck preserves an EXISTING high confidence unless a mismatch is found', () => {
    const clean: Extraction = {
      ...makeExtraction({
        grossRevenue: 3200,
        totalMiles: 2500,
        totalDeductions: 900,
        operating: { weekRevenue: 3200, weekMiles: 2500, weekExpenses: 900 },
      }),
      confidence: 'high',
    };
    expect(applyPrimeOperatingStatementCheck(clean).confidence).toBe('high');
  });
});

// STANDING YTD CHECK — triggers correctly for a Prime account when this
// app's own YTD and Prime's own reported YTD diverge beyond tolerance,
// and does NOT trigger when they agree.
describe('checkPrimeYtdReconciliation — standing YTD check', () => {
  const primeYtd: PrimeYtdSnapshot = { revenue: 96000, miles: 75000, expenses: 27000, asOfWeekEnding: '2026-08-01' };

  test('agrees within tolerance — no mismatch', () => {
    expect(checkPrimeYtdReconciliation({ revenue: 96010, miles: 75005, expenses: 26990 }, primeYtd)).toEqual([]);
  });

  test('diverges beyond tolerance on all three fields', () => {
    const issues = checkPrimeYtdReconciliation({ revenue: 91000, miles: 71000, expenses: 25000 }, primeYtd);
    expect(issues).toEqual([
      { field: 'revenue', ours: 91000, prime: 96000 },
      { field: 'miles', ours: 71000, prime: 75000 },
      { field: 'expenses', ours: 25000, prime: 27000 },
    ]);
  });

  test('null snapshot (no Prime data seen yet) — never a guess, always []', () => {
    expect(checkPrimeYtdReconciliation({ revenue: 1, miles: 1, expenses: 1 }, null)).toEqual([]);
  });

  test('a zero-value field on the Prime side is never compared against', () => {
    const partial: PrimeYtdSnapshot = { revenue: 96000, miles: 0, expenses: 0, asOfWeekEnding: '2026-08-01' };
    expect(checkPrimeYtdReconciliation({ revenue: 40000, miles: 999999, expenses: 999999 }, partial)).toEqual([
      { field: 'revenue', ours: 40000, prime: 96000 },
    ]);
  });
});

describe('readPrimeYtdSnapshotFromParsedJson', () => {
  test('reads a real Prime-shaped parsed_json blob', () => {
    const parsedJson = {
      settlement: { carrier: 'Prime Inc', operating: { ytdRevenue: 96000, ytdMiles: 75000, ytdExpenses: 27000 } },
    };
    expect(readPrimeYtdSnapshotFromParsedJson(parsedJson, '2026-08-01')).toEqual({
      revenue: 96000,
      miles: 75000,
      expenses: 27000,
      asOfWeekEnding: '2026-08-01',
    });
  });

  test('a non-Prime carrier embedded in the SAME parsed_json — defense in depth, returns null', () => {
    const parsedJson = {
      settlement: { carrier: 'Landstar', operating: { ytdRevenue: 96000, ytdMiles: 75000, ytdExpenses: 27000 } },
    };
    expect(readPrimeYtdSnapshotFromParsedJson(parsedJson, '2026-08-01')).toBeNull();
  });

  test('no operating section, no settlement, or null parsed_json — all return null', () => {
    expect(readPrimeYtdSnapshotFromParsedJson({ settlement: { carrier: 'Prime Inc' } }, '2026-08-01')).toBeNull();
    expect(readPrimeYtdSnapshotFromParsedJson({}, '2026-08-01')).toBeNull();
    expect(readPrimeYtdSnapshotFromParsedJson(null, '2026-08-01')).toBeNull();
  });
});

describe('findMostRecentPrimeYtdSnapshot', () => {
  test('picks the LATEST Prime settlement (by week_ending) that actually has operating data', () => {
    const documentsById = new Map([
      ['doc-old', { parsed_json: { settlement: { carrier: 'Prime Inc', operating: { ytdRevenue: 80000, ytdMiles: 60000, ytdExpenses: 20000 } } } }],
      ['doc-new', { parsed_json: { settlement: { carrier: 'Prime Inc', operating: { ytdRevenue: 96000, ytdMiles: 75000, ytdExpenses: 27000 } } } }],
      ['doc-other-carrier', { parsed_json: { settlement: { carrier: 'Landstar', operating: { ytdRevenue: 5000, ytdMiles: 4000, ytdExpenses: 1000 } } } }],
    ]);
    const settlements = [
      { carrier: 'Prime Inc', week_ending: '2026-07-01', document_id: 'doc-old' },
      { carrier: 'Prime Inc', week_ending: '2026-08-01', document_id: 'doc-new' },
      { carrier: 'Landstar', week_ending: '2026-08-08', document_id: 'doc-other-carrier' },
    ];
    expect(findMostRecentPrimeYtdSnapshot(settlements, documentsById)).toEqual({
      revenue: 96000,
      miles: 75000,
      expenses: 27000,
      asOfWeekEnding: '2026-08-01',
    });
  });

  test('skips a Prime settlement with no operating data, falling back to an older one that has it', () => {
    const documentsById = new Map([
      ['doc-old', { parsed_json: { settlement: { carrier: 'Prime Inc', operating: { ytdRevenue: 80000, ytdMiles: 60000, ytdExpenses: 20000 } } } }],
      ['doc-newest', { parsed_json: { settlement: { carrier: 'Prime Inc' } } }],
    ]);
    const settlements = [
      { carrier: 'Prime Inc', week_ending: '2026-07-01', document_id: 'doc-old' },
      { carrier: 'Prime Inc', week_ending: '2026-08-15', document_id: 'doc-newest' },
    ];
    expect(findMostRecentPrimeYtdSnapshot(settlements, documentsById)?.asOfWeekEnding).toBe('2026-07-01');
  });

  test('no settlements at all — null', () => {
    expect(findMostRecentPrimeYtdSnapshot([], new Map())).toBeNull();
  });
});

// CRITICAL — mirrors carrierCodes.test.ts's own "Prime codes never leak"
// test. A non-Prime settlement (any other carrier, or unrecognized/empty
// carrier text) never triggers ANY part of this reconciliation, proven
// against the real exported functions.
describe('CARRIER ISOLATION: a non-Prime settlement never triggers any part of this reconciliation', () => {
  const nonPrimeCarriers = ['Landstar', 'Schneider National', 'Werner', 'Unknown Carrier LLC', '', null, undefined];

  test.each(nonPrimeCarriers)('checkPrimeOperatingStatementWeekly is a no-op for carrier=%p even with mismatched operating data', (carrier) => {
    const extraction = makeExtraction({
      carrier: carrier as string,
      grossRevenue: 3050,
      totalMiles: 2400,
      totalDeductions: 700,
      // Deliberately mismatched — if carrier isolation ever broke, this
      // would trigger every one of the 3 mismatch fields.
      operating: { weekRevenue: 3200, weekMiles: 2500, weekExpenses: 900 },
    });
    expect(checkPrimeOperatingStatementWeekly(extraction)).toEqual([]);
    expect(applyPrimeOperatingStatementCheck(extraction)).toBe(extraction);
  });

  test.each(nonPrimeCarriers)('readPrimeYtdSnapshotFromParsedJson is a no-op for carrier=%p', (carrier) => {
    const parsedJson = { settlement: { carrier, operating: { ytdRevenue: 96000, ytdMiles: 75000, ytdExpenses: 27000 } } };
    expect(readPrimeYtdSnapshotFromParsedJson(parsedJson, '2026-08-01')).toBeNull();
  });

  test('findMostRecentPrimeYtdSnapshot never picks up a non-Prime settlement even when it is the ONLY one', () => {
    const documentsById = new Map([
      ['doc-1', { parsed_json: { settlement: { carrier: 'Landstar', operating: { ytdRevenue: 96000, ytdMiles: 75000, ytdExpenses: 27000 } } } }],
    ]);
    const settlements = [{ carrier: 'Landstar', week_ending: '2026-08-01', document_id: 'doc-1' }];
    expect(findMostRecentPrimeYtdSnapshot(settlements, documentsById)).toBeNull();
  });

  test('a description/carrier field that merely CONTAINS "Prime" as a substring of a different name is not treated as Prime', () => {
    // e.g. a fictitious "Prime Logistics Partners" — normalizeCarrierKey()
    // requires an EXACT match against 'PRIME INC', not a substring.
    expect(isPrimeCarrier('Prime Logistics Partners')).toBe(false);
  });
});

// ACCOUNTING MODEL — TWO LAYERS, NEVER CONFLATED (owner decision,
// 2026-08-28). filterToPrimeSettlementSubledger() is what LAYER 1
// (source of record) actually relies on: the Prime reconciliation must
// stay internally verified against Prime's own operating statement and
// NEVER be affected by the user's own manually-added deductions.
describe('filterToPrimeSettlementSubledger — LAYER 1 isolation from manually-added rows', () => {
  const primeSettlement = { id: 'sett-prime-1', carrier: 'Prime Inc' };
  const primeDeduction = { id: 'ded-prime-1', settlement_id: 'sett-prime-1', amount: 700 };
  // A manually-added deduction — no settlement_id, exactly what
  // mapPurchase()/mapGenericDeduction() produce (mapExtraction.ts never
  // sets settlement_id for either).
  const manualDeduction = { id: 'ded-manual-1', settlement_id: null, amount: 500 };

  test('excludes a manually-added deduction (settlement_id: null) even though it is in the same account', () => {
    const result = filterToPrimeSettlementSubledger([primeSettlement], [primeDeduction, manualDeduction], [], [], []);
    expect(result.deductions).toEqual([primeDeduction]);
  });

  test('excludes a deduction tied to a DIFFERENT, non-Prime settlement', () => {
    const otherCarrierSettlement = { id: 'sett-other-1', carrier: 'Landstar' };
    const otherCarrierDeduction = { id: 'ded-other-1', settlement_id: 'sett-other-1', amount: 900 };
    const result = filterToPrimeSettlementSubledger(
      [primeSettlement, otherCarrierSettlement],
      [primeDeduction, otherCarrierDeduction],
      [],
      [],
      []
    );
    expect(result.settlements).toEqual([primeSettlement]);
    expect(result.deductions).toEqual([primeDeduction]);
  });

  // THE ACTUAL BUG THIS FIXES, reproduced end to end through the REAL
  // computeKpis() and checkPrimeYtdReconciliation() — not asserted from
  // the filter's own output in isolation. A Prime settlement whose own
  // withheld deduction ($700) exactly matches what Prime's own YTD
  // statement reports reconciles cleanly on its own; adding a real,
  // unrelated $500 manual deduction to the SAME account must leave that
  // result completely unaffected once the inputs are scoped through
  // filterToPrimeSettlementSubledger() first — and, shown for contrast,
  // WOULD have wrongly flagged a mismatch had the account-wide,
  // unfiltered totals been used instead (exactly what
  // app/(tabs)/more/settlements.tsx's own primeYtdMismatches memo did
  // before this fix).
  test('a manually-added deduction never affects whether the standing YTD check flags a mismatch', () => {
    const primeYtd: PrimeYtdSnapshot = { revenue: 3200, miles: 2500, expenses: 700, asOfWeekEnding: '2026-08-01' };
    const settlementRow = { id: 'sett-prime-1', truck_id: null, week_ending: '2026-08-01', gross: 3200, net: 2500, miles: 2500 };
    const withheldDeduction = {
      settlement_id: 'sett-prime-1',
      amount: 700,
      source: 'settlement' as const,
      tax_deductible: false as const,
    };
    const manualReceipt = { settlement_id: null, amount: 500, source: 'manual' as const, tax_deductible: true as const };

    // Cleanly reconciles with ONLY the Prime settlement's own rows.
    const primeOnlyScope = filterToPrimeSettlementSubledger([primeSettlement], [withheldDeduction], [], [], []);
    const kpiPrimeOnly = computeKpis({
      trucks: [],
      settlements: [{ ...settlementRow, ...primeOnlyScope.settlements[0] }],
      loads: [],
      deductions: primeOnlyScope.deductions,
      fuelPurchases: [],
      maintenanceRecords: [],
      tolls: [],
      truckScope: null,
      manualMilesOverride: null,
      window: null,
    });
    expect(checkPrimeYtdReconciliation({ revenue: kpiPrimeOnly.gross, miles: kpiPrimeOnly.miles.total, expenses: kpiPrimeOnly.expenses.total }, primeYtd)).toEqual([]);

    // Same account, now WITH a real, unrelated manual deduction on the
    // books too — filtering through the subledger first means the result
    // is BYTE-IDENTICAL: still zero mismatches.
    const withManualScope = filterToPrimeSettlementSubledger([primeSettlement], [withheldDeduction, manualReceipt], [], [], []);
    const kpiWithManual = computeKpis({
      trucks: [],
      settlements: [{ ...settlementRow, ...withManualScope.settlements[0] }],
      loads: [],
      deductions: withManualScope.deductions,
      fuelPurchases: [],
      maintenanceRecords: [],
      tolls: [],
      truckScope: null,
      manualMilesOverride: null,
      window: null,
    });
    expect(kpiWithManual.expenses.total).toBe(kpiPrimeOnly.expenses.total); // manual $500 never entered the comparison
    expect(checkPrimeYtdReconciliation({ revenue: kpiWithManual.gross, miles: kpiWithManual.miles.total, expenses: kpiWithManual.expenses.total }, primeYtd)).toEqual([]);

    // CONTRAST — the bug this replaces: feeding the UNFILTERED, account-
    // wide deductions straight into computeKpis() (what the code used to
    // do) inflates expenses by the manual $500 and DOES wrongly flag a
    // mismatch against Prime's own reported $700.
    const kpiUnfiltered = computeKpis({
      trucks: [],
      settlements: [settlementRow],
      loads: [],
      deductions: [withheldDeduction, manualReceipt],
      fuelPurchases: [],
      maintenanceRecords: [],
      tolls: [],
      truckScope: null,
      manualMilesOverride: null,
      window: null,
    });
    expect(kpiUnfiltered.expenses.total).toBe(1200);
    expect(
      checkPrimeYtdReconciliation({ revenue: kpiUnfiltered.gross, miles: kpiUnfiltered.miles.total, expenses: kpiUnfiltered.expenses.total }, primeYtd)
    ).toEqual([{ field: 'expenses', ours: 1200, prime: 700 }]);
  });
});
