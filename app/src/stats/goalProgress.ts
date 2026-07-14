export function calcGoalProgressPct(currentNet: number, weeklyGoal: number | null | undefined): number | null {
  if (!weeklyGoal || weeklyGoal <= 0) return null;
  return Math.round((currentNet / weeklyGoal) * 100);
}

export type TruckLoanProgress = { paidPrincipal: number; originalAmount: number; pct: number };
type LoanLike = { original_amount: number | null; balance: number | null };

// Truck Paid progress (Session 9d item 9) — picks the loan with the
// largest original_amount as "the truck loan": this app's Loan Center is
// truck/trailer financing only (every loan row rolls into the single
// "Truck/Trailer Payments" Schedule C bucket, src/stats/
// accountantPackage.ts), but LoanRow has no truck_id to scope by, so the
// single biggest loan is the reasonable stand-in for "the truck" when
// more than one loan row exists.
export function calcTruckLoanProgress(loans: LoanLike[]): TruckLoanProgress | null {
  const withAmount = loans.filter((l) => (l.original_amount ?? 0) > 0);
  if (withAmount.length === 0) return null;
  const loan = withAmount.reduce((a, b) => ((b.original_amount ?? 0) > (a.original_amount ?? 0) ? b : a));
  const originalAmount = Number(loan.original_amount ?? 0);
  const paidPrincipal = Math.max(0, originalAmount - Number(loan.balance ?? 0));
  return { paidPrincipal, originalAmount, pct: Math.min(100, Math.round((paidPrincipal / originalAmount) * 100)) };
}
