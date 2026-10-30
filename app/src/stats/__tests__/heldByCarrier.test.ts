// HELD BY CARRIER + DEPOSITED (owner decision 2026-10-29, B7). The two
// golden Prime weeks as the statement prints them:
//   W/E 8/14: PERF BD/EMGCY FD 500.00 (prior 400 + 100 this week), balance
//             forward 1,202.92-, INTEREST EXPENSE ON OVER DRAW 0.59-,
//             deposit 3,072.57
//   W/E 8/21: PERF BD/EMGCY FD 600.00 (prior 500 + 100), no balance
//             forward, INTEREST INCOME FROM DEPOSIT 0.37, deposit 1,884.73
//   Prime YTD SETTLEMENT TO OPERATOR on 8/21: 8,099.66
import en from '@/src/i18n/locales/en.json';
import { formatDate, formatMoney } from '@/src/i18n/format';
import { readPrimeEscrow } from '@/src/import/primeEscrow';
import { localDay } from '@/src/import/printedDates';
import type { SettlementStatement } from '@/src/import/settlementStatement';
import type { Extraction } from '@/src/import/types';
import { heldAtMonthEnd, heldByCarrier, onePerStatementWeek, type HeldSettlement } from '@/src/stats/heldByCarrier';
import { primeDepositsYtd } from '@/src/stats/settlementWeek';
import { computeKpis } from '@/src/stats/kpi';
import { heldByCarrierLines } from '@/src/stats/heldByCarrierText';
import { detectTipEscrowRefundable, dailyTipText } from '@/src/alerts/dailyTips';

type Op = NonNullable<NonNullable<Extraction['settlement']>['operating']>;
function primeWeek(unit: string, op: Op): Extraction {
  return { docType: 'settlement', settlement: { carrier: 'PRIME INC.', unit, operating: op } };
}
const E0814 = primeWeek('283940', {
  perfBondEmergencyFundYtd: 500,
  escrowPriorBalance: 400,
  escrowThisWeek: 100,
  escrowBalance: 500,
  escrowInterestRatePct: 3.83,
  priorWeekBalanceForward: -1202.92,
  lines: [
    { section: 'other', label: 'ACCRUAL PERFORMANCE BOND', amount: -100 },
    { section: 'other', label: 'INTEREST EXPENSE ON OVER DRAW', amount: -0.59 },
  ],
});
const E0821 = primeWeek('283940', {
  perfBondEmergencyFundYtd: 600,
  escrowPriorBalance: 500,
  escrowThisWeek: 100,
  escrowBalance: 600,
  escrowInterestRatePct: 3.83,
  lines: [
    { section: 'other', label: 'ACCRUAL PERFORMANCE BOND', amount: -100 },
    { section: 'other', label: 'INTEREST INCOME FROM DEPOSIT', amount: 0.37 },
  ],
});

function statement(e: Extraction, deposit: number): SettlementStatement {
  return {
    version: 1,
    source: 'prime_statement',
    printed: {
      grossRevenue: null,
      reimbursements: null,
      reimbursementLines: 0,
      totalDeductions: null,
      netDue: null,
      deposit,
      depositSource: 'settlement_to_operator',
      interestIncome: 0,
    },
    prime: null,
    savedFlagged: false,
    reviewReasons: [],
    unit: e.settlement?.unit ?? null,
    escrow: readPrimeEscrow(e),
  };
}
const row = (id: string, week_ending: string, truck_id: string | null, st: SettlementStatement | null, carrier = 'PRIME INC.') => ({
  id,
  truck_id,
  week_ending,
  carrier,
  net: st?.printed.deposit ?? 0,
  gross: 0,
  miles: 0,
  statement: st,
});
const S0814 = (id = 's0814', truck: string | null = 't1') => row(id, '2026-08-14', truck, statement(E0814, 3072.57));
const S0821 = (id = 's0821', truck: string | null = 't1') => row(id, '2026-08-21', truck, statement(E0821, 1884.73));

const t = (key: string, opts?: Record<string, unknown>) => {
  const value = key.split('.').reduce<unknown>((node, k) => (node as Record<string, unknown>)?.[k], en) as string;
  return value.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts?.[k] ?? ''));
};
const money = (n: number) => formatMoney(n, 'en-US');
const day = (iso: string) => formatDate(localDay(iso), 'en-US');

