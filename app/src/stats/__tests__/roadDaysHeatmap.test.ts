import { buildRoadDaysGrid } from '@/src/stats/roadDaysHeatmap';

describe('buildRoadDaysGrid', () => {
  const now = new Date('2026-07-13T12:00:00Z');

  it('returns weeksBack * 7 cells, oldest first, ending on today', () => {
    const cells = buildRoadDaysGrid([], 12, now);
    expect(cells).toHaveLength(84);
    expect(cells[cells.length - 1].date).toBe('2026-07-13');
    expect(cells[0].date).toBe('2026-04-21');
  });

  it('marks every day within a settlement week (week_ending back 6 days) as on-road', () => {
    const cells = buildRoadDaysGrid(['2026-07-12'], 2, now);
    const byDate = new Map(cells.map((c) => [c.date, c.onRoad]));
    expect(byDate.get('2026-07-06')).toBe(true);
    expect(byDate.get('2026-07-12')).toBe(true);
    expect(byDate.get('2026-07-05')).toBe(false);
  });

  it('leaves days outside any settlement week as off-road', () => {
    const cells = buildRoadDaysGrid([], 2, now);
    expect(cells.every((c) => !c.onRoad)).toBe(true);
  });

  it('dedupes repeated week_ending values without changing the result', () => {
    const once = buildRoadDaysGrid(['2026-07-12'], 2, now);
    const twice = buildRoadDaysGrid(['2026-07-12', '2026-07-12'], 2, now);
    expect(twice).toEqual(once);
  });

  it('marks two separate settlement weeks independently', () => {
    const cells = buildRoadDaysGrid(['2026-06-28', '2026-07-12'], 3, now);
    const byDate = new Map(cells.map((c) => [c.date, c.onRoad]));
    expect(byDate.get('2026-06-28')).toBe(true);
    expect(byDate.get('2026-07-12')).toBe(true);
    expect(byDate.get('2026-07-01')).toBe(false);
  });
});
