// PRINTED DATES (owner decision 2026-10-29, "DATES (definitive)").
// The model never interprets a date: ai-import returns each settlement
// date AS PRINTED, as text (settlementDateRaw "26/08/14", printDateRaw
// "8/13/26", statementWeekEndingRaw "26/08/14") and this module parses it.
//
// Prime prints SETTLEMENT DATE and the statement's WEEK ENDING as
// YY/MM/DD, the header print DATE as M/D/YY, and line dates as MMDD with
// no year. Proof from two real PDFs: "26/08/14" and "26/08/21" share
// "26/08" and only the third number moves by 7, so only YY/MM/DD fits —
// read as DD/MM/YY they become 2014-08-26 and 2021-08-26 (the "old years"
// bug). Every other carrier gets no Prime rule: an ambiguous printed date
// is asked once and the confirmed format is remembered per carrier.
import { isPrimeCarrier } from './primeOperatingStatement';
import { normalizeCarrierKey } from './carrierCodes';

const DAY_MS = 86_400_000;

export type DateFormat = 'YMD' | 'MDY' | 'DMY';

function iso(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const fullYear = (y: number, digits: number) => (digits <= 2 ? 2000 + y : y);

function parts(raw: string | null | undefined): { n: number[]; digits: number[] } | null {
  if (typeof raw !== 'string') return null;
  const pieces = raw.trim().split(/[\/\-.\s]+/).filter(Boolean);
  if (pieces.length !== 3 || pieces.some((p) => !/^\d{1,4}$/.test(p))) return null;
  return { n: pieces.map(Number), digits: pieces.map((p) => p.length) };
}

export const toUtc = (isoDate: string) => Date.parse(`${isoDate}T00:00:00Z`);
export const daysBetween = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
export const addDaysIso = (isoDate: string, days: number) => new Date(toUtc(isoDate) + days * DAY_MS).toISOString().slice(0, 10);
export const isFriday = (isoDate: string) => new Date(toUtc(isoDate)).getUTCDay() === 5;
// A calendar day for display: built from LOCAL components, so a US device
// shows Aug 14 for 2026-08-14 (new Date('2026-08-14') is UTC midnight and
// renders as Aug 13 west of UTC).
export function localDay(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addMonthsIso(isoDate: string, months: number): string {
  const d = new Date(toUtc(isoDate));
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

// One printed date read in one digit order. Null when the text is not
// three numbers or that order is not a real calendar date.
export function parseInFormat(raw: string | null | undefined, format: DateFormat): string | null {
  const p = parts(raw);
  if (!p) return null;
  const [a, b, c] = p.n;
  if (format === 'YMD') return p.digits[0] === 4 || p.digits[0] <= 2 ? iso(fullYear(a, p.digits[0]), b, c) : null;
  if (p.digits[0] > 2 || p.digits[1] > 2) return null;
  return format === 'MDY' ? iso(fullYear(c, p.digits[2]), a, b) : iso(fullYear(c, p.digits[2]), b, a);
}

// Prime's SETTLEMENT DATE / statement WEEK ENDING: YY/MM/DD.
export const parsePrimeSettlementDate = (raw: string | null | undefined) => parseInFormat(raw, 'YMD');
// Prime's header print DATE: M/D/YY.
export const parsePrimePrintDate = (raw: string | null | undefined) => parseInFormat(raw, 'MDY');

// Every digit order that gives a real date. A four-digit year fixes the
// year's place; YYYY first is always Y/M/D.
export function readingsOf(raw: string | null | undefined): { format: DateFormat; iso: string }[] {
  const p = parts(raw);
  if (!p) return [];
  const formats: DateFormat[] = p.digits[0] === 4 ? ['YMD'] : p.digits[2] === 4 ? ['MDY', 'DMY'] : ['YMD', 'MDY', 'DMY'];
  const out: { format: DateFormat; iso: string }[] = [];
  for (const format of formats) {
    const value = parseInFormat(raw, format);
    if (value && !out.some((r) => r.iso === value)) out.push({ format, iso: value });
  }
  return out;
}

// A line date printed MMDD (no year) — or a model date whose year is
// ignored: the year comes from the resolved week ending, and a month/day
// later than the week ending belongs to the previous year (1228 on a week
// ending 2027-01-08 is 2026-12-28).
export function lineDateFromWeekEnding(printed: string | null | undefined, weekEnding: string): string | null {
  if (typeof printed !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(weekEnding)) return null;
  const s = printed.trim();
  let mm: number;
  let dd: number;
  const isoLike = /^\d{4}-(\d{2})-(\d{2})/.exec(s);
  const mmdd = /^(\d{2})\/?(\d{2})$/.exec(s);
  if (isoLike) [mm, dd] = [Number(isoLike[1]), Number(isoLike[2])];
  else if (mmdd) [mm, dd] = [Number(mmdd[1]), Number(mmdd[2])];
  else return null;
  const y = Number(weekEnding.slice(0, 4));
  const sameYear = iso(y, mm, dd);
  if (sameYear && sameYear <= weekEnding) return sameYear;
  return iso(y - 1, mm, dd) ?? sameYear;
}

// A PDF's Info dictionary CreationDate, "D:20260813235659-05'00'", as the
// calendar date it was written on. Already-ISO values pass through.
export function pdfCreationDateIso(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const m = /^(?:D:)?(\d{4})-?(\d{2})-?(\d{2})/.exec(raw.trim());
  return m ? iso(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

// ---------------------------------------------------------------------
// The plausibility gate (A2). Any issue blocks Save until the owner
// answers the one-line question (Yes, or picks another date).
// ---------------------------------------------------------------------
export type DateIssue =
  | 'unreadable' // no settlement date read
  | 'older_reading' // read before the app parsed printed dates itself
  | 'print_gap' // settlement date − print date outside 0..7 days
  | 'not_friday' // soft: Prime weeks end on a Friday
  | 'statement_week_differs' // statement WEEK ENDING ≠ settlement date
  | 'pdf_created_far' // PDF CreationDate more than 3 days from the print date
  | 'future' // later than the import date + 10 days
  | 'too_old' // older than 14 months before the import date (catch-up years are legitimate: asks)
  | 'ambiguous'; // other carriers: more than one digit order fits

export type SettlementDateCheck = {
  rule: 'prime' | 'other';
  // The settlement date as printed ("26/08/14"), for the question line.
  printed: string | null;
  weekEnding: string | null;
  format: DateFormat | null;
  printDate: string | null;
  statementWeekEnding: string | null;
  pdfCreationDate: string | null;
  issues: DateIssue[];
  passed: boolean;
};

export type SettlementDateInputs = {
  carrier?: string | null;
  settlementDateRaw?: string | null;
  printDateRaw?: string | null;
  statementWeekEndingRaw?: string | null;
  pdfCreationDate?: string | null;
  // Readings from before the raw fields existed (the model's own ISO).
  weekEnding?: string | null;
  printDate?: string | null;
  statementWeekEnding?: string | null;
};

const PRINT_GAP_MAX_DAYS = 7;
const PDF_CREATED_MAX_DAYS = 3;
const FUTURE_MAX_DAYS = 10;
const TOO_OLD_MONTHS = 14;

function rangeIssues(weekEnding: string, importDate: string): DateIssue[] {
  const out: DateIssue[] = [];
  if (daysBetween(importDate, weekEnding) > FUTURE_MAX_DAYS) out.push('future');
  if (weekEnding < addMonthsIso(importDate, -TOO_OLD_MONTHS)) out.push('too_old');
  return out;
}

export function checkPrimeSettlementDates(input: SettlementDateInputs, importDate: string): SettlementDateCheck {
  const raw = input.settlementDateRaw?.trim() || null;
  const weekEnding = raw ? parsePrimeSettlementDate(raw) : input.weekEnding || null;
  const printDate = input.printDateRaw?.trim() ? parsePrimePrintDate(input.printDateRaw) : input.printDate || null;
  const statementWeekEnding = input.statementWeekEndingRaw?.trim()
    ? parsePrimeSettlementDate(input.statementWeekEndingRaw)
    : input.statementWeekEnding || null;
  const pdfCreationDate = pdfCreationDateIso(input.pdfCreationDate);
  const issues: DateIssue[] = [];
  if (!weekEnding) issues.push('unreadable');
  else {
    if (!raw) issues.push('older_reading');
    if (printDate) {
      const gap = daysBetween(printDate, weekEnding);
      if (gap < 0 || gap > PRINT_GAP_MAX_DAYS) issues.push('print_gap');
    }
    if (!isFriday(weekEnding)) issues.push('not_friday');
    // Exact match only: the year/day-swapped tolerance (62c6435) hid the bug.
    if ((input.statementWeekEndingRaw?.trim() || input.statementWeekEnding) && statementWeekEnding !== weekEnding) {
      issues.push('statement_week_differs');
    }
    issues.push(...rangeIssues(weekEnding, importDate));
  }
  if (pdfCreationDate && printDate && Math.abs(daysBetween(printDate, pdfCreationDate)) > PDF_CREATED_MAX_DAYS) issues.push('pdf_created_far');
  return {
    rule: 'prime',
    printed: raw,
    weekEnding,
    format: raw && weekEnding ? 'YMD' : null,
    printDate,
    statementWeekEnding,
    pdfCreationDate,
    issues,
    passed: issues.length === 0,
  };
}

// Other carriers (A5): no Prime rule. One digit order -> that date; several
// -> the remembered format for this carrier, else the one reading inside
// [print date, print date + 7], else ask.
export function checkOtherCarrierDates(input: SettlementDateInputs, importDate: string, rememberedFormat?: DateFormat | null): SettlementDateCheck {
  const raw = input.settlementDateRaw?.trim() || null;
  const printDate = pdfCreationDateIso(input.printDate) ?? null;
  const pdfCreationDate = pdfCreationDateIso(input.pdfCreationDate);
  const issues: DateIssue[] = [];
  let weekEnding: string | null = null;
  let format: DateFormat | null = null;
  if (raw) {
    const readings = readingsOf(raw);
    const remembered = rememberedFormat ? readings.find((r) => r.format === rememberedFormat) : undefined;
    const inWindow = printDate ? readings.filter((r) => daysBetween(printDate, r.iso) >= 0 && daysBetween(printDate, r.iso) <= PRINT_GAP_MAX_DAYS) : [];
    const pick = readings.length === 1 ? readings[0] : (remembered ?? (inWindow.length === 1 ? inWindow[0] : undefined));
    if (pick) {
      weekEnding = pick.iso;
      format = pick.format;
    } else if (readings.length > 1) {
      issues.push('ambiguous');
      // Prefill: the model's reading when it is one of them, else the one
      // nearest the import date.
      const nearest = [...readings].sort((a, b) => Math.abs(daysBetween(importDate, a.iso)) - Math.abs(daysBetween(importDate, b.iso)))[0];
      const best = readings.find((r) => r.iso === input.weekEnding) ?? nearest;
      weekEnding = best.iso;
      format = best.format;
    }
  } else if (input.weekEnding) {
    weekEnding = input.weekEnding;
  }
  if (!weekEnding) issues.push('unreadable');
  else issues.push(...rangeIssues(weekEnding, importDate));
  return { rule: 'other', printed: raw, weekEnding, format, printDate, statementWeekEnding: null, pdfCreationDate, issues, passed: issues.length === 0 };
}

export function settlementDateInputsOf(extraction: {
  pdfCreationDate?: string;
  settlement?: {
    carrier?: string;
    settlementDateRaw?: string;
    printDateRaw?: string;
    statementWeekEndingRaw?: string;
    weekEnding?: string;
    printDate?: string;
    operating?: { weekEnding?: string };
  };
}): SettlementDateInputs {
  const s = extraction.settlement ?? {};
  return {
    carrier: s.carrier ?? null,
    settlementDateRaw: s.settlementDateRaw ?? null,
    printDateRaw: s.printDateRaw ?? null,
    statementWeekEndingRaw: s.statementWeekEndingRaw ?? null,
    pdfCreationDate: extraction.pdfCreationDate ?? null,
    weekEnding: s.weekEnding ?? null,
    printDate: s.printDate ?? null,
    statementWeekEnding: s.operating?.weekEnding ?? null,
  };
}

export function checkSettlementDates(input: SettlementDateInputs, importDate: string, rememberedFormat?: DateFormat | null): SettlementDateCheck {
  return isPrimeCarrier(input.carrier) ? checkPrimeSettlementDates(input, importDate) : checkOtherCarrierDates(input, importDate, rememberedFormat);
}

// The owner's answer: Yes (the reading shown) or a picked date. Save is
// allowed when the gate passed or the answer is for exactly this date.
export type DateConfirmation = { weekEnding: string; by: 'user' | 'remembered_format'; format?: DateFormat | null };

export function isDateGateSatisfied(check: SettlementDateCheck, weekEnding: string | null | undefined, confirmed: DateConfirmation | null | undefined): boolean {
  if (!weekEnding) return false;
  // Nothing earlier than 2020 is ever a settlement week (dateGuard.ts's
  // implausible window): never saved, answered or not.
  if (weekEnding < '2020-01-01') return false;
  if (check.passed && check.weekEnding === weekEnding) return true;
  return !!confirmed && confirmed.weekEnding === weekEnding;
}

// The confirmed format remembered for a carrier (A5): the newest saved
// settlement of that carrier whose statement records a confirmed format.
export function rememberedDateFormat(
  carrier: string | null | undefined,
  settlements: { carrier: string | null; week_ending: string; statement?: { dates?: { format?: DateFormat | null; confirmedBy?: string | null } | null } | null }[]
): DateFormat | null {
  const key = normalizeCarrierKey(carrier);
  if (!key) return null;
  const hit = settlements
    .filter((s) => normalizeCarrierKey(s.carrier) === key && s.statement?.dates?.format && s.statement.dates.confirmedBy)
    .sort((a, b) => b.week_ending.localeCompare(a.week_ending))[0];
  return hit?.statement?.dates?.format ?? null;
}

// ---------------------------------------------------------------------
// A6 — saved weeks that break these rules ("Needs a date check").
// ---------------------------------------------------------------------
export type DateCheckReason = 'before_2025' | 'future' | 'not_friday' | 'differs_from_printed';
export type SavedWeekDateCheck = { id: string; weekEnding: string; reasons: DateCheckReason[]; suggested: string | null };

// The printed statement week ending stored in the §77 jsonb: the app's own
// YY/MM/DD parse when recorded (`dates.printedWeekEnding`), else the older
// stored check's statement date — which the model read, possibly as
// DD/MM/YY, so an implausible one is read back the YY/MM/DD way.
export function printedWeekEndingOf(statement: StoredDatesStatement | null | undefined): string | null {
  const recorded = statement?.dates?.printedWeekEnding;
  if (recorded) return recorded;
  const check = statement?.prime?.checks?.find((c) => c.id === 'statementWeekEnding');
  const text = check?.expectedText;
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  if (text >= '2020-01-01') return text;
  // "26/08/14" read as DD/MM/YY was stored as 2014-08-26.
  const [y, m, d] = text.split('-').map(Number);
  return iso(2000 + d, m, y % 100);
}

export type StoredDatesStatement = {
  dates?: { printedWeekEnding?: string | null } | null;
  prime?: { checks?: { id: string; expectedText?: string }[] } | null;
};

export function findSavedWeeksNeedingDateCheck(
  settlements: { id: string; week_ending: string; carrier: string | null; statement?: StoredDatesStatement | null }[],
  today: string
): SavedWeekDateCheck[] {
  const out: SavedWeekDateCheck[] = [];
  for (const s of settlements) {
    const reasons: DateCheckReason[] = [];
    const printed = printedWeekEndingOf(s.statement);
    if (s.week_ending < '2025-01-01') reasons.push('before_2025');
    if (s.week_ending > today) reasons.push('future');
    if (isPrimeCarrier(s.carrier) && !isFriday(s.week_ending)) reasons.push('not_friday');
    if (printed && printed !== s.week_ending) reasons.push('differs_from_printed');
    if (reasons.length === 0) continue;
    out.push({ id: s.id, weekEnding: s.week_ending, reasons, suggested: suggestedWeekEnding(s.week_ending, printed, today) });
  }
  return out.sort((a, b) => a.weekEnding.localeCompare(b.weekEnding));
}

// The one-tap fix: the printed date when the statement recorded one, else
// the YY/MM/DD reading of a DD/MM/YY misread (2014-08-26 -> 2026-08-14)
// when that lands on a plausible Friday. Null = the owner picks.
function suggestedWeekEnding(weekEnding: string, printed: string | null, today: string): string | null {
  if (printed && printed >= '2025-01-01' && printed <= addDaysIso(today, FUTURE_MAX_DAYS)) return printed;
  const [y, m, d] = weekEnding.split('-').map(Number);
  const swapped = iso(2000 + d, m, y % 100);
  if (swapped && swapped !== weekEnding && swapped >= '2025-01-01' && swapped <= addDaysIso(today, FUTURE_MAX_DAYS) && isFriday(swapped)) return swapped;
  return null;
}
