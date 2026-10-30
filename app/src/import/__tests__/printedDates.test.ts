// PRINTED DATES (owner decision 2026-10-29, "DATES (definitive)", A7).
// Real strings from the two real Prime PDFs: W/E 8/14 prints SETTLEMENT
// DATE "26/08/14", print DATE "8/13/26", CreationDate D:20260813235659;
// W/E 8/21 prints "26/08/21", "8/20/26", CreationDate D:20260821012949.
import {
  checkOtherCarrierDates,
  checkPrimeSettlementDates,
  findSavedWeeksNeedingDateCheck,
  isDateGateSatisfied,
  isFriday,
  lineDateFromWeekEnding,
  parseInFormat,
  parsePrimePrintDate,
  parsePrimeSettlementDate,
  pdfCreationDateIso,
  readingsOf,
  rememberedDateFormat,
  settlementDateInputsOf,
} from '@/src/import/printedDates';
import { sanitizeExtractionDates } from '@/src/import/dateGuard';
import { buildPrimeStatementCheck, statementWeekEndingCheck } from '@/src/import/settlementStatement';
import { pdfCreationDateOf } from '../../../../supabase/functions/ai-import/pdfInfo';
import type { Extraction } from '@/src/import/types';

const IMPORT_DATE = '2026-10-29';
const W0814 = { carrier: 'PRIME INC.', settlementDateRaw: '26/08/14', printDateRaw: '8/13/26', statementWeekEndingRaw: '26/08/14', pdfCreationDate: '2026-08-13' };
const W0821 = { carrier: 'PRIME INC.', settlementDateRaw: '26/08/21', printDateRaw: '8/20/26', statementWeekEndingRaw: '26/08/21', pdfCreationDate: '2026-08-20' };

describe('Prime prints YY/MM/DD; only that order fits both real weeks', () => {
  test('"26/08/14" and "26/08/21" share "26/08" and only the third number moves by 7', () => {
    expect(parsePrimeSettlementDate('26/08/14')).toBe('2026-08-14');
    expect(parsePrimeSettlementDate('26/08/21')).toBe('2026-08-21');
    // Read as DD/MM/YY they become the "old years" bug.
    expect(parseInFormat('26/08/14', 'DMY')).toBe('2014-08-26');
    expect(parseInFormat('26/08/21', 'DMY')).toBe('2021-08-26');
    expect(isFriday('2026-08-14')).toBe(true);
    expect(isFriday('2026-08-21')).toBe(true);
  });

  test('the print DATE is M/D/YY', () => {
    expect(parsePrimePrintDate('8/13/26')).toBe('2026-08-13');
    expect(parsePrimePrintDate('8/20/26')).toBe('2026-08-20');
  });

  test('both real weeks pass the gate', () => {
    for (const w of [W0814, W0821]) {
      const check = checkPrimeSettlementDates(w, IMPORT_DATE);
      expect(check).toMatchObject({ passed: true, issues: [], format: 'YMD', printed: w.settlementDateRaw });
    }
    expect(checkPrimeSettlementDates(W0814, IMPORT_DATE).weekEnding).toBe('2026-08-14');
    expect(checkPrimeSettlementDates(W0821, IMPORT_DATE).weekEnding).toBe('2026-08-21');
    // The real 8/21 file was written 2026-08-21 01:29 — one day after its print date.
    expect(checkPrimeSettlementDates({ ...W0821, pdfCreationDate: 'D:20260821012949' }, IMPORT_DATE).passed).toBe(true);
  });
});

