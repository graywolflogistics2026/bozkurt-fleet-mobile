import { allocateByMiles } from '@/src/stats/costAllocation';

describe('allocateByMiles', () => {
  it('splits a fleet-level pool proportionally by miles share', () => {
    expect(allocateByMiles(1000, 6000, 10000)).toBeCloseTo(600, 5);
    expect(allocateByMiles(1000, 4000, 10000)).toBeCloseTo(400, 5);
  });

  it('two trucks splitting the whole pool sum back to exactly the pool amount', () => {
    const a = allocateByMiles(1000, 6000, 10000);
    const b = allocateByMiles(1000, 4000, 10000);
    expect(a + b).toBeCloseTo(1000, 5);
  });

  it('returns 0 when fleetTotalMiles is 0 (divide-by-zero guard)', () => {
    expect(allocateByMiles(1000, 0, 0)).toBe(0);
  });

  it('returns 0 when the truck itself has 0 miles', () => {
    expect(allocateByMiles(1000, 0, 10000)).toBe(0);
  });

  it('returns 0 when the pool amount is 0 or negative', () => {
    expect(allocateByMiles(0, 5000, 10000)).toBe(0);
    expect(allocateByMiles(-50, 5000, 10000)).toBe(0);
  });
});
