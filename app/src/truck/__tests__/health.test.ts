import { calcTruckHealth, type HealthIntervalInput, type MaintenanceRecordInput } from '@/src/truck/health';

function interval(overrides: Partial<HealthIntervalInput>): HealthIntervalInput {
  return {
    category: 'oil',
    trackingMode: 'miles',
    intervalMiles: 50000,
    intervalHours: null,
    bundledWithCategory: null,
    enabled: true,
    ...overrides,
  };
}

function record(overrides: Partial<MaintenanceRecordInput>): MaintenanceRecordInput {
  return {
    serviceType: 'oil',
    odometer: 0,
    engineHours: null,
    serviceDate: '2026-01-01',
    ...overrides,
  };
}

describe('calcTruckHealth — empty state (owner decision, "clean, not broken-looking")', () => {
  it('reports no_data for a category with no maintenance record and no override, rather than a false overdue', () => {
    // A fresh truck with real miles already on it but no logged service —
    // without this, remaining = interval - currentOdometer would be a
    // huge negative number and show OVERDUE on day one.
    const [result] = calcTruckHealth([interval({})], [], 300000, 0);
    expect(result.status).toBe('no_data');
    expect(result.baselineOdometer).toBe(0);
  });

  it('reports no_data for hours-mode with no APU service record', () => {
    const [result] = calcTruckHealth(
      [interval({ category: 'apu', trackingMode: 'hours', intervalMiles: null, intervalHours: 2000 })],
      [],
      0,
      10000
    );
    expect(result.status).toBe('no_data');
  });

  it('uses a manual override as the baseline when no maintenance record exists', () => {
    const [result] = calcTruckHealth([interval({})], [], 320000, 0, { oil: { odometer: 299000 } });
    expect(result.status).not.toBe('no_data');
    expect(result.baselineOdometer).toBe(299000);
    expect(result.remaining).toBe(50000 - (320000 - 299000));
  });
});

describe('calcTruckHealth — status thresholds (legacy rHealth() verbatim: <0 overdue, <10% due_soon)', () => {
  it('is "ok" when remaining is well above the 10% warn threshold', () => {
    const [result] = calcTruckHealth([interval({})], [record({ odometer: 260000 })], 270000, 0);
    // remaining = 50000 - (270000-260000) = 40000, warn = 5000 -> ok
    expect(result.remaining).toBe(40000);
    expect(result.status).toBe('ok');
  });

  it('is "due_soon" when remaining drops under 10% of the interval', () => {
    const [result] = calcTruckHealth([interval({})], [record({ odometer: 260000 })], 306000, 0);
    // remaining = 50000 - 46000 = 4000, warn = 5000 -> due_soon
    expect(result.remaining).toBe(4000);
    expect(result.status).toBe('due_soon');
  });

  it('is "overdue" once remaining goes negative', () => {
    const [result] = calcTruckHealth([interval({})], [record({ odometer: 260000 })], 311000, 0);
    expect(result.remaining).toBeLessThan(0);
    expect(result.status).toBe('overdue');
  });

  it('APU (hours mode) uses a fixed 200-hour warn threshold, not 10% of interval', () => {
    const iv = interval({ category: 'apu', trackingMode: 'hours', intervalMiles: null, intervalHours: 2000 });
    const dueSoon = calcTruckHealth(
      [iv],
      [record({ serviceType: 'apu', odometer: null, engineHours: 10050 })],
      0,
      11850 // remaining = 2000 - 1800 = 200 -> NOT due_soon (< 200 required)
    )[0];
    expect(dueSoon.status).toBe('ok');

    const overWarn = calcTruckHealth(
      [iv],
      [record({ serviceType: 'apu', odometer: null, engineHours: 10050 })],
      0,
      11900 // remaining = 2000 - 1850 = 150 -> due_soon
    )[0];
    expect(overWarn.status).toBe('due_soon');
  });
});

describe('calcTruckHealth — bundled categories (legacy MAINT_BUNDLE_MAP / applyMaintToHealth)', () => {
  it('fuel filter inherits the oil baseline when fuel was never separately logged', () => {
    const intervals = [interval({}), interval({ category: 'fuel', bundledWithCategory: 'oil' })];
    const records = [record({ serviceType: 'oil', odometer: 280000 })];
    const [, fuel] = calcTruckHealth(intervals, records, 300000, 0);
    expect(fuel.baselineOdometer).toBe(280000);
    expect(fuel.remaining).toBe(50000 - (300000 - 280000));
  });

  it("fuel's own record wins when it's higher than the bundled oil baseline", () => {
    const intervals = [interval({}), interval({ category: 'fuel', bundledWithCategory: 'oil' })];
    const records = [record({ serviceType: 'oil', odometer: 200000 }), record({ serviceType: 'fuel', odometer: 280000 })];
    const [, fuel] = calcTruckHealth(intervals, records, 300000, 0);
    expect(fuel.baselineOdometer).toBe(280000);
  });
});

describe('calcTruckHealth — highest-odometer-wins across multiple records for the same category', () => {
  it('takes the max odometer regardless of record insertion/import order', () => {
    const records = [record({ odometer: 100000, serviceDate: '2025-01-01' }), record({ odometer: 260000, serviceDate: '2026-01-01' })];
    const [result] = calcTruckHealth([interval({})], records, 270000, 0);
    expect(result.baselineOdometer).toBe(260000);
    expect(result.lastDoneDate).toBe('2026-01-01');
  });

  it('deleting the highest record recomputes from the next-highest remaining one (caller re-runs with fewer records)', () => {
    const allRecords = [record({ odometer: 100000, serviceDate: '2025-01-01' }), record({ odometer: 260000, serviceDate: '2026-01-01' })];
    const afterDelete = allRecords.filter((r) => r.odometer !== 260000);
    const [result] = calcTruckHealth([interval({})], afterDelete, 270000, 0);
    expect(result.baselineOdometer).toBe(100000);
    expect(result.lastDoneDate).toBe('2025-01-01');
  });
});

describe('calcTruckHealth — next-due', () => {
  it('computes next-due odometer as baseline + interval for mileage categories', () => {
    const [result] = calcTruckHealth([interval({})], [record({ odometer: 260000 })], 270000, 0);
    expect(result.nextDue).toBe(310000);
  });

  it('computes next-due hours as baseline + interval for hours categories', () => {
    const iv = interval({ category: 'apu', trackingMode: 'hours', intervalMiles: null, intervalHours: 2000 });
    const [result] = calcTruckHealth([iv], [record({ serviceType: 'apu', odometer: null, engineHours: 10050 })], 0, 11000);
    expect(result.nextDue).toBe(12050);
  });
});

describe('calcTruckHealth — disabled categories', () => {
  it('excludes a disabled category entirely, not just hides its status', () => {
    const results = calcTruckHealth([interval({ enabled: false })], [], 0, 0);
    expect(results).toHaveLength(0);
  });
});
