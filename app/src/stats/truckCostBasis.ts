// TRUCK COST BASIS (owner decision 2026-08-05, FULL PARITY follow-up item
// C.1-2) — the way real owner-operators think about their truck's fixed
// weekly cost, replacing the previous CPM engine's "sum every Loan Center
// row and multiply by settlement count" approach, which counted every
// loan on the account (trailers, personal notes, anything) as if it were
// this truck's own payment and produced a synthetic, wildly wrong figure
// on web ($8.48/mi). This module computes ONLY the active truck's own
// declared cost basis — never a guess, never derived from unrelated Loan
// Center rows.
//
// Ownership modes and their rule (spec item C.1):
//   lease — the carrier's lease-purchase withholding (a settlement-level
//     'Truck/Trailer Payments' deduction row, CPM's existing
//     `carrierAlreadyWithholdsLoanPayment` check) already counts this
//     cost. A lease adds NOTHING extra here — adding a second figure on
//     top would double-count it.
//   loan — the payment is FIXED, entered once on the truck's own cost
//     basis (never re-derived from a Loan Center schedule, which may not
//     even exist for this truck, or may include a payoff/refinance this
//     module has no way to reason about). Skipped when the carrier
//     already withholds it (same double-count guard as lease).
//   paid — no ongoing payment exists, so the owner spreads the original
//     purchase price over a number of months THEY choose (a paid-off
//     truck's "economic" cost of ownership, not a real cash outflow) —
//     `purchase_price / paid_spread_months`.
// An extended warranty (cost + term) is a separate fixed cost, added on
// top of whichever ownership-mode payment applies (or on its own if the
// truck is under warranty but has no other cost-basis figure yet).
export type OwnershipMode = 'paid' | 'loan' | 'lease';

export type TruckCostBasisInput = {
  cost_basis_ownership_mode: OwnershipMode | null;
  purchase_price: number | null;
  cost_basis_loan_monthly_payment: number | null;
  cost_basis_paid_spread_months: number | null;
  cost_basis_warranty_cost: number | null;
  cost_basis_warranty_term_months: number | null;
};

export type TruckCostBasisResult = {
  weeklyTruckPayment: number;
  weeklyWarranty: number;
  weeklyFixedTotal: number;
  // false when the truck has no ownership mode configured at all — the
  // UI shows a "not set" prompt rather than silently treating this as $0.
  isConfigured: boolean;
};

function monthlyToWeekly(monthly: number): number {
  return (monthly * 12) / 52;
}

export function calcTruckCostBasisWeekly(
  truck: TruckCostBasisInput,
  carrierAlreadyWithholdsLoanPayment: boolean
): TruckCostBasisResult {
  const mode = truck.cost_basis_ownership_mode;
  let weeklyTruckPayment = 0;

  if (mode === 'loan' && !carrierAlreadyWithholdsLoanPayment) {
    weeklyTruckPayment = monthlyToWeekly(Number(truck.cost_basis_loan_monthly_payment ?? 0));
  } else if (mode === 'paid') {
    const price = Number(truck.purchase_price ?? 0);
    const months = Number(truck.cost_basis_paid_spread_months ?? 0);
    if (price > 0 && months > 0) {
      weeklyTruckPayment = monthlyToWeekly(price / months);
    }
  }
  // mode === 'lease' (or a withheld loan payment) intentionally leaves
  // weeklyTruckPayment at 0 — see header comment.

  const warrantyCost = Number(truck.cost_basis_warranty_cost ?? 0);
  const warrantyMonths = Number(truck.cost_basis_warranty_term_months ?? 0);
  const weeklyWarranty = warrantyCost > 0 && warrantyMonths > 0 ? monthlyToWeekly(warrantyCost / warrantyMonths) : 0;

  return {
    weeklyTruckPayment,
    weeklyWarranty,
    weeklyFixedTotal: weeklyTruckPayment + weeklyWarranty,
    isConfigured: mode != null,
  };
}
