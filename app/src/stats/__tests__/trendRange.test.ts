import { filterTrendByRange } from '@/src/stats/trendRange';

describe('filterTrendByRange', () => {
  const now = new Date('2026-07-13T12:00:00');
  const points = [
    { weekEnding: '2026-01-04' },
    { weekEnding: '2026-04-19' },
    { weekEnding: '2026-06-14' },
    { weekEnding: '2026-06-28' },
    { weekEnding: '2026-07-05' },
    { weekEnding: '2026-07-12' },
  ];

  it('7D keeps only the week(s) within the last 7 days', () => {
    const result = filterTrendByRange(points, '7D', now);
    expect(result.map((p) => p.weekEnding)).toEqual(['2026-07-12']);
  });

  it('30D keeps weeks within the last 30 days', () => {
    const result = filterTrendByRange(points, '30D', now);
    expect(result.map((p) => p.weekEnding)).toEqual(['2026-06-14', '2026-06-28', '2026-07-05', '2026-07-12']);
  });

  it('90D keeps weeks within the last 90 days', () => {
    const result = filterTrendByRange(points, '90D', now);
    expect(result.map((p) => p.weekEnding)).toEqual(['2026-04-19', '2026-06-14', '2026-06-28', '2026-07-05', '2026-07-12']);
  });

  it('YTD keeps every week in the current calendar year, regardless of how long ago', () => {
    const result = filterTrendByRange(points, 'YTD', now);
    expect(result.map((p) => p.weekEnding)).toEqual(points.map((p) => p.weekEnding));
  });

  it('YTD excludes weeks from a prior calendar year', () => {
    const result = filterTrendByRange([{ weekEnding: '2025-12-31' }, { weekEnding: '2026-01-02' }], 'YTD', now);
    expect(result.map((p) => p.weekEnding)).toEqual(['2026-01-02']);
  });

  it('returns an empty array for an empty input', () => {
    expect(filterTrendByRange([], '30D', now)).toEqual([]);
  });
});
