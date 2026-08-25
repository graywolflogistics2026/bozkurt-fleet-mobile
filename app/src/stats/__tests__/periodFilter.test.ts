import { periodStartIso, filterByPeriod, bucketGranularityFor } from '../periodFilter';

const NOW = new Date('2026-08-24T12:00:00Z');

describe('periodStartIso', () => {
  it('"all" has no lower bound', () => {
    expect(periodStartIso('all', NOW)).toBeNull();
  });

  it('"thisMonth" starts on the 1st of the current month', () => {
    expect(periodStartIso('thisMonth', NOW)).toBe('2026-08-01');
  });

  // YTD IS CALENDAR-YEAR, NOT ROLLING (CLAUDE.md's own established rule) —
  // the exact class of bug FIX 1 (per diem) is about: a "month"/"rolling"
  // window must never collapse into the same bucket as a true
  // calendar-year YTD window.
  it('"ytd" starts on January 1st of the current year — a real calendar-year window, not a rolling 365 days', () => {
    expect(periodStartIso('ytd', NOW)).toBe('2026-01-01');
  });

  it('"3M" is a rolling 90-day window, distinct from "ytd"', () => {
    const start = periodStartIso('3M', NOW);
    expect(start).toBe('2026-05-26');
    expect(start).not.toBe(periodStartIso('ytd', NOW));
  });
});

describe('filterByPeriod', () => {
  const rows = [
    { id: 'a', date: '2026-01-15' }, // early in the year — YTD only
    { id: 'b', date: '2026-06-01' }, // within 3M and YTD, not thisMonth
    { id: 'c', date: '2026-08-10' }, // within thisMonth, 3M, and YTD
    { id: 'd', date: null }, // no date at all — never matches a bounded period
  ];

  it('"all" returns every row unfiltered', () => {
    expect(filterByPeriod(rows, (r) => r.date, 'all', NOW).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('"thisMonth" keeps only rows dated within the current calendar month', () => {
    expect(filterByPeriod(rows, (r) => r.date, 'thisMonth', NOW).map((r) => r.id)).toEqual(['c']);
  });

  it('"ytd" includes a two-month spread — always at least as much as "thisMonth"', () => {
    const ytdIds = filterByPeriod(rows, (r) => r.date, 'ytd', NOW).map((r) => r.id);
    expect(ytdIds).toEqual(['a', 'b', 'c']);
    const thisMonthIds = filterByPeriod(rows, (r) => r.date, 'thisMonth', NOW).map((r) => r.id);
    expect(ytdIds.length).toBeGreaterThan(thisMonthIds.length);
  });

  it('a null date never matches any bounded period', () => {
    for (const period of ['thisMonth', '3M', 'ytd'] as const) {
      expect(filterByPeriod(rows, (r) => r.date, period, NOW).some((r) => r.id === 'd')).toBe(false);
    }
  });
});

describe('bucketGranularityFor', () => {
  it('"thisMonth" buckets weekly; every longer period buckets monthly', () => {
    expect(bucketGranularityFor('thisMonth')).toBe('weekly');
    expect(bucketGranularityFor('3M')).toBe('monthly');
    expect(bucketGranularityFor('ytd')).toBe('monthly');
    expect(bucketGranularityFor('all')).toBe('monthly');
  });
});
