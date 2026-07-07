import type { Deduction } from '@/src/types/db';

export type DeductionGroups = {
  outOfPocket: Deduction[];
  withheld: Deduction[];
  outOfPocketTotal: number;
  withheldTotal: number;
};

// Verbatim grouping from legacy rDed()/isSettlementDed()
// (legacy/index.html:1781-1787): withheld rows are deductions Prime already
// took out of net pay (source === 'settlement') — display-only, never
// counted toward the tax deduction total (CLAUDE.md invariant #1).
// Everything else is money the owner paid out of pocket and IS
// tax-deductible.
export function isSettlementDed(x: Deduction): boolean {
  return x.source === 'settlement';
}

export function groupDeductions(rows: Deduction[]): DeductionGroups {
  const outOfPocket = rows.filter((x) => !isSettlementDed(x));
  const withheld = rows.filter(isSettlementDed);
  return {
    outOfPocket,
    withheld,
    outOfPocketTotal: outOfPocket.reduce((sum, x) => sum + Number(x.amount ?? 0), 0),
    withheldTotal: withheld.reduce((sum, x) => sum + Number(x.amount ?? 0), 0),
  };
}