describe('the DD/MM/YY misread is caught for both weeks', () => {
  test.each([
    [W0814, '2014-08-26', '2026-08-14'],
    [W0821, '2021-08-26', '2026-08-21'],
  ])('the model said %s: the printed text wins and the model is ignored', (w, modelSaid, printed) => {
    const extraction: Extraction = {
      docType: 'settlement',
      settlement: { ...w, weekEnding: modelSaid, operating: { weekEnding: modelSaid } },
    };
    const sanitized = sanitizeExtractionDates(extraction, new Date(`${IMPORT_DATE}T12:00:00Z`));
    expect(sanitized.settlement?.weekEnding).toBe(printed);
    expect(checkPrimeSettlementDates(settlementDateInputsOf(sanitized), IMPORT_DATE).passed).toBe(true);
  });

  test.each([
    ['2014-08-26', '2026-08-13'],
    ['2021-08-26', '2026-08-20'],
  ])('an older reading (no printed text) that stored %s fails the gate and is never saved, even if "confirmed"', (misread, printDate) => {
    const check = checkPrimeSettlementDates({ carrier: 'PRIME INC.', weekEnding: misread, printDate }, IMPORT_DATE);
    expect(check.passed).toBe(false);
    expect(check.issues).toEqual(expect.arrayContaining(['older_reading', 'print_gap', 'not_friday', 'too_old']));
    expect(isDateGateSatisfied(check, misread, null)).toBe(false);
    if (misread < '2020-01-01') expect(isDateGateSatisfied(check, misread, { weekEnding: misread, by: 'user' })).toBe(false);
  });

  test('the year/day-swapped tolerance of 62c6435 is gone: 2014-08-26 is not "the same week" as 2026-08-14', () => {
    expect(statementWeekEndingCheck('2014-08-26', '2026-08-14')?.passed).toBe(false);
    expect(statementWeekEndingCheck('2026-08-14', '2026-08-14')?.passed).toBe(true);
  });

  test('the statement page check reads the printed text, never the model date', () => {
    const extraction: Extraction = {
      docType: 'settlement',
      settlement: {
        carrier: 'PRIME INC.',
        weekEnding: '2026-08-14',
        statementWeekEndingRaw: '26/08/14',
        operating: { weekEnding: '2014-08-26', lines: [{ section: 'revenue', label: 'REVENUE FROM PRIME INC.', amount: 100 }] },
      },
    };
    expect(buildPrimeStatementCheck(extraction)!.checks.find((c) => c.id === 'statementWeekEnding')).toMatchObject({ passed: true });
  });
});

describe('the plausibility gate (A2)', () => {
  test('settlement date − print date must be 0..7 days (real weeks: +1)', () => {
    expect(checkPrimeSettlementDates({ ...W0814, printDateRaw: '8/14/26', pdfCreationDate: null }, IMPORT_DATE).passed).toBe(true);
    expect(checkPrimeSettlementDates({ ...W0814, printDateRaw: '8/7/26', pdfCreationDate: null }, IMPORT_DATE).passed).toBe(true);
    expect(checkPrimeSettlementDates({ ...W0814, printDateRaw: '8/6/26', pdfCreationDate: null }, IMPORT_DATE).issues).toEqual(['print_gap']);
    expect(checkPrimeSettlementDates({ ...W0814, printDateRaw: '8/15/26', pdfCreationDate: null }, IMPORT_DATE).issues).toEqual(['print_gap']);
  });

  test('a week not ending on a Friday asks to confirm (soft)', () => {
    const check = checkPrimeSettlementDates(
      { carrier: 'PRIME INC.', settlementDateRaw: '26/08/13', printDateRaw: '8/12/26', statementWeekEndingRaw: '26/08/13' },
      IMPORT_DATE
    );
    expect(check.issues).toEqual(['not_friday']);
    expect(isDateGateSatisfied(check, '2026-08-13', null)).toBe(false);
    expect(isDateGateSatisfied(check, '2026-08-13', { weekEnding: '2026-08-13', by: 'user' })).toBe(true);
    // An answer for another date never counts.
    expect(isDateGateSatisfied(check, '2026-08-13', { weekEnding: '2026-08-14', by: 'user' })).toBe(false);
  });

  test('statement WEEK ENDING must equal the settlement date', () => {
    expect(checkPrimeSettlementDates({ ...W0814, statementWeekEndingRaw: '26/08/21' }, IMPORT_DATE).issues).toEqual(['statement_week_differs']);
  });

  test('PDF CreationDate within 3 days of the print date, when present', () => {
    expect(checkPrimeSettlementDates({ ...W0814, pdfCreationDate: '2026-08-16' }, IMPORT_DATE).passed).toBe(true);
    expect(checkPrimeSettlementDates({ ...W0814, pdfCreationDate: '2026-08-17' }, IMPORT_DATE).issues).toEqual(['pdf_created_far']);
    expect(checkPrimeSettlementDates({ ...W0814, pdfCreationDate: null }, IMPORT_DATE).passed).toBe(true);
  });

  test('not later than import date + 10 days; older than 14 months asks (catch-up years are legitimate)', () => {
    expect(checkPrimeSettlementDates({ ...W0814, pdfCreationDate: null }, '2026-08-04').passed).toBe(true);
    expect(checkPrimeSettlementDates({ ...W0814, pdfCreationDate: null }, '2026-08-03').issues).toEqual(['future']);
    expect(checkPrimeSettlementDates(W0814, '2027-10-14').passed).toBe(true);
    const old = checkPrimeSettlementDates(W0814, '2027-10-15');
    expect(old.issues).toEqual(['too_old']);
    expect(isDateGateSatisfied(old, '2026-08-14', { weekEnding: '2026-08-14', by: 'user' })).toBe(true);
  });

  test('nothing is read: unreadable, and Save stays blocked', () => {
    const check = checkPrimeSettlementDates({ carrier: 'PRIME INC.' }, IMPORT_DATE);
    expect(check.issues).toEqual(['unreadable']);
    expect(isDateGateSatisfied(check, null, null)).toBe(false);
  });
});

