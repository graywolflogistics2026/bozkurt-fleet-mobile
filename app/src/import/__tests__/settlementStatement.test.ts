import type { Extraction } from '@/src/import/types';
import {
  buildPrimeStatementCheck,
  buildSettlementStatement,
  labelsSeenOn,
  printedTotalsMatch,
  settlementVerification,
  statementReviewReasons,
} from '@/src/import/settlementStatement';
import { classifyStatementLine, type StatementLine } from '@/src/import/primeStatementLines';
import { statementWeekOf } from '@/src/stats/statementRoute';
import { calcCanonicalCpm } from '@/src/stats/cpm';
import { scrubBankDigits } from '@/src/import/bankDigits';

// PRIME STATEMENT AS SOURCE — the approved line table decisions
// (owner decision 2026-10-13, D1-D8, R1, R2) on a small Prime week.
// Base week: revenue 1,000.00; fuel 300.00-; ADVANCES 100.00-;
// fixed 50.00-; bond 20.00-; interest .10 -> statement 530.10.
type L = [StatementLine['section'], string, number];

function primeWeek(extraLines: L[] = [], totals: Record<string, number> = {}, prCode = true): Extraction {
  const lines: L[] = [
    ['revenue', 'REVENUE FROM PRIME INC.', 1000],
    ['fuel_oil_tax', 'TRACTOR FUEL', -300],
    ['misc', 'ADVANCES', -100],
    ['fixed', 'PHYSICAL DAMAGE INSURANCE', -50],
    ['other', 'ACCRUAL PERFORMANCE BOND', -20],
    ['other', 'INTEREST INCOME FROM DEPOSIT', 0.1],
    ...extraLines,
  ];
  const sum = (section: string) => lines.filter((l) => l[0] === section).reduce((s, l) => s + l[2], 0);
  const r = (n: number) => Math.round(n * 100) / 100;
  const variable = sum('fuel_oil_tax') + sum('repair') + sum('tires') + sum('misc');
  const opex = variable + sum('out_of_pocket') + sum('fixed') + sum('other');
  return {
    docType: 'settlement',
    settlement: {
      weekEnding: '2026-08-21',
      carrier: 'PRIME INC',
      grossRevenue: r(sum('revenue')),
      netPay: r(sum('revenue') + opex - 0.1),
      totalMiles: 1000,
      reimbursementItems: prCode ? [{ code: 'PR', desc: 'WIE14MB LD', amount: 1 }] : [],
      operating: {
        lines: lines.map(([section, label, amount]) => ({ section, label, amount })),
        weekMiles: 1000,
        weekTotalRevenue: r(sum('revenue')),
        weekTotalFuelOilTax: r(sum('fuel_oil_tax')) || undefined,
        weekTotalRepair: r(sum('repair')) || undefined,
        weekTotalMiscellaneous: r(sum('misc')) || undefined,
        weekTotalOutOfPocket: r(sum('out_of_pocket')) || undefined,
        weekTotalVariableCosts: r(variable),
        weekTotalFixedCost: r(sum('fixed')),
        weekTotalOtherIncomeAndExpense: r(sum('other')),
        weekTotalOperatingExpenses: r(opex),
        weekTotalStatement: r(sum('revenue') + opex),
        // Prime always prints SETTLEMENT TO OPERATOR — a core self-check
        // number (owner decision 2026-10-13, amendment 1).
        settlementToOperator: r(sum('revenue') + opex),
        // The statement page's own week ending (gate, owner decision 2026-10-17).
        weekEnding: '2026-08-21',
        ...totals,
      },
    },
  };
}

function weekOf(extraction: Extraction, prior: Set<string> = new Set()) {
  const statement = buildSettlementStatement(extraction, { savedFlagged: false, priorLabelsSeen: prior });
  return { statement, week: statementWeekOf({ id: 's1', truck_id: 't1', week_ending: '2026-08-21', statement })! };
}

describe('base week', () => {
  test('passes its self-check; expenses = fuel 300 + fixed 50; advances, bond and interest excluded', () => {
    const { statement, week } = weekOf(primeWeek());
    expect(statement.prime!.passed).toBe(true);
    expect(week.expenses).toBe(350);
    expect(week.gross).toBe(1000);
    expect(week.deposit).toBe(530.1);
    // profit = deposit + add-backs − interest
    expect(Math.round((week.deposit + week.addBacks.reduce((s, a) => s + a.amount, 0) - week.interestIncome) * 100) / 100).toBe(650);
    expect(week.gross - week.expenses).toBe(650);
  });

  test('a TOTAL line the AI copied into lines is ignored, never counted', () => {
    const e = primeWeek();
    e.settlement!.operating!.lines!.push({ section: 'misc', label: 'TOTAL MISCELLANEOUS', amount: -100 });
    expect(buildPrimeStatementCheck(e)!.lines.some((l) => /TOTAL/.test(l.label))).toBe(false);
  });
});

