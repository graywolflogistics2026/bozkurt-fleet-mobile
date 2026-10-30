// Batch 0b.1 (2026-10-30): a stored date-only value is a calendar day in
// every time zone. Jest reads the zone once at start, so
// `npm run test:zones` (scripts/jest-zones.js) runs the whole suite under
// America/Chicago, UTC and Pacific/Auckland; a plain `npx jest` runs in
// the machine's zone.
import * as fs from 'fs';
import * as path from 'path';
import {
  addDaysDateOnly,
  addMonthsDateOnly,
  compareDateOnly,
  daysBetweenDateOnly,
  isDateOnly,
  monthKeyOf,
  parseDateOnly,
  quarterOf,
  toDateOnly,
  todayDateOnly,
  weekdayOf,
  yearOf,
} from '@/src/lib/dateOnly';
import { formatDate } from '@/src/i18n/format';
import { filterByPeriod, periodStartIso } from '@/src/stats/periodFilter';
import { resolveHeroPeriodDateWindow, resolvePreviousHeroPeriodDateWindow, filterRowsByDateWindow } from '@/src/stats/heroPeriodWindow';
import { weekStartFromEnding } from '@/src/stats/cashFlowTrend';
import { currentMonthKey, groupByMonth } from '@/src/stats/monthGroups';
import { calcComplianceStatus } from '@/src/compliance/status';
import { nextQuarterlyDeadline } from '@/src/tax/quarterly';
import { windowStartIso } from '@/src/stats/profitAnalysis';
import { heldAtMonthEnd } from '@/src/stats/heldByCarrier';
import { calcPerDiemDays } from '@/src/tax/perDiem';

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

describe(`date-only values in ${ZONE}`, () => {
  it('runs in the zone it was asked for', () => {
    if (process.env.TZ === 'UTC') expect(new Date(2026, 7, 14).getTimezoneOffset()).toBe(0);
    else if (process.env.TZ) expect(ZONE).toBe(process.env.TZ);
  });

  it('shows the stored day, never the day before', () => {
    expect(formatDate('2026-08-14', 'en-US')).toBe('8/14/2026');
    expect(formatDate('2026-08-21', 'en-US')).toBe('8/21/2026');
    expect(formatDate('2026-07-31', 'en-US')).toBe('7/31/2026');
    expect(formatDate('2026-08-01', 'en-US')).toBe('8/1/2026');
    expect(formatDate('2026-01-01', 'en-US', { year: 'numeric' })).toBe('2026');
    expect(toDateOnly(parseDateOnly('2026-08-14'))).toBe('2026-08-14');
    expect(parseDateOnly('2026-08-14').getDate()).toBe(14);
    expect(yearOf('2026-01-01')).toBe(2026);
  });

  it('takes "today" from the local clock, late at night and early in the morning', () => {
    expect(todayDateOnly(new Date(2026, 9, 30, 23, 30))).toBe('2026-10-30');
    expect(todayDateOnly(new Date(2026, 9, 30, 0, 30))).toBe('2026-10-30');
    expect(currentMonthKey(new Date(2026, 9, 31, 23, 0))).toBe('2026-10');
    expect(currentMonthKey(new Date(2026, 10, 1, 0, 30))).toBe('2026-11');
  });

  it('day arithmetic never touches the zone', () => {
    expect(addDaysDateOnly('2026-08-14', 7)).toBe('2026-08-21');
    expect(addDaysDateOnly('2026-03-07', 2)).toBe('2026-03-09'); // US DST weekend
    expect(addDaysDateOnly('2026-04-04', 2)).toBe('2026-04-06'); // NZ DST end
    expect(daysBetweenDateOnly('2026-08-14', '2026-08-21')).toBe(7);
    expect(weekdayOf('2026-08-14')).toBe(5);
    expect(weekdayOf('2026-08-21')).toBe(5);
    expect(addMonthsDateOnly('2026-08-14', 12)).toBe('2027-08-14');
    expect(weekStartFromEnding('2026-08-21')).toBe('2026-08-15');
    expect(weekStartFromEnding('2026-08-14')).toBe('2026-08-08');
    expect(quarterOf('2026-08-14')).toBe(3);
    expect(monthKeyOf('2026-07-31')).toBe('2026-07');
  });

  it('no row moves to another month at the 7/31 - 8/1 boundary', () => {
    const rows = [
      { d: '2026-07-31', amount: 10 },
      { d: '2026-08-01', amount: 20 },
      { d: '2026-08-14', amount: 30 },
      { d: '2026-08-21', amount: 40 },
    ];
    const groups = groupByMonth(rows, (r) => r.d, (r) => r.amount);
    expect(groups.map((g) => [g.monthKey, g.total])).toEqual([
      ['2026-08', 90],
      ['2026-07', 10],
    ]);
    // "This month" on Aug 1 late at night still starts on Aug 1.
    const aug1Night = new Date(2026, 7, 1, 23, 45);
    expect(periodStartIso('thisMonth', aug1Night)).toBe('2026-08-01');
    expect(filterByPeriod(rows, (r) => r.d, 'thisMonth', aug1Night).map((r) => r.d)).toEqual(['2026-08-01', '2026-08-14', '2026-08-21']);
    // A July month window holds 7/31 and not 8/1.
    const july = { startIso: '2026-07-01', endIso: '2026-07-31' };
    expect(filterRowsByDateWindow(rows, (r) => r.d, july).map((r) => r.d)).toEqual(['2026-07-31']);
  });

  it('period windows end on the local today', () => {
    const lateEvening = new Date(2026, 7, 21, 22, 0);
    expect(resolveHeroPeriodDateWindow('1M', [], lateEvening)).toEqual({ startIso: '2026-07-22', endIso: '2026-08-21' });
    expect(resolvePreviousHeroPeriodDateWindow('1M', [], lateEvening)).toEqual({ startIso: '2026-06-22', endIso: '2026-07-21' });
    expect(resolveHeroPeriodDateWindow('thisWeek', ['2026-08-14', '2026-08-21'], lateEvening)).toEqual({ startIso: '2026-08-15', endIso: '2026-08-21' });
    expect(resolveHeroPeriodDateWindow('lastWeek', ['2026-08-14', '2026-08-21'], lateEvening)).toEqual({ startIso: '2026-08-08', endIso: '2026-08-14' });
    expect(periodStartIso('ytd', lateEvening)).toBe('2026-01-01');
    expect(periodStartIso('3M', lateEvening)).toBe('2026-05-23');
    expect(windowStartIso(30, lateEvening)).toBe('2026-07-22');
  });

  it('reminders count whole local days', () => {
    expect(calcComplianceStatus('2026-08-21', new Date(2026, 7, 14, 23, 0)).daysUntil).toBe(7);
    expect(calcComplianceStatus('2026-08-14', new Date(2026, 7, 14, 23, 0)).daysUntil).toBe(0);
    const next = nextQuarterlyDeadline(
      [
        ['Q3', '2026-09-15'],
        ['Q4', '2027-01-15'],
      ],
      new Date(2026, 8, 15, 22, 0)
    );
    expect(next).toMatchObject({ label: 'Q3', daysUntil: 0 });
  });

  it('per diem days and month-end held do not depend on the zone', () => {
    expect(
      calcPerDiemDays([
        { week_ending: '2026-08-14', per_diem_days: 7 },
        { week_ending: '2026-08-21', per_diem_days: 6 },
      ])
    ).toBe(13);
    const held = heldAtMonthEnd([], null, 2026, 7);
    expect(held.status).toBe('not_printed');
  });
});