describe('MMDD line dates take their year from the week ending (A4)', () => {
  test('December/January wrap: 1228 on a week ending 2027-01-08 is 2026-12-28', () => {
    expect(lineDateFromWeekEnding('1228', '2027-01-08')).toBe('2026-12-28');
    expect(lineDateFromWeekEnding('0105', '2027-01-08')).toBe('2027-01-05');
    expect(lineDateFromWeekEnding('0108', '2027-01-08')).toBe('2027-01-08');
    expect(lineDateFromWeekEnding('0812', '2026-08-14')).toBe('2026-08-12');
  });

  test("the model's year is ignored on every line date of a Prime week", () => {
    const extraction: Extraction = {
      docType: 'settlement',
      settlement: {
        carrier: 'PRIME INC.',
        settlementDateRaw: '27/01/08',
        printDateRaw: '1/7/27',
        weekEnding: '2008-01-27',
        tractorFuel: [{ date: '2014-12-30', amount: 100 }, { date: '2027-01-04', amount: 50 }],
        loads: [{ order: '1', pickupDate: '2021-12-28', deliveryDate: '2021-01-02' }],
        tolls: { ezpass: { items: [{ date: '2014-01-06', amount: 5 }] } },
      },
    };
    const s = sanitizeExtractionDates(extraction, new Date('2027-01-20T12:00:00Z')).settlement!;
    expect(s.weekEnding).toBe('2027-01-08');
    expect(s.printDate).toBe('2027-01-07');
    expect(s.tractorFuel!.map((f) => f.date)).toEqual(['2026-12-30', '2027-01-04']);
    expect(s.loads![0]).toMatchObject({ pickupDate: '2026-12-28', deliveryDate: '2027-01-02' });
    expect(s.tolls!.ezpass!.items![0].date).toBe('2027-01-06');
    expect(checkPrimeSettlementDates(settlementDateInputsOf({ settlement: s }), '2027-01-20').passed).toBe(true);
  });
});

