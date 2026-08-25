import {
  detectNoRecentSettlement,
  detectSettlementMissingMiles,
  detectTruckCostBasisNotSet,
  detectDepreciationNotSet,
  detectNeedsReviewReceipts,
  detectWeeklyGoalNotSet,
  detectComplianceItemMissing,
  detectEntityTypeNotSet,
  detectHomeStateNotSet,
  detectFirstReceiptMissing,
  detectBusinessBalanceNotSet,
  detectPerDiemZeroMileWeek,
  buildMissingDataNudgeCandidates,
} from '@/src/alerts/missingDataNudges';
import { isComplianceTypeVisibleForRole } from '@/src/alerts/roleFilter';

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
    expect(detectNeedsReviewReceipts([{ description: 'Fuel purchase', reviewed_at: null }])).toBeNull();
  });

  test('some flagged — fires with count', () => {
    expect(
      detectNeedsReviewReceipts([
        { description: 'NEEDS REVIEW: Amazon', reviewed_at: null },
        { description: 'Fuel', reviewed_at: null },
        { description: 'NEEDS REVIEW: Walmart', reviewed_at: null },
      ])
    ).toEqual({ topic: 'needsReviewReceipts', detail: { count: 2 } });
  });

  // NEEDS REVIEW WON'T CLEAR — THE FIX (owner decision 2026-08-24): a
  // row marked reviewed must never keep nudging here.
  test('a reviewed row is excluded even though its description still has the prefix', () => {
    expect(
      detectNeedsReviewReceipts([
        { description: 'NEEDS REVIEW: Amazon', reviewed_at: '2026-08-24T00:00:00Z' },
        { description: 'NEEDS REVIEW: Walmart', reviewed_at: null },
      ])
    ).toEqual({ topic: 'needsReviewReceipts', detail: { count: 1 } });
  });
});

