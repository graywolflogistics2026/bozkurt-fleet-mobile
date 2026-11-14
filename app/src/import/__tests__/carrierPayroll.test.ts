// CARRIER PAYROLL DRIVERS (owner 2026-11-13, §88): the pure rules.
import type { Extraction } from '@/src/import/types';
import {
  carrierDisplayName,
  carrierPayrollOf,
  carrierPayrollSummary,
  isCarrierPayrollPayment,
  needsDriverName,
  wageLineDriverCode,
} from '@/src/import/carrierPayroll';
import { withAttachment } from '@/src/settlementReader/machine';
import type { AttachmentReply } from '@/src/settlementReader/schema';
import { sumDeductibleDriverPayroll } from '@/src/tax/driverPayroll';

// 11/06 as printed (GRWLLG-OY-PrimeInc17.pdf page 2).
const WAGES_1106 = [
  { code: 'DF', desc: 'F.I.C.A. FOR            BOZKME', amount: 54.99 },
  { code: 'DU', desc: 'F.U.T.A. FOR            BOZKME', amount: 4.31 },
  { code: 'DU', desc: 'S.U.T.A. FOR            BOZKME', amount: 1.43 },
  { code: 'WC', desc: 'WORK COMP COST          BOZKME', amount: 79.66 },
  { code: 'WD', desc: 'WAGES PAID FOR          BOZKME', amount: 663.87 },
  { code: '2S', desc: 'Emp Driver Wellness Bnf BOZKME', amount: 1.24 },
];

function week(over: Partial<NonNullable<Extraction['settlement']>> = {}): Extraction {
  return {
    docType: 'settlement',
    confidence: 'high',
    settlement: {
      weekEnding: '2026-11-06',
      carrier: 'PRIME INC.',
      revenueItems: [{ code: 'RV', desc: 'TRIP REVENUE + TEAM', order: '5216006', amount: 1691.94 }],
      // The fuel lines print BOZKME too: never a driver source.
      deductions: [
        { code: 'UF', desc: 'TRACTOR FUEL 128.8 GALS. C00794742 GI NE 7371865 BOZKME', amount: 850 },
        { code: 'PF', desc: 'PAYROLL FEE', amount: 10 },
      ],
      wageItems: WAGES_1106,
      totalWageExpense: 805.5,
      ...over,
    },
  } as Extraction;
}

describe('the driver code on a wage line', () => {
  test.each([
    ['F.I.C.A. FOR            BOZKME', 'BOZKME'],
    ['Emp Driver Wellness Bnf BOZKME', 'BOZKME'],
    ['WAGES PAID FOR', null],
    ['WORK COMP COST', null],
    ['Emp Driver Wellness Bnf', null],
    ['Emp Driver Wellness', null],
    ['BOZKME', null],
    ['', null],
  ])('%s -> %s', (desc, code) => expect(wageLineDriverCode(desc)).toBe(code));
});

describe('carrierPayrollOf', () => {
  test('11/06: wages 665.11, taxes 60.73, work comp 79.66, total 805.50 (the printed TOTAL WAGE EXPENSE); a team week', () => {
    expect(carrierPayrollOf(week())).toEqual({
      carrier: 'PRIME INC',
      teamWeek: true,
      drivers: [{ code: 'BOZKME', name: null, wages: 665.11, employerTaxes: 60.73, workComp: 79.66, total: 805.5 }],
    });
  });

  test('11/13: wages 913.06, taxes 76.85, work comp 109.15, total 1,099.06; the name from the payroll recap', () => {
    const e = week({
      totalWageExpense: 1099.06,
      wageItems: [
        { code: 'DF', desc: 'F.I.C.A. FOR BOZKME', amount: 69.59 },
        { code: 'DU', desc: 'F.U.T.A. FOR BOZKME', amount: 5.45 },
        { code: 'DU', desc: 'S.U.T.A. FOR BOZKME', amount: 1.81 },
        { code: 'WC', desc: 'WORK COMP COST BOZKME', amount: 109.15 },
        { code: 'WD', desc: 'WAGES PAID FOR BOZKME', amount: 909.61 },
        { code: '2S', desc: 'Emp Driver Wellness Bnf BOZKME', amount: 3.45 },
      ],
      payrollEmployees: [{ code: 'BOZKME', name: 'MERVE BOZKURT' }],
    });
    expect(carrierPayrollOf(e)!.drivers).toEqual([{ code: 'BOZKME', name: 'MERVE BOZKURT', wages: 913.06, employerTaxes: 76.85, workComp: 109.15, total: 1099.06 }]);
  });

  test('a line-sum difference never blocks: the printed total stays the total', () => {
    const e = week({ wageItems: WAGES_1106.slice(0, 5) });
    expect(carrierPayrollOf(e)!.drivers[0]).toMatchObject({ wages: 663.87, total: 805.5 });
  });

  test('a wage line read without its code belongs to the week\'s only driver', () => {
    const e = week({ wageItems: WAGES_1106.map((w) => (w.code === 'WC' ? { ...w, desc: 'WORK COMP COST' } : w)) });
    expect(carrierPayrollOf(e)!.drivers[0].workComp).toBe(79.66);
  });

  test('no driver without a WAGES PAID (WD) line that names one; never from fuel lines', () => {
    expect(carrierPayrollOf(week({ wageItems: [] }))).toBeNull();
    expect(carrierPayrollOf(week({ wageItems: WAGES_1106.filter((w) => w.code !== 'WD') }))).toBeNull();
    expect(carrierPayrollOf(week({ wageItems: WAGES_1106.map((w) => ({ ...w, desc: w.desc.replace('BOZKME', '') })) }))).toBeNull();
  });

  test('two drivers: one row each, each total its own lines', () => {
    const e = week({
      totalWageExpense: 1000,
      wageItems: [
        { code: 'WD', desc: 'WAGES PAID FOR AAAAAA', amount: 500 },
        { code: 'DF', desc: 'F.I.C.A. FOR AAAAAA', amount: 40 },
        { code: 'WD', desc: 'WAGES PAID FOR BBBBBB', amount: 400 },
        { code: 'WC', desc: 'WORK COMP COST BBBBBB', amount: 60 },
      ],
    });
    expect(carrierPayrollOf(e)!.drivers.map((d) => [d.code, d.wages, d.employerTaxes, d.workComp, d.total])).toEqual([
      ['AAAAAA', 500, 40, 0, 540],
      ['BBBBBB', 400, 0, 60, 460],
    ]);
  });

  test('carrier isolation: another carrier or a non-settlement is never read', () => {
    expect(carrierPayrollOf(week({ carrier: 'ACME FREIGHT' }))).toBeNull();
    expect(carrierPayrollOf({ ...week(), docType: 'fuel' } as Extraction)).toBeNull();
  });

  test('no "+ TEAM" revenue line: a solo week', () => {
    expect(carrierPayrollOf(week({ revenueItems: [{ desc: 'TRIP REVENUE', amount: 1 }] } as never))!.teamWeek).toBe(false);
  });
});

