import { checkSettlementReconciliation } from '../settlementReconciliation';
import type { Extraction } from '../types';

// SETTLEMENT RECONCILIATION HARD GUARD (owner decision 2026-08-03, device
// evidence: an 11-page settlement's continuation import correctly
// captured revenue/loads/escrow but showed Net Pay $0.00 and Deductions
// $0.00 while the AI's own summary text said "Total deductions from
// truck: $4,637.15" — gross income with zero recorded expenses, a real
// tax-accuracy bug if saved). This blocks Save entirely rather than just
// flagging for review.
function settlement(overrides: Partial<NonNullable<Extraction['settlement']>>): Extraction {
  return { docType: 'settlement', settlement: { ...overrides } };
}

describe('checkSettlementReconciliation', () => {
  it('passes non-settlement extractions through untouched (n/a)', () => {
    const result = checkSettlementReconciliation({ docType: 'fuel' } as Extraction);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('passes null/undefined extraction (nothing to check yet)', () => {
    expect(checkSettlementReconciliation(null).ok).toBe(true);
    expect(checkSettlementReconciliation(undefined).ok).toBe(true);
  });

  it('passes a properly complete settlement — deductions sum to the stated total, net is nonzero', () => {
    const extraction = settlement({
      grossRevenue: 8235.47,
      totalDeductions: 4637.15,
      netPay: 3598.32,
      deductions: [
        { code: 'INS', amount: 2000 },
        { code: 'ESC', amount: 300 },
        { code: 'FUEL', amount: 2337.15 },
      ],
    });
    const result = checkSettlementReconciliation(extraction);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('passes a genuinely deduction-free settlement (stated 0, summed 0)', () => {
    const extraction = settlement({ grossRevenue: 1000, totalDeductions: 0, netPay: 1000, deductions: [] });
    expect(checkSettlementReconciliation(extraction).ok).toBe(true);
  });

  it('passes a legitimate negative-net settlement (NEGATIVE SETTLEMENTS, not this bug)', () => {
    const extraction = settlement({
      grossRevenue: 5.16,
      totalDeductions: 1160.51,
      netPay: -1155.35,
      deductions: [{ code: 'MEAL', amount: 66.95 }, { code: 'ADV', amount: 550 }, { code: 'INS', amount: 443.56 }, { code: 'BOND', amount: 100 }],
    });
    expect(checkSettlementReconciliation(extraction).ok).toBe(true);
  });

  it('BLOCKS when deduction line items do not sum to the statement\'s stated total (item 4\'s own example)', () => {
    const extraction = settlement({
      grossRevenue: 8235.47,
      totalDeductions: 4637.15,
      netPay: 3598.32,
      deductions: [{ code: 'INS', amount: 500 }],
    });
    const result = checkSettlementReconciliation(extraction);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([{ type: 'deductionsMismatch', stated: 4637.15, summed: 500 }]);
  });

  it('BLOCKS the exact reported failure mode: Net Pay $0.00 and Deductions $0.00 while gross is nonzero', () => {
    const extraction = settlement({
      grossRevenue: 8235.47,
      totalDeductions: 0,
      netPay: 0,
      deductions: [],
    });
    const result = checkSettlementReconciliation(extraction);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([{ type: 'zeroNetNonzeroGross', grossRevenue: 8235.47 }]);
  });

  it('BLOCKS when netPay is missing entirely (undefined) alongside nonzero gross', () => {
    const extraction = settlement({ grossRevenue: 8235.47, totalDeductions: 4637.15, deductions: [{ amount: 4637.15 }] });
    const result = checkSettlementReconciliation(extraction);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([{ type: 'zeroNetNonzeroGross', grossRevenue: 8235.47 }]);
  });

  it('allows small rounding differences under the dollar tolerance', () => {
    const extraction = settlement({
      grossRevenue: 1000,
      totalDeductions: 100.5,
      netPay: 899.5,
      deductions: [{ amount: 100 }],
    });
    expect(checkSettlementReconciliation(extraction).ok).toBe(true);
  });

  it('can report BOTH issues at once when both signals are wrong', () => {
    const extraction = settlement({ grossRevenue: 8235.47, totalDeductions: 4637.15, netPay: 0, deductions: [{ amount: 500 }] });
    const result = checkSettlementReconciliation(extraction);
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(2);
    expect(result.issues.map((i) => i.type)).toEqual(['deductionsMismatch', 'zeroNetNonzeroGross']);
  });
});
