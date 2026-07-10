import {
  calcContractLaborYtd,
  sumDeductibleDriverPayroll,
  calcTrueCostOfEmployee,
  calcW2EmployerTaxes,
} from '@/src/tax/driverPayroll';
import type { Driver, DriverPayment } from '@/src/types/db';

function driver(overrides: Partial<Driver>): Driver {
  return {
    id: 'd1',
    user_id: 'u1',
    name: 'Test Driver',
    phone: null,
    license: null,
    active: true,
    default_truck_id: null,
    compensation_type: 'w2_employee',
    pay_type: null,
    pay_rate: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function payment(overrides: Partial<DriverPayment>): DriverPayment {
  return {
    id: 'p1',
    user_id: 'u1',
    driver_id: 'd1',
    settlement_id: null,
    date: '2026-03-01',
    gross_pay: 0,
    employer_taxes: 0,
    notes: null,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

describe('calcContractLaborYtd', () => {
  it('sums 1099_contractor payments per driver for the given tax year', () => {
    const drivers = [driver({ id: 'd1', name: 'Alice', compensation_type: '1099_contractor' })];
    const payments = [
      payment({ driver_id: 'd1', date: '2026-02-01', gross_pay: 300 }),
      payment({ driver_id: 'd1', date: '2026-05-01', gross_pay: 400 }),
    ];
    const result = calcContractLaborYtd(payments, drivers, 2026);
    expect(result).toEqual([{ driverId: 'd1', driverName: 'Alice', ytdTotal: 700, needsNecReminder: true }]);
  });

  it('ignores payments to non-1099 drivers', () => {
    const drivers = [driver({ id: 'd1', compensation_type: 'w2_employee' })];
    const payments = [payment({ driver_id: 'd1', gross_pay: 10000 })];
    expect(calcContractLaborYtd(payments, drivers, 2026)).toEqual([]);
  });

  it('ignores payments outside the requested tax year', () => {
    const drivers = [driver({ id: 'd1', compensation_type: '1099_contractor' })];
    const payments = [payment({ driver_id: 'd1', date: '2025-12-01', gross_pay: 900 })];
    expect(calcContractLaborYtd(payments, drivers, 2026)).toEqual([]);
  });

  it('needsNecReminder is false below the $600 threshold', () => {
    const drivers = [driver({ id: 'd1', name: 'Bob', compensation_type: '1099_contractor' })];
    const payments = [payment({ driver_id: 'd1', gross_pay: 599 })];
    const result = calcContractLaborYtd(payments, drivers, 2026);
    expect(result[0].needsNecReminder).toBe(false);
  });

  it('uses the server-configured threshold when provided', () => {
    const drivers = [driver({ id: 'd1', compensation_type: '1099_contractor' })];
    const payments = [payment({ driver_id: 'd1', gross_pay: 700 })];
    const result = calcContractLaborYtd(payments, drivers, 2026, { threshold: 1000, filing_deadline: '2027-01-31' });
    expect(result[0].needsNecReminder).toBe(false);
  });
});

describe('sumDeductibleDriverPayroll', () => {
  it('sums gross_pay + employer_taxes uniformly across compensation types', () => {
    const payments = [
      payment({ gross_pay: 1000, employer_taxes: 76.5 }), // w2
      payment({ gross_pay: 500, employer_taxes: 0 }), // 1099 / team_split / trainee
    ];
    expect(sumDeductibleDriverPayroll(payments)).toBeCloseTo(1576.5, 5);
  });

  it('returns 0 for an empty list', () => {
    expect(sumDeductibleDriverPayroll([])).toBe(0);
  });
});

describe('calcTrueCostOfEmployee', () => {
  it('adds gross pay and employer taxes', () => {
    expect(calcTrueCostOfEmployee(1000, 76.5)).toBeCloseTo(1076.5, 5);
  });
});

describe('calcW2EmployerTaxes', () => {
  it('applies the employer FICA rate to gross pay', () => {
    expect(calcW2EmployerTaxes(1000, 0.0765)).toBeCloseTo(76.5, 5);
  });

  it('falls back to 0 when no rate is configured (CLAUDE.md invariant #6 graceful degradation)', () => {
    expect(calcW2EmployerTaxes(1000, undefined)).toBe(0);
  });
});
