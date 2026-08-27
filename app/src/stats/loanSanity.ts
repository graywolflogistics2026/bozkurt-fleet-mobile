// LOAN CENTER SANITY GUARD (owner decision, device report: "Total Balance
// $61,574" next to "Est. monthly payments $58,359.50" — a monthly payment
// nearly equal to the entire balance is nonsensical). The mapping code and
// the aggregate math were both audited and found correct — the likely
// cause is a bad VALUE at the source (an AI misread of an ambiguous
// settlement loan-recap table, or a manual-entry typo), not a bug in how
// this app reads/sums the fields. Since a bad value can still slip in
// again from either source, this is the backstop: never silently trust an
// implausible payment/balance ratio as fact.
//
// "a monthly payment greater than 10% of the loan balance is implausible"
// — the user's own explicit rule of thumb, taken literally. A normal
// amortizing truck/trailer loan pays off over 3-7 years, so a real
// monthly payment is a small fraction of the remaining balance; 10% would
// imply paying off the ENTIRE loan in well under a year, which no real
// truck financing term does.
export type LoanFrequency = 'weekly' | 'biweekly' | 'monthly' | string | null | undefined;

// Same conversion loans.tsx's own aggregate already uses — kept here as
// the ONE shared definition so a per-row plausibility check and the
// screen's own "Est. Monthly Payments" total can never disagree about
// what "monthly" means for a weekly/biweekly loan.
export function monthlyEquivalentPayment(payment: number | null | undefined, frequency: LoanFrequency): number {
  const p = Number(payment ?? 0);
  if (frequency === 'weekly') return p * 4.33;
  if (frequency === 'biweekly') return p * 2.17;
  return p;
}

const IMPLAUSIBLE_PAYMENT_TO_BALANCE_RATIO = 0.1;

export function isImplausibleLoanPayment(balance: number | null | undefined, monthlyPayment: number | null | undefined): boolean {
  const b = Number(balance ?? 0);
  const m = Number(monthlyPayment ?? 0);
  if (b <= 0 || m <= 0) return false;
  return m > b * IMPLAUSIBLE_PAYMENT_TO_BALANCE_RATIO;
}
