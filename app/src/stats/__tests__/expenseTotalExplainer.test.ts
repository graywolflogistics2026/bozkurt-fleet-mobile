import { buildExpenseTotalExplainer } from '@/src/stats/expenseTotalExplainer';

describe('buildExpenseTotalExplainer (owner decision 2026-08-05, FULL PARITY follow-up item D)', () => {
  it('sums total/fixed/variable using the same classification as CPM', () => {
    const result = buildExpenseTotalExplainer([
      { id: '1', description: 'Insurance', amount: 100, category: 'Insurance—Truck' }, // fixed
      { id: '2', description: 'Diesel', amount: 400, category: 'Fuel & DEF' }, // variable
    ]);
    expect(result.total).toBe(500);
    expect(result.fixedTotal).toBe(100);
    expect(result.variableTotal).toBe(400);
  });

  it('returns the 12 largest rows, sorted descending, capped at 12', () => {
    const deductions = Array.from({ length: 20 }, (_, i) => ({
      id: `d${i}`,
      description: `Expense ${i}`,
      amount: i + 1,
      category: 'Other',
    }));
    const result = buildExpenseTotalExplainer(deductions);
    expect(result.largestRows).toHaveLength(12);
    expect(result.largestRows[0].amount).toBe(20);
    expect(result.largestRows[11].amount).toBe(9);
  });

  it('flags a row over 15% of the total as a possible depreciable asset', () => {
    const result = buildExpenseTotalExplainer([
      { id: '1', description: 'Transmission overhaul', amount: 6000, category: 'Major Repairs & Overhauls' },
      { id: '2', description: 'Fuel', amount: 400, category: 'Fuel & DEF' },
      { id: '3', description: 'Tolls', amount: 100, category: 'Tolls & Scales' },
    ]);
    // 6000 / 6500 = 92% — well over 15%
    const big = result.largestRows.find((r) => r.id === '1');
    expect(big?.isPossibleDepreciableAsset).toBe(true);
    const small = result.largestRows.find((r) => r.id === '2');
    expect(small?.isPossibleDepreciableAsset).toBe(false);
  });

  it('never flags anything when the total is 0 (avoids a divide-by-zero false positive)', () => {
    const result = buildExpenseTotalExplainer([{ id: '1', description: 'Free item', amount: 0, category: 'Other' }]);
    expect(result.largestRows[0].isPossibleDepreciableAsset).toBe(false);
  });

  it('auto-excludes vehicle-purchase-shaped descriptions from the total, buckets, and largest rows', () => {
    const result = buildExpenseTotalExplainer([
      { id: '1', description: 'Truck down payment', amount: 15000, category: 'Other' },
      { id: '2', description: 'Fuel', amount: 400, category: 'Fuel & DEF' },
    ]);
    expect(result.total).toBe(400);
    expect(result.excludedVehiclePurchaseTotal).toBe(15000);
    expect(result.largestRows.map((r) => r.id)).toEqual(['2']);
  });
});