describe('what the statement prints (B2/B3)', () => {
  test('W/E 8/14: held 500.00 = prior 400 + this week 100; pages agree; interest on (400 − 1,202.92) is a 0.59 expense', () => {
    const e = readPrimeEscrow(E0814)!;
    expect(e).toMatchObject({ unit: '283940', held: 500, prior: 400, weekDeposit: 100, status: 'verified' });
    expect(e.checks.map((c) => [c.id, c.passed])).toEqual([
      ['heldChain', true],
      ['pagesAgree', true],
      ['weekDepositAgrees', true],
    ]);
    expect(e.interest).toEqual({ aprPct: 3.83, net: -802.92, kind: 'expense', expected: 0.59, printed: -0.59, passed: true });
  });

  test('W/E 8/21: held 600.00 = prior 500 + 100; interest on 500 is 0.37 income', () => {
    const e = readPrimeEscrow(E0821)!;
    expect(e).toMatchObject({ held: 600, prior: 500, weekDeposit: 100, status: 'verified' });
    expect(e.interest).toMatchObject({ net: 500, kind: 'income', expected: 0.37, printed: 0.37, passed: true });
  });

  test('a failing escrow check marks only that week unverified; the interest check is information only', () => {
    const bad = primeWeek('283940', { ...E0821.settlement!.operating!, escrowBalance: 650 });
    expect(readPrimeEscrow(bad)!.status).toBe('unverified');
    const offInterest = primeWeek('283940', { ...E0821.settlement!.operating!, escrowInterestRatePct: 5 });
    expect(readPrimeEscrow(offInterest)).toMatchObject({ status: 'verified', interest: { passed: false } });
  });

  test('another carrier never gets a Prime escrow reading', () => {
    expect(readPrimeEscrow({ docType: 'settlement', settlement: { carrier: 'Landstar', operating: E0821.settlement!.operating } })).toBeNull();
  });
});

describe('heldByCarrier (B2)', () => {
  test('both golden weeks imported: "Prime holds $600.00 of yours, as of 8/21/2026"', () => {
    const held = heldByCarrier([S0814(), S0821()], null);
    expect(held).toMatchObject({ status: 'printed', total: 600, asOf: '2026-08-21' });
    expect(heldByCarrierLines(held, t as never, money, day).headline).toBe('Prime holds $600.00 of yours, as of 8/21/2026');
  });

  test('importing an older week later never changes it', () => {
    expect(heldByCarrier([S0821(), S0814()], null)).toMatchObject({ total: 600, asOf: '2026-08-21' });
    expect(heldByCarrier([S0814()], null)).toMatchObject({ total: 500, asOf: '2026-08-14' });
  });

  test('the same week twice — with and without a truck — is one balance, never 1,200', () => {
    const rows = [S0814('a', null), S0821('b', 't1'), S0821('c', null), S0821('d', 't1')];
    expect(heldByCarrier(rows, null)).toMatchObject({ total: 600, asOf: '2026-08-21' });
    expect(heldByCarrier(rows, 't1')).toMatchObject({ total: 600, asOf: '2026-08-21' });
    // An older import without the printed unit, saved without a truck,
    // folds into the one Prime account too.
    const noUnit = { ...S0814('e', null), statement: { ...statement(E0814, 3072.57), unit: null, escrow: { ...readPrimeEscrow(E0814)!, unit: null } } };
    expect(heldByCarrier([noUnit, S0821('f', 't1')], 't1')).toMatchObject({ total: 600, accounts: [expect.objectContaining({ asOf: '2026-08-21' })] });
  });

  test('two trucks: fleet = the sum of each truck\'s latest; a truck scope shows its own', () => {
    const truck2 = row('t2w', '2026-08-14', 't2', statement(primeWeek('300100', { perfBondEmergencyFundYtd: 250, escrowPriorBalance: 200, escrowThisWeek: 50 }), 900));
    const rows = [S0814(), S0821(), truck2];
    expect(heldByCarrier(rows, null)).toMatchObject({ total: 850, asOf: '2026-08-21', accounts: [expect.anything(), expect.anything()] });
    expect(heldByCarrier(rows, 't1')).toMatchObject({ total: 600 });
    expect(heldByCarrier(rows, 't2')).toMatchObject({ total: 250, asOf: '2026-08-14' });
    expect(heldByCarrierLines(heldByCarrier(rows, null), t as never, money, day).headline).toBe(
      'Your carriers hold $850.00 of yours (newest statement 8/21/2026)'
    );
  });

  test('a week whose held figure failed its checks is skipped: the latest good one is shown', () => {
    const bad = row('bad', '2026-08-21', 't1', statement(primeWeek('283940', { ...E0821.settlement!.operating!, escrowBalance: 650 }), 1884.73));
    const held = heldByCarrier([S0814(), bad], null);
    expect(held).toMatchObject({ total: 500, asOf: '2026-08-14', unverifiedWeeks: ['2026-08-21'] });
    expect(heldByCarrierLines(held, t as never, money, day).details).toContain(
      "The held balance on week ending 8/21/2026 didn't check out, so it isn't used."
    );
  });

  test('never summed from weekly deductions: re-imports, other trucks, manual and other-carrier rows change nothing', () => {
    const deductions = [
      { settlement_id: 's0814', source: 'settlement', category: 'Escrow & Deposits', amount: 100 },
      { settlement_id: 's0821', source: 'settlement', category: 'Escrow & Deposits', amount: 100 },
      { settlement_id: 'old-copy', source: 'settlement', category: 'Escrow & Deposits', amount: 100 },
      { settlement_id: null, source: 'manual', category: 'Escrow & Deposits', amount: 5000 },
    ];
    expect(heldByCarrier([S0814(), S0821()], null, { deductions })).toMatchObject({ status: 'printed', total: 600 });
  });

  test('weeks with no printed balance (B4): a labeled estimate from imported weeks, one statement per week, else "not printed yet"', () => {
    const plain = (id: string, week: string, truck: string | null) => ({ id, truck_id: truck, week_ending: week, carrier: 'Landstar', statement: null });
    const rows: HeldSettlement[] = [plain('l1', '2026-08-07', 't1'), plain('l2', '2026-08-14', 't1'), plain('l2-copy', '2026-08-14', 't1')];
    const deductions = [
      { settlement_id: 'l1', source: 'settlement', category: 'Escrow & Deposits', amount: 75 },
      { settlement_id: 'l2', source: 'settlement', category: 'Escrow & Deposits', amount: 75 },
      { settlement_id: 'l2-copy', source: 'settlement', category: 'Escrow & Deposits', amount: 75 },
      { settlement_id: null, source: 'manual', category: 'Escrow & Deposits', amount: 999 },
    ];
    const held = heldByCarrier(rows, null, { deductions });
    expect(held).toMatchObject({ status: 'estimate', accounts: [expect.objectContaining({ source: 'estimate' })] });
    expect(held.total).toBe(150);
    expect(heldByCarrierLines(held, t as never, money, day).headline).toMatch(/^Landstar: about \$\d+\.00, an estimate from imported weeks/);
    expect(heldByCarrier(rows, null)).toMatchObject({ status: 'not_printed', total: null });
    expect(heldByCarrierLines(heldByCarrier(rows, null), t as never, money, day).headline).toBe('Held by carrier: not printed yet');
  });

  test('month view (B6): held at month end = the last settlement inside that month', () => {
    const rows = [S0814(), S0821(), row('s0904', '2026-09-04', 't1', statement(primeWeek('283940', { perfBondEmergencyFundYtd: 700, escrowPriorBalance: 600, escrowThisWeek: 100 }), 2000))];
    expect(heldAtMonthEnd(rows, null, 2026, 8)).toMatchObject({ total: 600, asOf: '2026-08-21' });
    expect(heldAtMonthEnd(rows, null, 2026, 9)).toMatchObject({ total: 700, asOf: '2026-09-04' });
    expect(heldAtMonthEnd(rows, null, 2026, 7)).toMatchObject({ status: 'not_printed', total: null });
  });

  test('the daily tip uses the real figure and its as-of date', () => {
    const held = heldByCarrier([S0814(), S0821()], null);
    const tip = detectTipEscrowRefundable({ amount: held.total!, asOf: held.asOf!, carrier: 'Prime' })!;
    expect(dailyTipText(tip, 0, t, money, (n) => String(n), day)).toBe(
      'Prime holds $600.00 of yours, as of 8/21/2026. That escrow is refundable, not a business expense.'
    );
    expect(detectTipEscrowRefundable(null)).toBeNull();
  });

  test('calcEscrowBalance() is removed', () => {
    expect(() => require('@/src/stats/escrowBalance')).toThrow();
  });
});

