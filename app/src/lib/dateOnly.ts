// DATE-ONLY VALUES (owner decision 2026-10-30, master plan batch 0b.1).
//
// A stored date-only value ("YYYY-MM-DD": week_ending, ded_date,
// purchase_date, due_date, service_date, ...) is a CALENDAR DAY, not an
// instant. `new Date("2026-08-14")` parses it as UTC midnight, and every
// local-time read of that instant (toLocaleDateString, getDate,
// getFullYear) lands on 8/13 west of UTC. `date.toISOString().slice(0, 10)`
// is the mirror bug: it turns a LOCAL "now" into the UTC day, so after
// 7 pm in Chicago "today" is already tomorrow.
//
// This is the ONE module for date-only values. Rules:
// - parse a date-only string with `parseDateOnly()` (local midnight),
//   never `new Date(str)`;
// - turn a local Date into a day with `toDateOnly()`, never
//   `toISOString().slice(0, 10)`;
// - do day arithmetic on strings (`addDaysDateOnly`, `daysBetweenDateOnly`),
//   which never touches a time zone;
// - month and year buckets come from the string itself (`monthKeyOf`,
//   `yearOf`), so no row can move to another month.
// `src/lib/__tests__/dateOnly.test.ts` runs the same checks under
// America/Chicago, UTC and Pacific/Auckland, and a source check fails if a
// date-only string reaches `new Date()` again.

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86400000;

export function isDateOnly(value: unknown): value is string {
  return typeof value === 'string' && DATE_ONLY_RE.test(value);
}

function partsOf(iso: string): [number, number, number] {
  const m = DATE_ONLY_RE.exec(iso.slice(0, 10));
  if (!m) throw new Error(`Not a YYYY-MM-DD date: ${iso}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// Local midnight of that calendar day. Accepts a full timestamp too and
// uses only its first 10 characters (its calendar day as stored).
export function parseDateOnly(iso: string): Date {
  const [y, m, d] = partsOf(iso);
  return new Date(y, m - 1, d);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

// The LOCAL calendar day of a Date.
export function toDateOnly(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayDateOnly(now: Date = new Date()): string {
  return toDateOnly(now);
}

export function dateOnlyFromParts(year: number, month1Based: number, day: number): string {
  return toDateOnly(new Date(year, month1Based - 1, day));
}

// Time-zone-free day number (days since 1970-01-01) for arithmetic.
function dayNumber(iso: string): number {
  const [y, m, d] = partsOf(iso);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function fromDayNumber(n: number): string {
  const d = new Date(n * DAY_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function addDaysDateOnly(iso: string, days: number): string {
  return fromDayNumber(dayNumber(iso) + days);
}

// Same day number N months later (JS month overflow: Jan 31 + 1 month =
// Mar 3 in a non-leap year), time-zone free.
export function addMonthsDateOnly(iso: string, months: number): string {
  const [y, m, d] = partsOf(iso);
  return fromDayNumber(Date.UTC(y, m - 1 + months, d) / DAY_MS);
}

// b − a in whole days.
export function daysBetweenDateOnly(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

// 0 = Sunday ... 6 = Saturday, same as Date#getDay.
export function weekdayOf(iso: string): number {
  return (((dayNumber(iso) + 4) % 7) + 7) % 7;
}

export function yearOf(iso: string): number {
  return partsOf(iso)[0];
}

// "YYYY-MM"
export function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

export function quarterOf(iso: string): 1 | 2 | 3 | 4 {
  return (Math.floor((partsOf(iso)[1] - 1) / 3) + 1) as 1 | 2 | 3 | 4;
}

// For sorting rows by a nullable date-only column; nulls sort last when
// descending.
export function compareDateOnly(a: string | null | undefined, b: string | null | undefined): number {
  const x = a ?? '';
  const y = b ?? '';
  return x < y ? -1 : x > y ? 1 : 0;
}
