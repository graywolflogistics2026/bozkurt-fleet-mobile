import { groupByMonth, currentMonthKey } from '@/src/stats/monthGroups';

type Row = { id: string; date: string | null; amount: number };

const getDate = (r: Row) => r.date;
const getAmount = (r: Row) => r.amount;

describe('groupByMonth', () => {
  it('buckets rows by calendar month and sums the amount per month', () => {
    const rows: Row[] = [
      { id: 'a', date: '2026-07-16', amount: 100 },
      { id: 'b', date: '2026-07-02', amount: 50 },
      { id: 'c', date: '2026-06-30', amount: 25 },
    ];
    const groups = groupByMonth(rows, getDate, getAmount);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ monthKey: '2026-07', count: 2, total: 150 });
    expect(groups[1]).toMatchObject({ monthKey: '2026-06', count: 1, total: 25 });
  });

  it('sorts months descending, most recent first', () => {
    const rows: Row[] = [
      { id: 'a', date: '2026-01-05', amount: 1 },
      { id: 'b', date: '2026-07-05', amount: 1 },
      { id: 'c', date: '2026-04-05', amount: 1 },
    ];
    const groups = groupByMonth(rows, getDate, getAmount);
    expect(groups.map((g) => g.monthKey)).toEqual(['2026-07', '2026-04', '2026-01']);
  });

  it('preserves each row within its own month group', () => {
    const rows: Row[] = [
      { id: 'a', date: '2026-07-16', amount: 100 },
      { id: 'b', date: '2026-07-02', amount: 50 },
    ];
    const groups = groupByMonth(rows, getDate, getAmount);
    expect(groups[0].rows.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('buckets rows with no date (or an unparseable date) into a trailing "unknown" group instead of dropping them', () => {
    const rows: Row[] = [
      { id: 'a', date: '2026-07-16', amount: 100 },
      { id: 'b', date: null, amount: 50 },
      { id: 'c', date: 'not-a-date', amount: 25 },
    ];
    const groups = groupByMonth(rows, getDate, getAmount);
    expect(groups).toHaveLength(2);
    expect(groups[groups.length - 1]).toMatchObject({ monthKey: 'unknown', count: 2, total: 75 });
  });

  it('returns an empty array for an empty input, never a bucket with 0 rows', () => {
    expect(groupByMonth([], getDate, getAmount)).toEqual([]);
  });

  it('handles a month with a single row correctly (count and total match)', () => {
    const rows: Row[] = [{ id: 'a', date: '2026-07-16', amount: 42 }];
    const groups = groupByMonth(rows, getDate, getAmount);
    expect(groups).toEqual([{ monthKey: '2026-07', count: 1, total: 42, rows }]);
  });

  it('treats a null/undefined amount as 0 rather than throwing or NaN-poisoning the total', () => {
    const rows = [
      { id: 'a', date: '2026-07-16', amount: undefined as unknown as number },
      { id: 'b', date: '2026-07-02', amount: 10 },
    ];
    const groups = groupByMonth(rows, getDate, getAmount);
    expect(groups[0].total).toBe(10);
  });
});

describe('currentMonthKey', () => {
  it('formats a given date as YYYY-MM', () => {
    expect(currentMonthKey(new Date('2026-07-16T12:00:00Z'))).toBe('2026-07');
  });

  it('defaults to the current date when no argument is given', () => {
    expect(currentMonthKey()).toMatch(/^\d{4}-\d{2}$/);
  });
});
