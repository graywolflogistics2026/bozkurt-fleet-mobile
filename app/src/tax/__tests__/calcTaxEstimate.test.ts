import { calcTaxEstimate } from '@/src/tax/calcTaxEstimate';
import { fixtureTaxYearData } from '@/src/tax/__tests__/fixtures';
import type { TaxEstimateInputs } from '@/src/tax/types';

const base: TaxEstimateInputs = {
  taxYearData: fixtureTaxYearData,
  filingStatus: 'mfj',
  state: 'TX',
  includeStateTax: true,
  entityType: 'sole_prop',
  scorpSalary: null,
  netProfit: 100000,
};

describe('calcTaxEstimate', () => {
  it('sole_prop applies SE tax to the full net profit', () => {
    const result = calcTaxEstimate(base);
    expect(result.seTaxBase).toBe(100000);
    expect(result.seTax).toBeCloseTo(100000 * 0.9235 * 0.153, 5);
  });

  it('smllc is IDENTICAL to sole_prop — same math, no second code path', () => {
    const soleProp = calcTaxEstimate(base);
    const smllc = calcTaxEstimate({ ...base, entityType: 'smllc' });
    expect(smllc).toEqual(soleProp);
  });

  it('scorp applies SE tax only to scorp_salary, not full net profit', () => {
    const result = calcTaxEstimate({ ...base, entityType: 'scorp', scorpSalary: 40000 });
    expect(result.seTaxBase).toBe(40000);
    expect(result.seTax).toBeCloseTo(40000 * 0.9235 * 0.153, 5);
  });

  it('scorp still applies federal/state brackets to TOTAL net profit (salary + distributions)', () => {
    const soleProp = calcTaxEstimate(base);
    const scorp = calcTaxEstimate({ ...base, entityType: 'scorp', scorpSalary: 40000 });
    // Same AGI-feeding netProfit, only the SE-tax deduction differs (smaller
    // SE tax => smaller deduction => a somewhat higher taxable income for
    // scorp) — but both start from the same $100k net profit, not a
    // salary-only figure, so taxableIncome is close for both and federal
    // bracket usage is on the same scale.
    expect(scorp.agi).toBeGreaterThan(0);
    expect(scorp.netProfit).toBe(soleProp.netProfit);
  });

  it('scorp SE-tax base is capped at net profit even if scorp_salary is set higher', () => {
    const result = calcTaxEstimate({ ...base, entityType: 'scorp', scorpSalary: 500000 });
    expect(result.seTaxBase).toBe(100000);
  });

  it('total tax is SE tax + federal tax + state tax', () => {
    const result = calcTaxEstimate({ ...base, state: 'NC' });
    expect(result.totalTax).toBeCloseTo(result.seTax + result.federalTax + result.stateTax.amount, 5);
  });

  it('quarterly payment is a quarter of total tax, weekly reserve is a 52nd', () => {
    const result = calcTaxEstimate(base);
    expect(result.quarterlyPayment).toBeCloseTo(result.totalTax / 4, 5);
    expect(result.weeklyTaxReserve).toBeCloseTo(result.totalTax / 52, 5);
  });

  it('effective rate is null (legacy shows "—") when net profit is 0', () => {
    const result = calcTaxEstimate({ ...base, netProfit: 0 });
    expect(result.effectiveRate).toBeNull();
  });

  it('effective rate is totalTax/netProfit as a percentage', () => {
    const result = calcTaxEstimate(base);
    expect(result.effectiveRate).toBeCloseTo((result.totalTax / 100000) * 100, 5);
  });

  describe('scorp employer payroll tax (owner decision 2026-07-10)', () => {
    it('estimates employer FICA on scorp_salary as a real business expense reducing ownerShareOfProfit', () => {
      const result = calcTaxEstimate({ ...base, entityType: 'scorp', scorpSalary: 40000 });
      expect(result.employerPayrollTax).toBeCloseTo(40000 * 0.0765, 5);
      expect(result.ownerShareOfProfit).toBeCloseTo(100000 - 40000 * 0.0765, 5);
    });

    it('does not estimate employer FICA when scorp_payroll_tax_handled is true (provider already accounts for it)', () => {
      const result = calcTaxEstimate({
        ...base,
        entityType: 'scorp',
        scorpSalary: 40000,
        scorpPayrollTaxHandled: true,
      });
      expect(result.employerPayrollTax).toBe(0);
      expect(result.ownerShareOfProfit).toBe(100000);
    });

    it('sole_prop/smllc never estimate an employer payroll tax', () => {
      expect(calcTaxEstimate(base).employerPayrollTax).toBe(0);
      expect(calcTaxEstimate({ ...base, entityType: 'smllc' }).employerPayrollTax).toBe(0);
    });
  });

  describe('multi_member_llc ownership scoping (owner decision 2026-07-10)', () => {
    it('scopes ownerShareOfProfit and the SE-tax base to ownershipPct', () => {
      const result = calcTaxEstimate({ ...base, entityType: 'multi_member_llc', ownershipPct: 40 });
      expect(result.ownerShareOfProfit).toBeCloseTo(40000, 5);
      expect(result.seTaxBase).toBeCloseTo(40000, 5);
      expect(result.netProfit).toBe(100000); // full LLC profit, unscoped
    });

    it('defaults to 100% (full share) when ownershipPct is omitted', () => {
      const result = calcTaxEstimate({ ...base, entityType: 'multi_member_llc' });
      expect(result.ownerShareOfProfit).toBe(100000);
    });

    it('clamps ownershipPct to [0, 100]', () => {
      const over = calcTaxEstimate({ ...base, entityType: 'multi_member_llc', ownershipPct: 150 });
      const under = calcTaxEstimate({ ...base, entityType: 'multi_member_llc', ownershipPct: -10 });
      expect(over.ownerShareOfProfit).toBe(100000);
      expect(under.ownerShareOfProfit).toBe(0);
    });

    it('effectiveRate is computed against the scoped share, not full LLC profit', () => {
      const result = calcTaxEstimate({ ...base, entityType: 'multi_member_llc', ownershipPct: 40 });
      expect(result.effectiveRate).toBeCloseTo((result.totalTax / 40000) * 100, 5);
    });
  });
});
