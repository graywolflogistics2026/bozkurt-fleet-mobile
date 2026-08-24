import {
  detectNoReceiptRecently,
  detectMissingCommonCategory,
  detectAccountantPackageReady,
  detectQuarterlyTaxDueSoon,
  detectFuelPctTrendUp,
  detectDeadheadTrendUp,
  detectCpmAboveRpm,
  buildPeriodicCoachNudgeCandidates,
  COMMON_QUARTERLY_CATEGORIES,
} from '@/src/alerts/periodicCoachNudges';

const NOW = new Date('2026-08-24T12:00:00Z'); // Q3 2026

describe('detectNoReceiptRecently', () => {
  test('no deductions at all — null (empty-state, not a nudge)', () => {
    expect(detectNoReceiptRecently([], NOW)).toBeNull();
  });

  test('most recent receipt within 12 days — null', () => {
    expect(detectNoReceiptRecently([{ ded_date: '2026-08-18' }], NOW)).toBeNull();
  });

  test('most recent receipt 12+ days ago — fires with the real day count', () => {
    expect(detectNoReceiptRecently([{ ded_date: '2026-08-10' }], NOW)).toEqual({ topic: 'noReceiptRecently', detail: { days: 14 } });
  });
});

describe('detectMissingCommonCategory', () => {
  test('every common category present this quarter — null', () => {
    const deductions = COMMON_QUARTERLY_CATEGORIES.map((category) => ({ category, ded_date: '2026-08-01' }));
    expect(detectMissingCommonCategory(deductions, NOW)).toBeNull();
  });

  test('one missing — fires naming the FIRST missing category in list order', () => {
    const deductions = COMMON_QUARTERLY_CATEGORIES.slice(1).map((category) => ({ category, ded_date: '2026-08-01' }));
    expect(detectMissingCommonCategory(deductions, NOW)).toEqual({
      topic: 'missingCommonCategory',
      detail: { category: COMMON_QUARTERLY_CATEGORIES[0] },
    });
  });

  test('a category present last quarter but not this one still counts as missing', () => {
    const deductions = COMMON_QUARTERLY_CATEGORIES.map((category) => ({ category, ded_date: '2026-04-01' })); // Q2
    expect(detectMissingCommonCategory(deductions, NOW)).not.toBeNull();
  });
});

describe('detectAccountantPackageReady', () => {
  test('no deadline known — null', () => {
    expect(detectAccountantPackageReady(null, true, 'August')).toBeNull();
  });

  test('deadline too far out — null', () => {
    expect(detectAccountantPackageReady(45, true, 'August')).toBeNull();
  });

  test('deadline already past — null', () => {
    expect(detectAccountantPackageReady(-2, true, 'August')).toBeNull();
  });

  test('deadline close but nothing to export this month — null', () => {
    expect(detectAccountantPackageReady(10, false, 'August')).toBeNull();
  });

  test('deadline close AND real data this month — fires', () => {
    expect(detectAccountantPackageReady(10, true, 'August')).toEqual({
      topic: 'accountantPackageReady',
      detail: { month: 'August', days: 10 },
    });
  });
});

describe('detectQuarterlyTaxDueSoon', () => {
  test('no deadline — null', () => {
    expect(detectQuarterlyTaxDueSoon(null)).toBeNull();
  });

  test('too far out — null', () => {
    expect(detectQuarterlyTaxDueSoon(20)).toBeNull();
  });

  test('within the window — fires', () => {
    expect(detectQuarterlyTaxDueSoon(7)).toEqual({ topic: 'quarterlyTaxDueSoon', detail: { days: 7 } });
  });
});

describe('detectFuelPctTrendUp / detectDeadheadTrendUp', () => {
  test('missing data — null', () => {
    expect(detectFuelPctTrendUp(null, 0.2)).toBeNull();
    expect(detectDeadheadTrendUp(0.1, null)).toBeNull();
  });

  test('small increase under the threshold — null', () => {
    expect(detectFuelPctTrendUp(0.22, 0.2)).toBeNull();
  });

  test('a real jump — fires with the point delta', () => {
    expect(detectFuelPctTrendUp(0.3, 0.2)).toEqual({ topic: 'fuelPctTrendUp', detail: { points: 10 } });
    expect(detectDeadheadTrendUp(0.25, 0.1)).toEqual({ topic: 'deadheadTrendUp', detail: { points: 15 } });
  });

  test('a decrease never fires', () => {
    expect(detectFuelPctTrendUp(0.15, 0.2)).toBeNull();
  });
});

describe('detectCpmAboveRpm', () => {
  test('missing data — null', () => {
    expect(detectCpmAboveRpm(null, 2)).toBeNull();
  });

  test('CPM at or below RPM — null (still profitable)', () => {
    expect(detectCpmAboveRpm(1.8, 2)).toBeNull();
    expect(detectCpmAboveRpm(2, 2)).toBeNull();
  });

  test('CPM above RPM — fires with both real figures', () => {
    expect(detectCpmAboveRpm(2.15, 2)).toEqual({ topic: 'cpmAboveRpm', detail: { cpm: 2.15, rpm: 2 } });
  });
});

describe('buildPeriodicCoachNudgeCandidates', () => {
  test('combines every detector, dropping nulls', () => {
    const result = buildPeriodicCoachNudgeCandidates({
      deductions: [{ category: 'Fuel & DEF', ded_date: '2026-08-01' }],
      quarterlyDeadlineDaysUntil: 5,
      hasOutOfPocketThisMonth: true,
      monthLabel: 'August',
      thisWeekFuelPct: 0.35,
      trailingAvgFuelPct: 0.2,
      thisWeekDeadheadPct: 0.3,
      trailingAvgDeadheadPct: 0.1,
      cpm: 2.2,
      rpm: 2.0,
      now: NOW,
    });
    const topics = result.map((c) => c.topic).sort();
    expect(topics).toEqual(
      [
        'noReceiptRecently',
        'missingCommonCategory',
        'accountantPackageReady',
        'quarterlyTaxDueSoon',
        'fuelPctTrendUp',
        'deadheadTrendUp',
        'cpmAboveRpm',
      ].sort()
    );
  });

  test('a clean account with no signals produces zero candidates', () => {
    const deductions = COMMON_QUARTERLY_CATEGORIES.map((category) => ({ category, ded_date: '2026-08-20' }));
    const result = buildPeriodicCoachNudgeCandidates({
      deductions,
      quarterlyDeadlineDaysUntil: 90,
      hasOutOfPocketThisMonth: true,
      monthLabel: 'August',
      thisWeekFuelPct: 0.2,
      trailingAvgFuelPct: 0.2,
      thisWeekDeadheadPct: 0.1,
      trailingAvgDeadheadPct: 0.1,
      cpm: 1.8,
      rpm: 2.0,
      now: NOW,
    });
    expect(result).toEqual([]);
  });
});