describe('D1 — OUTSIDE LUMPER 1099 PAY is revenue, LUMPERS an expense', () => {
  test('both count; gross = TOTAL REVENUE', () => {
    const { week } = weekOf(primeWeek([['revenue', 'OUTSIDE LUMPER 1099 PAY', 200], ['misc', 'LUMPERS', -200]]));
    expect(week.gross).toBe(1200);
    expect(week.expenses).toBe(550);
  });
});

describe('D2 — STATE FUEL TAX -> Fuel & DEF', () => {
  test('classified Fuel & DEF', () => {
    const { treatment } = classifyStatementLine({ section: 'fuel_oil_tax', label: 'STATE FUEL TAX' });
    expect(treatment).toMatchObject({ kind: 'expense', category: 'Fuel & DEF' });
  });
});

describe('D3 / D7 — counted, needs-review the FIRST time a non-zero amount appears', () => {
  const lines: L[] = [
    ['misc', 'OT LOAD/UNLOAD ADVANCE', -40],
    ['out_of_pocket', 'OUT OF POCKET COSTS', -25],
    ['other', 'START UP & EXCESS MILEAGE COST', -15],
  ];
  test('counted as expenses (Lumper Fees, Misc, Misc)', () => {
    const { week } = weekOf(primeWeek(lines));
    expect(week.expenses).toBe(350 + 40 + 25 + 15);
    expect(week.ledger.find((e) => e.label === 'OT LOAD/UNLOAD ADVANCE')?.category).toBe('Lumper Fees');
  });
  test('first appearance -> review reasons; seen before -> none', () => {
    const first = weekOf(primeWeek(lines)).statement.reviewReasons.map((r) => r.reason);
    expect(first).toEqual(['ot_load_unload_advance', 'out_of_pocket_costs', 'start_up_costs']);
    const seen = new Set(labelsSeenOn(weekOf(primeWeek(lines)).statement));
    expect(weekOf(primeWeek(lines), seen).statement.reviewReasons).toEqual([]);
  });
});

describe('D4 — PRIME POINT-OF-SALE is a per-diem meal, excluded', () => {
  test('excluded from profit', () => {
    const { week } = weekOf(primeWeek([['misc', 'PRIME POINT-OF-SALE', -30]]));
    expect(week.expenses).toBe(350);
    expect(week.addBacks.find((a) => a.reason === 'meals_per_diem')?.amount).toBe(30);
  });
});

describe('D5 — a repair line over the existing one-off threshold: in profit, not in CPM', () => {
  test('counted in expenses, listed as a CPM one-off', () => {
    const { week } = weekOf(primeWeek([['repair', 'UNIT REPAIR EXPENSE', -6000]]));
    expect(week.expenses).toBe(6350);
    const cpm = calcCanonicalCpm(1000, 1000, [], [], [], [], [], [week], 0);
    expect(cpm.excludedOneOffs.map((o) => o.amount)).toEqual([6000]);
    expect(cpm.costPerMile).toBeCloseTo(0.35, 10);
  });
  test('a small repair is counted in CPM too', () => {
    const { week } = weekOf(primeWeek([['repair', 'RO PARTS/REPAIR', -400]]));
    expect(calcCanonicalCpm(1000, 1000, [], [], [], [], [], [week], 0).costPerMile).toBeCloseTo(0.75, 10);
  });
});

describe('D6 — OPERATOR TRK EXTRAS excluded from profit and CPM', () => {
  test('never an expense; listed as truck extras', () => {
    const { week } = weekOf(primeWeek([['misc', 'OPERATOR TRK EXTRAS', -8000]]));
    expect(week.expenses).toBe(350);
    const cpm = calcCanonicalCpm(1000, 1000, [], [], [], [], [], [week], 0);
    expect(cpm.costPerMile).toBeCloseTo(0.35, 10);
    expect(week.ledger.find((e) => e.label === 'OPERATOR TRK EXTRAS')?.reason).toBe('truck_extras');
  });
});

