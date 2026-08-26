import { truckIdFilterFor } from '@/src/stats/fleetScope';

describe('truckIdFilterFor', () => {
  it('returns undefined ("no filter" / All Trucks) for null', () => {
    expect(truckIdFilterFor(null)).toBeUndefined();
  });

  it('returns the truck id unchanged for a specific truck', () => {
    expect(truckIdFilterFor('truck-1')).toBe('truck-1');
  });
});
