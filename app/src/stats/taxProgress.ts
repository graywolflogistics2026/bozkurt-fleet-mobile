export type TaxProgressColor = 'green' | 'amber' | 'red';

// Tax Progress bar (Session 9d item 5) — the bar's FILL is reserved
// business_balance ÷ the full-year Federal+SE estimated tax
// (tax.estimate.totalTax), but its COLOR reflects days until the next
// quarterly deadline instead: < 30 amber, < 7 red, exactly the thresholds
// the owner specified for this element — deliberately NOT
// src/tax/quarterly.ts's own 14-day "urgent" cutoff, which governs a
// different card (Quarterly Payment) that already shipped before this one.
export function calcTaxProgressColor(daysUntil: number | null | undefined): TaxProgressColor {
  if (daysUntil == null) return 'green';
  if (daysUntil < 7) return 'red';
  if (daysUntil < 30) return 'amber';
  return 'green';
}

export function calcTaxProgressPct(reserved: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((reserved / target) * 100)));
}
