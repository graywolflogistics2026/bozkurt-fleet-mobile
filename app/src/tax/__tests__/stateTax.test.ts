import { calcStateTax } from '@/src/tax/stateTax';
import { fixtureTaxYearData } from '@/src/tax/__tests__/fixtures';

const stateTax = fixtureTaxYearData.state_tax;

describe('calcStateTax', () => {
  it('no_tax state returns 0, labeled exact', () => {
    expect(calcStateTax(100000, 'TX', true, stateTax, 'mfj')).toEqual({ amount: 0, label: 'exact' });
  });

  it('flat state applies the bare rate, labeled exact', () => {
    const result = calcStateTax(100000, 'NC', true, stateTax, 'single');
    expect(result.label).toBe('exact');
    expect(result.amount).toBeCloseTo(100000 * 0.0399, 5);
  });

  it('flat_adjustments: OH exempt_below applies AFTER the flat rate, not instead of it', () => {
    const result = calcStateTax(100000, 'OH', true, stateTax, 'single');
    // taxed only on the amount above the $26,050 exemption floor
    expect(result.amount).toBeCloseTo((100000 - 26050) * 0.0275, 5);
    expect(result.label).toBe('exact');
  });

  it('flat_adjustments: OH income entirely below the exemption floor owes 0', () => {
    const result = calcStateTax(10000, 'OH', true, stateTax, 'single');
    expect(result.amount).toBe(0);
  });

  it('flat_adjustments: MA surtax layers on top of the base flat-rate result', () => {
    const income = 1500000;
    const result = calcStateTax(income, 'MA', true, stateTax, 'mfj');
    const baseTax = income * 0.05;
    const surtax = (income - 1000000) * 0.04;
    expect(result.amount).toBeCloseTo(baseTax + surtax, 5);
    expect(result.label).toBe('exact');
  });

  it('flat_adjustments: MA below the surtax threshold pays only the base flat rate', () => {
    const result = calcStateTax(500000, 'MA', true, stateTax, 'mfj');
    expect(result.amount).toBeCloseTo(500000 * 0.05, 5);
  });

  it('bracket state (CA) computes progressive tax by filing status, labeled exact', () => {
    // single CA fixture: 0-10000@1%=100; 10000-50000@4%=1600; 50000-60000@6%=600
    const result = calcStateTax(60000, 'CA', true, stateTax, 'single');
    expect(result.amount).toBeCloseTo(100 + 1600 + 600, 5);
    expect(result.label).toBe('exact');
  });

  it('malformed/placeholder bracket entry falls back to fallback_effective_rate, labeled estimate', () => {
    const brokenStateTax = { ...stateTax, bracket: { CA: 'see docs/ADMIN_RUNBOOK.md' as unknown } };
    const result = calcStateTax(100000, 'CA', true, brokenStateTax, 'single');
    expect(result.label).toBe('estimate');
    expect(result.amount).toBeCloseTo(100000 * stateTax.fallback_effective_rate, 5);
  });

  it('unlisted state falls back to fallback_effective_rate, labeled estimate', () => {
    const result = calcStateTax(100000, 'CO', true, stateTax, 'single');
    expect(result.label).toBe('estimate');
    expect(result.amount).toBeCloseTo(100000 * 0.045, 5);
  });

  it('include_state_tax=false omits the state line regardless of state', () => {
    expect(calcStateTax(100000, 'CA', false, stateTax, 'single')).toEqual({ amount: 0, label: 'none' });
  });
});
