// R3 — SETTLEMENT SECTION TOTALS ONLY FROM TOTAL LABELS (owner decision
// 2026-11-03, device finding: a partial page's "AS 23.50" was taken as
// totalDeductions). Prime only (carrier isolation).
import { mergeAllPages, mergeChunkedExtractions, type ChunkExtraction } from '../../../../supabase/functions/ai-import/chunking';

const page = (settlement: Record<string, unknown>): ChunkExtraction => ({ docType: 'settlement', settlement } as ChunkExtraction);
const PRIME = 'Prime Inc';

describe('R3: settlement totals from TOTAL labels only', () => {
  test('a page without the TOTAL line contributes no total, even when it put a line value in the field', () => {
    const merged = mergeChunkedExtractions([
      page({ carrier: PRIME, totalDeductions: 23.5, settlementTotalLines: [] }), // "AS 23.50" on a partial page
      page({ totalDeductions: 0, settlementTotalLines: [{ label: 'TOTAL DEDUCTIONS FROM TRUCK', amount: '1,884.73' }] }),
    ]);
    expect(merged.settlement?.totalDeductions).toBe(1884.73);
    expect(merged.mergeConflicts).toBeUndefined();
  });

  test('each field takes only its own label; a non-TOTAL line never fills a total', () => {
    const merged = mergeChunkedExtractions([
      page({
        carrier: PRIME,
        grossRevenue: 4276.08, // NET AMOUNT DUE UNIT misread as gross
        netPay: 0,
        settlementTotalLines: [
          { label: 'TOTAL REV', amount: 7914.1 },
          { label: 'TOTAL REIMBURSED', amount: '184.85' },
          { label: 'GROSS AMOUNT DUE UNIT', amount: 8098.95 },
          { label: 'NET AMOUNT DUE UNIT', amount: 4276.08 },
        ],
      }),
    ]);
    expect(merged.settlement).toMatchObject({ grossRevenue: 7914.1, reimbursements: 184.85, netPay: 4276.08, totalDeductions: 0 });
    expect((merged.settlement as Record<string, unknown>).totalLabels).toMatchObject({ grossRevenue: 'TOTAL REV', netPay: 'NET AMOUNT DUE UNIT', totalDeductions: '' });
  });

  test('the same TOTAL label printed with two values is still a conflict', () => {
    const merged = mergeChunkedExtractions([
      page({ carrier: PRIME, settlementTotalLines: [{ label: 'TOTAL REV', amount: 7914.1 }] }),
      page({ settlementTotalLines: [{ label: 'TOTAL REV', amount: 7941.1 }] }),
    ]);
    expect(merged.mergeConflicts).toEqual([{ path: 'settlement.grossRevenue', values: [7914.1, 7941.1] }]);
  });

  test('a page read before the list existed keeps its fields; another carrier is untouched', () => {
    const old = mergeChunkedExtractions([page({ carrier: PRIME, totalDeductions: 1884.73 }), page({ netPay: 4276.08 })]);
    expect(old.settlement).toMatchObject({ totalDeductions: 1884.73, netPay: 4276.08 });
    const other = mergeChunkedExtractions([page({ carrier: 'Acme Freight', grossRevenue: 3000, settlementTotalLines: [] })]);
    expect(other.settlement?.grossRevenue).toBe(3000);
  });

  test('a single read page goes through the same rule', () => {
    const r = mergeAllPages([{ page: 2, extraction: page({ carrier: PRIME, totalDeductions: 23.5, settlementTotalLines: [] }) }]);
    expect(r?.extraction.settlement?.totalDeductions).toBe(0);
  });
});
