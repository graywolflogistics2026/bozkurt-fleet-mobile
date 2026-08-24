import {
  detectNoRecentSettlement,
  detectSettlementMissingMiles,
  detectTruckCostBasisNotSet,
  detectDepreciationNotSet,
  detectNeedsReviewReceipts,
  buildMissingDataNudgeCandidates,
} from '@/src/alerts/missingDataNudges';

const NOW = new Date('2026-08-24T12:00:00Z');

describe('detectNoRecentSettlement', () => {
  test('no settlements at all — null (empty-state, not a nudge)', () => {
    expect(detectNoRecentSettlement([], NOW)).toBeNull();
  });

  test('latest settlement within 10 days — null', () => {
    expect(detectNoRecentSettlement([{ week_ending: '2026-08-18' }], NOW)).toBeNull();
  });

  test('latest settlement 10+ days ago — fires with the real day count', () => {
    expect(detectNoRecentSettlement([{ week_ending: '2026-08-10' }], NOW)).toEqual({
      topic: 'noRecentSettlement',
      detail: { days: 14 },
    });
  });

  test('uses the MOST RECENT of several settlements', () => {
    expect(detectNoRecentSettlement([{ week_ending: '2026-07-01' }, { week_ending: '2026-08-20' }], NOW)).toBeNull();
  });
});

describe('detectSettlementMissingMiles', () => {
  test('no settlements with revenue-but-no-miles — null', () => {
    expect(detectSettlementMissingMiles([{ gross: 1000, miles: 500 }])).toBeNull();
  });

  test('a settlement with revenue and zero/null miles — fires with count', () => {
    expect(detectSettlementMissingMiles([{ gross: 1000, miles: 0 }, { gross: 500, miles: null }, { gross: 800, miles: 400 }])).toEqual({
      topic: 'settlementMissingMiles',
      detail: { count: 2 },
    });
  });

  test('a zero-revenue home week with no miles does not count', () => {
    expect(detectSettlementMissingMiles([{ gross: 0, miles: 0 }])).toBeNull();
  });
});

describe('detectTruckCostBasisNotSet', () => {
  test('company driver — never fires (owners only)', () => {
    expect(detectTruckCostBasisNotSet([{ cost_basis_ownership_mode: null }], 'company_driver_w2')).toBeNull();
  });

  test('owner with an unconfigured truck — fires', () => {
    expect(detectTruckCostBasisNotSet([{ cost_basis_ownership_mode: null }], 'owner_operator')).toEqual({
      topic: 'truckCostBasisNotSet',
      detail: { count: 1 },
    });
  });

  test('owner with every truck configured — null', () => {
    expect(detectTruckCostBasisNotSet([{ cost_basis_ownership_mode: 'paid' }], 'owner_operator')).toBeNull();
  });
});

describe('detectDepreciationNotSet', () => {
  test('company driver — never fires', () => {
    expect(
      detectDepreciationNotSet([{ cost_basis_ownership_mode: 'paid', depreciation_method: null }], 'company_driver_w2')
    ).toBeNull();
  });

  test('a leased truck never counts as missing (not depreciable at all)', () => {
    expect(detectDepreciationNotSet([{ cost_basis_ownership_mode: 'lease', depreciation_method: null }], 'owner_operator')).toBeNull();
  });

  test('a purchased truck with no depreciation method — fires', () => {
    expect(detectDepreciationNotSet([{ cost_basis_ownership_mode: 'paid', depreciation_method: null }], 'owner_operator')).toEqual({
      topic: 'depreciationNotSet',
      detail: { count: 1 },
    });
  });
});

describe('detectNeedsReviewReceipts', () => {
  test('none flagged — null', () => {
    expect(detectNeedsReviewReceipts([{ description: 'Fuel purchase' }])).toBeNull();
  });

  test('some flagged — fires with count', () => {
    expect(
      detectNeedsReviewReceipts([{ description: 'NEEDS REVIEW: Amazon' }, { description: 'Fuel' }, { description: 'NEEDS REVIEW: Walmart' }])
    ).toEqual({ topic: 'needsReviewReceipts', detail: { count: 2 } });
  });
});

describe('buildMissingDataNudgeCandidates', () => {
  test('combines every detector, dropping nulls', () => {
    const result = buildMissingDataNudgeCandidates({
      settlements: [{ week_ending: '2026-08-01', gross: 1000, miles: 0 }],
      trucks: [{ cost_basis_ownership_mode: null, depreciation_method: null }],
      deductions: [{ description: 'NEEDS REVIEW: something' }],
      role: 'owner_operator',
      now: NOW,
    });
    const topics = result.map((c) => c.topic).sort();
    expect(topics).toEqual(
      ['noRecentSettlement', 'settlementMissingMiles', 'truckCostBasisNotSet', 'depreciationNotSet', 'needsReviewReceipts'].sort()
    );
  });

  test('a company driver never gets the two owner-only topics', () => {
    const result = buildMissingDataNudgeCandidates({
      settlements: [],
      trucks: [{ cost_basis_ownership_mode: null, depreciation_method: null }],
      deductions: [],
      role: 'company_driver_w2',
      now: NOW,
    });
    expect(result).toEqual([]);
  });
});
