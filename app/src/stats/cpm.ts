export type CpmResult = {
  revenuePerMile: number | null;
  costPerMile: number | null;
  profitPerMile: number | null;
};

// Verbatim port of legacy rDash()'s cost-per-mile block (legacy/index.html:1364-1372):
//   const rpm=grossRev/totalMiles, cpm=totalCost/totalMiles, ppm=rpm-cpm;
// `totalDeductions` here is ALL deductions (settlement-withheld AND
// out-of-pocket combined) — the same figure the Dashboard's "Total
// Deductions" card shows. This is intentionally a DIFFERENT total than the
// tax engine's net-profit expense figure, which uses only out-of-pocket
// deductions (source != 'settlement') — legacy keeps CPM and the tax
// estimator as two separate views of expenses, and this port preserves
// that rather than unifying them.
export function calcCpm(grossRevenue: number, totalDeductions: number, totalMiles: number): CpmResult {
  if (totalMiles <= 0) return { revenuePerMile: null, costPerMile: null, profitPerMile: null };
  const revenuePerMile = grossRevenue / totalMiles;
  const costPerMile = totalDeductions / totalMiles;
  return { revenuePerMile, costPerMile, profitPerMile: revenuePerMile - costPerMile };
}

// legacy: $('d-ppm').style.color = ppm>0.5?'var(--grn)':ppm>0?'var(--org)':'var(--red)'
export function ppmColor(ppm: number): 'green' | 'orange' | 'red' {
  if (ppm > 0.5) return 'green';
  if (ppm > 0) return 'orange';
  return 'red';
}
