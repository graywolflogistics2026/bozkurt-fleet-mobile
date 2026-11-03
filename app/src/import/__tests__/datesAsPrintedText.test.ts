// R1 — DATES AS PRINTED TEXT (owner decision 2026-11-03, device finding:
// "WEEK ENDING 26/08/21" came back as 2021-08-26 on one page and
// 2021-06-26 on another). Every settlement date is the printed text; the
// app parses it; the merge compares the raw strings.
import { mergeChunkedExtractions, type ChunkExtraction } from '../../../../supabase/functions/ai-import/chunking';
import { checkPrimeSettlementDates, settlementDateInputsOf } from '@/src/import/printedDates';
import { sanitizeExtractionDates } from '@/src/import/dateGuard';
import type { Extraction } from '@/src/import/types';

const IMPORT_DATE = '2026-11-03';
const page = (settlement: Record<string, unknown>): ChunkExtraction => ({ docType: 'settlement', settlement } as ChunkExtraction);

describe('R1: dates as printed text', () => {
  test('the merge compares the raw strings: two printed texts are a date conflict, the same text is not', () => {
    const same = mergeChunkedExtractions([
      page({ carrier: 'Prime Inc', settlementDateRaw: '26/08/21', weekEnding: '2021-08-26' }),
      page({ carrier: 'Prime Inc', operating: { weekEndingRaw: '26/08/21', weekEnding: '2021-06-26' } }),
    ]) as Extraction;
    expect(same.dateConflicts).toBeUndefined();

    const differ = mergeChunkedExtractions([
      page({ carrier: 'Prime Inc', settlementDateRaw: '26/08/21' }),
      page({ carrier: 'Prime Inc', settlementDateRaw: '26/08/ 21' }),
      page({ carrier: 'Prime Inc', settlementDateRaw: '26/06/21' }),
    ]) as Extraction;
    expect(differ.settlement?.settlementDateRaw).toBe('26/08/21');
    expect(differ.dateConflicts).toEqual([{ path: 'settlement.settlementDateRaw', values: ['26/08/21', '26/06/21'] }]);
    // A date conflict is not an amount conflict.
    expect(differ.mergeConflicts).toBeUndefined();
  });

  test('the model’s own ISO dates are never used once the printed settlement date was read', () => {
    const e = {
      docType: 'settlement',
      settlement: { carrier: 'Prime Inc', settlementDateRaw: '26/08/21', weekEnding: '2021-08-26', operating: { weekEnding: '2021-06-26', weekEndingRaw: '26/08/21' } },
    } as unknown as Extraction;
    const check = checkPrimeSettlementDates(settlementDateInputsOf(e), IMPORT_DATE);
    expect(check.weekEnding).toBe('2026-08-21');
    expect(check.statementWeekEnding).toBe('2026-08-21');
    expect(check.issues).not.toContain('statement_week_differs');
    expect(sanitizeExtractionDates(e).settlement?.weekEnding).toBe('2026-08-21');

    // No printed statement week: the model's 2021-06-26 is ignored, not compared.
    const noStatementText = { ...e, settlement: { ...e.settlement!, operating: { weekEnding: '2021-06-26' } } } as Extraction;
    const c2 = checkPrimeSettlementDates(settlementDateInputsOf(noStatementText), IMPORT_DATE);
    expect(c2.statementWeekEnding).toBeNull();
    expect(c2.issues).not.toContain('statement_week_differs');
  });

  test('the statement page’s own printed WEEK ENDING is compared with the settlement date', () => {
    const e = {
      docType: 'settlement',
      settlement: { carrier: 'Prime Inc', settlementDateRaw: '26/08/21', operating: { weekEndingRaw: '26/08/14' } },
    } as unknown as Extraction;
    expect(checkPrimeSettlementDates(settlementDateInputsOf(e), IMPORT_DATE).issues).toContain('statement_week_differs');
  });

  test('two pages that printed different date texts ask (pages_differ)', () => {
    const e = {
      docType: 'settlement',
      settlement: { carrier: 'Prime Inc', settlementDateRaw: '26/08/21' },
      dateConflicts: [{ path: 'settlement.settlementDateRaw', values: ['26/08/21', '26/06/21'] }],
    } as unknown as Extraction;
    expect(checkPrimeSettlementDates(settlementDateInputsOf(e), IMPORT_DATE).issues).toContain('pages_differ');
  });

  test('a printed Prime date that does not parse leaves the week ending empty (never the model’s date)', () => {
    const e = { docType: 'settlement', settlement: { carrier: 'Prime Inc', settlementDateRaw: 'WEEK 34', weekEnding: '2021-08-26' } } as unknown as Extraction;
    expect(sanitizeExtractionDates(e).settlement?.weekEnding).toBe('');
    expect(checkPrimeSettlementDates(settlementDateInputsOf(e), IMPORT_DATE).issues).toContain('unreadable');
  });

  test('another carrier: a printed date that reads one way only is that date', () => {
    const e = { docType: 'settlement', settlement: { carrier: 'Acme Freight', settlementDateRaw: '2026-08-21', weekEnding: '' } } as unknown as Extraction;
    expect(sanitizeExtractionDates(e).settlement?.weekEnding).toBe('2026-08-21');
  });
});
