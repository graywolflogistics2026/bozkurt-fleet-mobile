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

  it('filters to only loads whose settlement belongs to the scoped truck', () => {
    const result = filterLoadsByTruckScope(loads, settlements, 'ta');
    expect(result.map((l) => l.id)).toEqual(['l1']);
  });

  it('excludes loads with no settlement_id, and loads whose settlement has no truck, from a specific-truck scope', () => {
    const result = filterLoadsByTruckScope(loads, settlements, 'tb');
    expect(result.map((l) => l.id)).toEqual(['l2']);
  });
});