describe('D8 — interest expense counts (Bank & Merchant Fees); interest income stays excluded', () => {
  test('interest expense counted', () => {
    const { week } = weekOf(primeWeek([['other', 'INTEREST EXPENSE ON OVER DRAW', -1.29]]));
    expect(Math.round(week.expenses * 100) / 100).toBe(351.29);
    expect(week.interestIncome).toBe(0.1);
  });
});

describe('R1 — PERSONAL PYMNT RCV offsets only up to the PR lines', () => {
  test('golden case: +1.00 vs PR 1.00 -> a 1.00 offset, nothing excluded', () => {
    const { statement, week } = weekOf(primeWeek([['misc', 'PERSONAL PYMNT RCV', 1]]));
    expect(week.expenses).toBe(349);
    expect(statement.reviewReasons).toEqual([]);
  });
  test('+5.00 vs PR 1.00 -> 1.00 offset, 4.00 owner money in (excluded) and needs-review', () => {
    const { statement, week } = weekOf(primeWeek([['misc', 'PERSONAL PYMNT RCV', 5]]));
    expect(week.expenses).toBe(349);
    expect(week.addBacks.find((a) => a.reason === 'owner_money_in')?.amount).toBe(-4);
    expect(statement.reviewReasons.map((r) => r.reason)).toEqual(['personal_payment_unmatched']);
  });
  test('no PR line at all -> the whole amount is owner money in', () => {
    const { week } = weekOf(primeWeek([['misc', 'PERSONAL PYMNT RCV', 1]], {}, false));
    expect(week.expenses).toBe(350);
  });
});

describe('R2 — the statement\'s FIXED section is the fixed bucket', () => {
  test('fixed = 50 (incl. none of the variable ELD line); variable = the rest', () => {
    const { week } = weekOf(primeWeek([['misc', 'QUALCOMM COST', -18.34], ['fixed', 'OPERATOR OCCUP ACC', -29.99]]));
    const cpm = calcCanonicalCpm(1000, 1000, [], [], [], [], [], [week], 0);
    expect(Math.round(cpm.fixedTotal * 100) / 100).toBe(79.99);
    expect(Math.round(cpm.variableTotal * 100) / 100).toBe(318.34);
  });
});

describe('unknown labels — never dropped, never guessed', () => {
  test('counted as Misc and flagged the first time', () => {
    const { statement, week } = weekOf(primeWeek([['misc', 'NEW PRIME CHARGE', -12]]));
    expect(week.expenses).toBe(362);
    expect(statement.reviewReasons).toEqual([{ reason: 'unknown_line', label: 'NEW PRIME CHARGE' }]);
  });
});

describe('verification states', () => {
  test('a Prime week whose self-check fails never shows Verified', () => {
    const e = primeWeek([], { weekTotalStatement: 999 });
    const statement = buildSettlementStatement(e, { savedFlagged: true, priorLabelsSeen: new Set() });
    expect(statement.prime!.passed).toBe(false);
    expect(settlementVerification({ statement })).toBe('unverified');
    expect(statementWeekOf({ id: 's1', statement })).toBeNull();
  });
  test('printed totals: match within $1, a null total never matches (never guessed)', () => {
    const base = { grossRevenue: 1000, reimbursements: null, reimbursementLines: 50, totalDeductions: 300, netDue: 750, deposit: null, depositSource: null, interestIncome: 0 };
    expect(printedTotalsMatch(base)).toBe(true);
    expect(printedTotalsMatch({ ...base, netDue: 700 })).toBe(false);
    expect(printedTotalsMatch({ ...base, totalDeductions: null })).toBe(false);
  });
});

describe('bank digits are never stored', () => {
  test('routing / account digits after their label are removed everywhere', () => {
    const scrubbed = scrubBankDigits({
      summary: 'DIRECT DEPOSIT TO BANK ROUTING #111000025 for 1,884.73',
      nested: [{ note: 'acct no. 4455-6677-88' }],
      amount: 1884.73,
    });
    expect(JSON.stringify(scrubbed)).not.toMatch(/111000025|4455-6677-88/);
    expect(scrubbed.amount).toBe(1884.73);
    expect(scrubbed.summary).toContain('1,884.73');
  });
});

test('statementReviewReasons ignores zero lines', () => {
  expect(statementReviewReasons([{ section: 'misc', label: 'OT LOAD/UNLOAD ADVANCE', amount: 0 }], 0, new Set())).toEqual([]);
});
