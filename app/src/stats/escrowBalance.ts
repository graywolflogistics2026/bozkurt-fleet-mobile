// ESCROW & DEPOSITS running balance (owner decision 2026-08-02, verified
// against a real statement with a "PERFORMNCE BOND" OCR-damaged line):
// performance bond / escrow reserve / tire fund / emergency fund /
// maintenance reserve deductions are REFUNDABLE DEPOSITS the carrier
// holds on the driver's behalf, not business expenses (CLAUDE.md's
// NON_DEDUCTIBLE_CATEGORIES, src/import/category.ts; excluded from
// true profit, src/stats/trueProfit.ts's TRUE_PROFIT_EXCLUDED_CATEGORIES).
// Because that money never left the business as a real cost, the user
// still needs to see what the carrier is currently holding — this is a
// simple running total of every "Escrow & Deposits" withheld deduction to
// date. There is no refund/release tracking in this app yet (no ai-import
// docType represents "carrier returned the escrow"), so this is
// deliberately a cumulative HELD total, not a net-of-refunds balance —
// exactly the smart-default scope the owner asked for; a future refund
// docType would need its own explicit product decision to net against
// this.
export const ESCROW_CATEGORY = 'Escrow & Deposits';

export function calcEscrowBalance(deductions: Array<{ category: string | null; amount: number | null }>): number {
  return deductions
    .filter((d) => d.category === ESCROW_CATEGORY)
    .reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
}
