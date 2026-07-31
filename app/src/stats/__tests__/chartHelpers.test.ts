import { buildPolylinePoints, buildAreaPoints } from '@/src/stats/chartHelpers';

describe('buildPolylinePoints', () => {
  it('returns empty string for no values', () => {
    expect(buildPolylinePoints([], 100, 50)).toBe('');
  });

  it('returns empty string for zero width', () => {
    expect(buildPolylinePoints([1, 2, 3], 0, 50)).toBe('');
  });

  it('returns a flat horizontal line for a single value', () => {
    expect(buildPolylinePoints([5], 100, 50)).toBe('0,25 100,25');
  });

  it('auto-scales to its own min/max (including 0) when no domain given', () => {
    const points = buildPolylinePoints([0, 10], 100, 50);
    // v=0 -> y=50 (bottom), v=10 -> y=0 (top)
    expect(points).toBe('0,50 100,0');
  });

  it('uses an externally-supplied domain instead of auto-scaling', () => {
    // Values [2,4] auto-scale to their own min/max (2..4), but with an
    // explicit domain of [0,10] they should sit low in the chart instead.
    const points = buildPolylinePoints([2, 4], 100, 50, [0, 10]);
    expect(points).toBe('0,40 100,30');
  });

  it('two series sharing one domain stay on the same scale', () => {
    const domain: [number, number] = [0, 100];
    const a = buildPolylinePoints([0, 100], 10, 50, domain);
    const b = buildPolylinePoints([50, 50], 10, 50, domain);
    // a spans the full chart height, b sits exactly in the middle.
    expect(a).toBe('0,50 10,0');
    expect(b).toBe('0,25 10,25');
  });
});

describe('buildAreaPoints', () => {
  it('closes the polyline into a bottom-anchored polygon', () => {
    const line = '0,10 50,20 100,0';
    expect(buildAreaPoints(line, 100, 50)).toBe('0,50 0,10 50,20 100,0 100,50');
  });

  it('returns empty string when the polyline is empty', () => {
    expect(buildAreaPoints('', 100, 50)).toBe('');
  });

  it('returns empty string for zero width', () => {
    expect(buildAreaPoints('0,10 100,0', 0, 50)).toBe('');
  });
});