describe('the payroll recap page (attachment read)', () => {
  const page = (employees: { code: string; name: string }[]): AttachmentReply => ({
    kind: 'payroll_recap',
    repair: { invoice: '', shop: '', unit: '', description: '', odometer: '', total: '' },
    tolls: { agency: '', total: '', items: [] },
    payroll: { employees },
  });

  test('one entry per code; the first name read wins; an empty name never replaces one', () => {
    let e = withAttachment(week(), 6, page([{ code: 'bozkme', name: '' }]));
    e = withAttachment(e, 7, page([{ code: 'BOZKME', name: ' MERVE   BOZKURT ' }]));
    e = withAttachment(e, 8, page([{ code: 'BOZKME', name: '' }, { code: 'BOZKME', name: 'OTHER' }]));
    expect(e.settlement!.payrollEmployees).toEqual([{ code: 'BOZKME', name: 'MERVE BOZKURT' }]);
    expect(carrierPayrollOf(e)!.drivers[0].name).toBe('MERVE BOZKURT');
  });

  test('a recap page never touches a total or a line', () => {
    const before = week();
    const after = withAttachment(before, 6, page([{ code: 'BOZKME', name: 'MERVE BOZKURT' }]));
    expect({ ...after.settlement, payrollEmployees: undefined }).toEqual({ ...before.settlement, payrollEmployees: undefined });
  });
});

describe('attribution only', () => {
  const payments = [
    { driver_id: 'd1', settlement_id: 's1', date: '2026-11-06', gross_pay: 665.11, employer_taxes: 60.73, work_comp: 79.66, total_cost: 805.5, source: 'settlement' as const },
    { driver_id: 'd1', settlement_id: 's2', date: '2026-11-13', gross_pay: 913.06, employer_taxes: 76.85, work_comp: 109.15, total_cost: 1099.06, source: 'settlement' as const },
  ];

  test('the Drivers card: latest week 11/13, year to date 1,904.56 over 2 paid weeks', () => {
    expect(carrierPayrollSummary(payments, 'd1', '2026-11-14')).toEqual({
      latest: { date: '2026-11-13', settlementId: 's2', wages: 913.06, employerTaxes: 76.85, workComp: 109.15, total: 1099.06 },
      ytd: { wages: 1578.17, employerTaxes: 137.58, workComp: 188.81, total: 1904.56 },
      paidWeeks: 2,
    });
  });

  test('never a second expense in the tax estimate; a manual payment still counts', () => {
    const manual = { id: 'm', user_id: 'u', driver_id: 'd2', settlement_id: null, date: '2026-11-01', gross_pay: 100, employer_taxes: 7.65, notes: null, tags: null, created_at: '', updated_at: '' };
    expect(sumDeductibleDriverPayroll([...payments, manual] as never)).toBeCloseTo(107.65, 2);
    expect(isCarrierPayrollPayment(payments[0])).toBe(true);
    expect(isCarrierPayrollPayment(manual)).toBe(false);
  });

  test('"Who is BOZKME?" only while the name is the code; "W-2 via Prime"', () => {
    expect(needsDriverName({ name: 'BOZKME', carrier_driver_code: 'BOZKME' })).toBe(true);
    expect(needsDriverName({ name: 'MERVE BOZKURT', carrier_driver_code: 'BOZKME' })).toBe(false);
    expect(needsDriverName({ name: 'Ali', carrier_driver_code: null })).toBe(false);
    expect(carrierDisplayName('PRIME INC')).toBe('Prime');
  });
});