describe('Deposited to your bank (B5): one printed deposit per statement', () => {
  test('both golden weeks: 4,957.30 vs Prime YTD 8,099.66 -> 3,142.36 is earlier weeks not imported', () => {
    const ytd = primeDepositsYtd([S0821(), S0814()], '2026-08-21');
    expect(ytd.total).toBeCloseTo(4957.3, 2);
    expect(Math.round((8099.66 - ytd.total) * 100) / 100).toBe(3142.36);
    const line = `${t('settlementsScreen.primeYtdDepositsInfo', { prime: money(8099.66), ours: money(ytd.total) })} ${t('settlementsScreen.primeYtdDepositsEarlier', { amount: '3,142.36' })}`;
    expect(line).toBe("Prime's YTD says $8,099.66; your imported weeks add up to $4,957.30 (3,142.36 is earlier weeks not imported)");
  });

  test('the same week saved twice (with and without a truck) is deposited once; two trucks are both counted', () => {
    expect(onePerStatementWeek([S0821('a', 't1'), S0821('b', null)])).toHaveLength(1);
    expect(primeDepositsYtd([S0814('a', 't1'), S0814('b', null), S0821()], '2026-08-21').total).toBeCloseTo(4957.3, 2);
    const kpi = computeKpis({
      trucks: [],
      settlements: [S0814('a', 't1'), S0814('b', null), S0821()],
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
    expect(kpi.deposits).toBeCloseTo(4957.3, 2);
    const twoTrucks = [S0821('a', 't1'), row('b', '2026-08-21', 't2', statement(primeWeek('300100', {}), 900))];
    expect(onePerStatementWeek(twoTrucks)).toHaveLength(2);
  });
});
