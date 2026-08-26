import { filterLoadsByTruckScope } from '@/src/stats/loadsScope';

const settlements = [
  { id: 's1', truck_id: 'ta' },
  { id: 's2', truck_id: 'tb' },
  { id: 's3', truck_id: null },
];
const loads = [
  { id: 'l1', settlement_id: 's1' },
  { id: 'l2', settlement_id: 's2' },
  { id: 'l3', settlement_id: null },
  { id: 'l4', settlement_id: 's3' },
];

describe('filterLoadsByTruckScope', () => {
  it('returns every load unchanged for All Trucks (null scope)', () => {
    expect(filterLoadsByTruckScope(loads, settlements, null)).toEqual(loads);
  });

  it('includes loads whose settlement belongs to the scoped truck, alongside any fleet-level (null-truck) load', () => {
    const result = filterLoadsByTruckScope(loads, settlements, 'ta');
    // l1 is genuinely truck 'ta'; l3 (no settlement_id) and l4 (settlement
    // with no truck_id) are fleet-level, not "genuinely truck-specific" to
    // any OTHER truck, so they must be visible here too. l2 belongs to a
    // DIFFERENT truck ('tb') and must be excluded.
    expect(result.map((l) => l.id)).toEqual(['l1', 'l3', 'l4']);
  });

  it('NULL-TRUCK EXCLUSION FIX: includes loads with no settlement_id, and loads whose settlement has no truck, in every specific-truck scope', () => {
    const result = filterLoadsByTruckScope(loads, settlements, 'tb');
    // l2 is genuinely truck 'tb'; l3/l4 are fleet-level and must never
    // silently vanish just because a specific truck is scoped. l1 belongs
    // to a DIFFERENT truck ('ta') and must be excluded.
    expect(result.map((l) => l.id)).toEqual(['l2', 'l3', 'l4']);
  });

  it('excludes a load that genuinely belongs to a different truck, even though fleet-level loads remain visible', () => {
    const result = filterLoadsByTruckScope(loads, settlements, 'ta');
    expect(result.map((l) => l.id)).not.toContain('l2');
  });

  it('the total row count with a specific truck selected is: that truck\'s own loads + every fleet-level load (never less than the unfiltered count for a single-truck account, since every load either belongs to it or is fleet-level)', () => {
    // Single-truck fixture: every settlement belongs to the one truck, so
    // scoping to it must return the FULL unfiltered set.
    const oneTruckSettlements = [{ id: 's1', truck_id: 'only' }];
    const oneTruckLoads = [
      { id: 'l1', settlement_id: 's1' },
      { id: 'l2', settlement_id: null },
    ];
    const result = filterLoadsByTruckScope(oneTruckLoads, oneTruckSettlements, 'only');
    expect(result.map((l) => l.id)).toEqual(oneTruckLoads.map((l) => l.id));
  });
});