describe('date-only helpers', () => {
  it('recognizes only YYYY-MM-DD', () => {
    expect(isDateOnly('2026-08-14')).toBe(true);
    expect(isDateOnly('2026-08-14T00:00:00Z')).toBe(false);
    expect(isDateOnly(null)).toBe(false);
  });
  it('sorts nulls last when descending', () => {
    const rows = ['2026-08-14', null, '2026-08-21'];
    expect([...rows].sort((a, b) => compareDateOnly(b, a))).toEqual(['2026-08-21', '2026-08-14', null]);
  });
});

// Source check: no date-only string reaches `new Date()` and no local
// "today" goes through toISOString() again (batch 0b.1 grep proof).
describe('source check', () => {
  const root = path.resolve(__dirname, '../../..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(root, 'src'));
  walk(path.join(root, 'app'));

  const code = (file: string) =>
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*)/.test(line));

  it('never turns a Date into a day with toISOString()', () => {
    const hits = files.flatMap((f) => code(f).filter((l) => /toISOString\(\)\.(slice|substring)\(0,\s*(10|7|4)\)|toISOString\(\)\.split\('T'\)/.test(l)).map((l) => `${path.relative(root, f)}: ${l.trim()}`));
    expect(hits).toEqual([]);
  });

  it('never builds a Date from a date-only string', () => {
    const dateOnlyArg = /new Date\(\s*(`\$\{[^`]*\}T[0-9:]*Z?`|[\w.?]*(?:_date|Date|date|week_ending|weekEnding|Iso|iso)\b\s*(\?\?[^)]*)?\))/;
    const allowed = /new Date\((now|nowIso|date\.getTime\(\)|d|at|y|year|ny|yy)\)/;
    const hits = files
      .filter((f) => !f.endsWith(path.join('lib', 'dateOnly.ts')))
      .flatMap((f) => code(f).filter((l) => dateOnlyArg.test(l) && !allowed.test(l)).map((l) => `${path.relative(root, f)}: ${l.trim()}`));
    expect(hits).toEqual([]);
  });
});