describe('buildMissingDataNudgeCandidates', () => {
  test('combines every detector, dropping nulls', () => {
    const result = buildMissingDataNudgeCandidates({
      settlements: [{ week_ending: '2026-08-01', gross: 1000, miles: 0 }],
      trucks: [{ cost_basis_ownership_mode: null, depreciation_method: null }],
      deductions: [{ description: 'NEEDS REVIEW: something', reviewed_at: null }],
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

  // "UNLOCK" NUDGES (2026-08-24 FIVE ADDITIONS pass item 1) — every new
  // optional field is omitted here, proving the two tests above (written
  // before this pass) keep behaving identically: an omitted field means
  // "unknown," never a false-positive "confirmed unset."
  test('new optional unlock fields, when omitted, never fire', () => {
    const result = buildMissingDataNudgeCandidates({
      settlements: [{ week_ending: '2026-08-01', gross: 1000, miles: 0 }],
      trucks: [{ cost_basis_ownership_mode: null, depreciation_method: null }],
      deductions: [{ description: 'NEEDS REVIEW: something', reviewed_at: null }],
      role: 'owner_operator',
      now: NOW,
    });
    const topics = result.map((c) => c.topic);
    expect(topics).not.toContain('weeklyGoalNotSet');
    expect(topics).not.toContain('complianceItemMissing');
    expect(topics).not.toContain('entityTypeNotSet');
    expect(topics).not.toContain('homeStateNotSet');
    expect(topics).not.toContain('firstReceiptMissing');
    expect(topics).not.toContain('businessBalanceNotSet');
    expect(topics).not.toContain('perDiemZeroMileWeek');
  });

  test('every new field supplied — all fire together', () => {
    const result = buildMissingDataNudgeCandidates({
      settlements: [{ week_ending: '2026-08-01', gross: 0, miles: 0, per_diem_days: 0 }],
      trucks: [],
      deductions: [],
      role: 'owner_operator',
      now: NOW,
      weeklyGoal: null,
      suggestedWeeklyGoal: 1200,
      existingComplianceTypes: [],
      isComplianceTypeVisibleForRole,
      entityTypeSet: false,
      homeState: null,
      deductionsCount: 0,
      cfBankBalance: null,
      perDiemDailyRate: 64,
      checkPerDiemZeroMileWeek: true,
    });
    const topics = result.map((c) => c.topic).sort();
    expect(topics).toEqual(
      [
        'noRecentSettlement',
        'weeklyGoalNotSet',
        'complianceItemMissing',
        'entityTypeNotSet',
        'homeStateNotSet',
        'firstReceiptMissing',
        'businessBalanceNotSet',
        'perDiemZeroMileWeek',
      ].sort()
    );
  });
});

describe('detectSettlementMissingMiles — currentCpm', () => {
  test('no cpm supplied — count only', () => {
    expect(detectSettlementMissingMiles([{ gross: 1000, miles: 0 }])).toEqual({
      topic: 'settlementMissingMiles',
      detail: { count: 1 },
    });
  });

  test('cpm supplied — names the real inflated figure', () => {
    expect(detectSettlementMissingMiles([{ gross: 1000, miles: 0 }], 4.125)).toEqual({
      topic: 'settlementMissingMiles',
      detail: { count: 1, currentCpm: 4.13 },
    });
  });
});

describe('detectDepreciationNotSet — previewTotal', () => {
  test('no preview supplied — count only', () => {
    expect(detectDepreciationNotSet([{ cost_basis_ownership_mode: 'paid', depreciation_method: null }], 'owner_operator')).toEqual({
      topic: 'depreciationNotSet',
      detail: { count: 1 },
    });
  });

  test('preview supplied — names the real up-to figure', () => {
    expect(
      detectDepreciationNotSet([{ cost_basis_ownership_mode: 'paid', depreciation_method: null }], 'owner_operator', 55000)
    ).toEqual({ topic: 'depreciationNotSet', detail: { count: 1, previewTotal: 55000 } });
  });
});

describe('detectWeeklyGoalNotSet', () => {
  test('goal already set — null', () => {
    expect(detectWeeklyGoalNotSet(1500)).toBeNull();
  });

  test('no goal, no suggestion — fires with empty detail', () => {
    expect(detectWeeklyGoalNotSet(null)).toEqual({ topic: 'weeklyGoalNotSet', detail: {} });
  });

  test('no goal, real trailing-average suggestion — fires with the number', () => {
    expect(detectWeeklyGoalNotSet(null, 1234.5)).toEqual({ topic: 'weeklyGoalNotSet', detail: { suggested: 1235 } });
  });
});

describe('detectComplianceItemMissing', () => {
  test('everything present — null', () => {
    expect(
      detectComplianceItemMissing(['medical_card', 'cdl', 'hvut_2290', 'irp_registration'], 'owner_operator', isComplianceTypeVisibleForRole)
    ).toBeNull();
  });

  test('names the first missing type in fixed order', () => {
    expect(detectComplianceItemMissing(['medical_card'], 'owner_operator', isComplianceTypeVisibleForRole)).toEqual({
      topic: 'complianceItemMissing',
      detail: { type: 'cdl' },
    });
  });

  test('company driver never sees a missing truck-only type (hvut/irp)', () => {
    expect(detectComplianceItemMissing(['medical_card', 'cdl'], 'company_driver_w2', isComplianceTypeVisibleForRole)).toBeNull();
  });
});

describe('detectEntityTypeNotSet', () => {
  test('owner, not set — fires', () => {
    expect(detectEntityTypeNotSet(false, 'owner_operator')).toEqual({ topic: 'entityTypeNotSet', detail: {} });
  });
  test('owner, already set — null', () => {
    expect(detectEntityTypeNotSet(true, 'owner_operator')).toBeNull();
  });
  test('company driver — never fires', () => {
    expect(detectEntityTypeNotSet(false, 'company_driver_w2')).toBeNull();
  });
});

describe('detectHomeStateNotSet', () => {
  test('unset — fires', () => {
    expect(detectHomeStateNotSet(null)).toEqual({ topic: 'homeStateNotSet', detail: {} });
  });
  test('set — null', () => {
    expect(detectHomeStateNotSet('TX')).toBeNull();
  });
});

describe('detectFirstReceiptMissing', () => {
  test('owner, zero deductions ever — fires', () => {
    expect(detectFirstReceiptMissing(0, 'owner_operator')).toEqual({ topic: 'firstReceiptMissing', detail: {} });
  });
  test('owner, has at least one — null', () => {
    expect(detectFirstReceiptMissing(3, 'owner_operator')).toBeNull();
  });
  test('company driver — never fires', () => {
    expect(detectFirstReceiptMissing(0, 'company_driver_w2')).toBeNull();
  });
});

describe('detectBusinessBalanceNotSet', () => {
  test('owner, unset — fires', () => {
    expect(detectBusinessBalanceNotSet(null, 'owner_operator')).toEqual({ topic: 'businessBalanceNotSet', detail: {} });
  });
  test('owner, an explicit 0 counts as SET (a real value, not "unset")', () => {
    expect(detectBusinessBalanceNotSet(0, 'owner_operator')).toBeNull();
  });
  test('company driver — never fires', () => {
    expect(detectBusinessBalanceNotSet(null, 'company_driver_w2')).toBeNull();
  });
});

describe('detectPerDiemZeroMileWeek', () => {
  test('no 0-mile/0-per-diem weeks — null', () => {
    expect(detectPerDiemZeroMileWeek([{ miles: 500, per_diem_days: 7 }], 'owner_operator')).toBeNull();
  });

  test('a 0-mile week with 0 per diem days, no rate — fires with count only', () => {
    expect(detectPerDiemZeroMileWeek([{ miles: 0, per_diem_days: 0 }], 'owner_operator')).toEqual({
      topic: 'perDiemZeroMileWeek',
      detail: { count: 1 },
    });
  });

  test('with a real per diem rate — names the real potential deduction', () => {
    expect(detectPerDiemZeroMileWeek([{ miles: 0, per_diem_days: 0 }], 'owner_operator', 64)).toEqual({
      topic: 'perDiemZeroMileWeek',
      detail: { count: 1, potential: 448 },
    });
  });

  test('a 0-mile week that already has per diem days entered — not "missing"', () => {
    expect(detectPerDiemZeroMileWeek([{ miles: 0, per_diem_days: 3 }], 'owner_operator', 64)).toBeNull();
  });

  test('company driver — never fires', () => {
    expect(detectPerDiemZeroMileWeek([{ miles: 0, per_diem_days: 0 }], 'company_driver_w2', 64)).toBeNull();
  });
});