describe('other carriers: no Prime rule (A5)', () => {
  test('one possible reading is used as is', () => {
    expect(readingsOf('08/14/2026')).toEqual([{ format: 'MDY', iso: '2026-08-14' }]);
    expect(checkOtherCarrierDates({ carrier: 'Landstar', settlementDateRaw: '08/14/2026' }, IMPORT_DATE)).toMatchObject({ passed: true, weekEnding: '2026-08-14' });
  });

  test('an ambiguous printed date is asked; the confirmed format is remembered for that carrier', () => {
    const ask = checkOtherCarrierDates({ carrier: 'Landstar', settlementDateRaw: '07/08/26', weekEnding: '2026-07-08' }, IMPORT_DATE);
    expect(ask.issues).toEqual(['ambiguous']);
    expect(ask.weekEnding).toBe('2026-07-08');
    const saved = [
      { carrier: 'LANDSTAR', week_ending: '2026-07-08', statement: { dates: { format: 'DMY' as const, confirmedBy: 'user' } } },
      { carrier: 'PRIME INC', week_ending: '2026-08-14', statement: { dates: { format: 'YMD' as const, confirmedBy: null } } },
    ];
    expect(rememberedDateFormat('Landstar', saved)).toBe('DMY');
    expect(rememberedDateFormat('Werner', saved)).toBeNull();
    const next = checkOtherCarrierDates({ carrier: 'Landstar', settlementDateRaw: '14/08/26' }, IMPORT_DATE, 'DMY');
    expect(next).toMatchObject({ passed: true, weekEnding: '2026-08-14', format: 'DMY' });
    // No Prime rule: a Thursday is fine for another carrier.
    expect(checkOtherCarrierDates({ carrier: 'Landstar', settlementDateRaw: '13/08/26' }, IMPORT_DATE, 'DMY').passed).toBe(true);
  });

  test('the print date picks the one reading inside [print, print + 7]', () => {
    expect(checkOtherCarrierDates({ carrier: 'Werner', settlementDateRaw: '07/08/26', printDate: '2026-08-06' }, IMPORT_DATE)).toMatchObject({
      passed: true,
      weekEnding: '2026-08-07',
    });
  });
});

describe('"Needs a date check" for saved weeks (A6)', () => {
  const rows = [
    { id: 'misread', week_ending: '2014-08-26', carrier: 'PRIME INC', statement: null },
    {
      id: 'old-reading-ok',
      week_ending: '2026-08-14',
      carrier: 'PRIME INC',
      statement: { prime: { checks: [{ id: 'statementWeekEnding', expectedText: '2014-08-26' }] } },
    },
    { id: 'printed-differs', week_ending: '2026-08-14', carrier: 'PRIME INC', statement: { dates: { printedWeekEnding: '2026-08-21' } } },
    { id: 'thursday', week_ending: '2026-08-13', carrier: 'PRIME INC', statement: null },
    { id: 'future', week_ending: '2026-12-04', carrier: 'Landstar', statement: null },
    { id: 'thursday-other-carrier', week_ending: '2026-08-13', carrier: 'Landstar', statement: null },
    { id: 'fine', week_ending: '2026-08-21', carrier: 'PRIME INC', statement: null },
  ];

  test('lists exactly the weeks that break the rules, with the printed date suggested', () => {
    const found = findSavedWeeksNeedingDateCheck(rows, IMPORT_DATE);
    expect(found.map((f) => [f.id, f.reasons, f.suggested])).toEqual([
      ['misread', ['before_2025', 'not_friday'], '2026-08-14'],
      ['thursday', ['not_friday'], null],
      ['printed-differs', ['differs_from_printed'], '2026-08-21'],
      ['future', ['future'], null],
    ]);
  });
});

describe('PDF CreationDate (ai-import pdfInfo.ts)', () => {
  const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
  test("reads the real Prime stamp D:20260813235659--5'00' as 2026-08-13", () => {
    expect(pdfCreationDateOf(bytes("%PDF-1.4\n1 0 obj << /Producer (x) /CreationDate (D:20260813235659--5'00') >> endobj"))).toBe('2026-08-13');
    expect(pdfCreationDateIso("D:20260821012949--5'00'")).toBe('2026-08-21');
  });
  test('absent or broken -> null (the check is skipped, never guessed)', () => {
    expect(pdfCreationDateOf(bytes('%PDF-1.4 no info here'))).toBeNull();
    expect(pdfCreationDateOf(bytes('/CreationDate (D:20261345000000)'))).toBeNull();
  });
});
