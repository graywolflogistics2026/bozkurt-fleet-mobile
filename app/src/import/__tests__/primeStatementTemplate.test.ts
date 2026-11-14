// MISSING-LINE DETECTION from the known Prime template (owner decision
// 2026-11-03, docs/decisions/prime-statement-template.md).
import { STATEMENT, STATEMENT_LINES, withStatement } from '@/src/data/__tests__/golden0814Fixture';
import { blockDiagnosisLine, diagnosePrimeBlocks, PRIME_TEMPLATE } from '@/src/import/primeStatementTemplate';
import { evaluateSettlementGate, rereadRequestFor } from '@/src/import/settlementGate';
import { classifyStatementLine, normalizeStatementLabel } from '@/src/import/primeStatementLines';

// The 08/14 statement split over pages 5 (revenue .. misc) and 6 (fixed,
// other), each line tagged with its page as the server merge does.
const onPages = (lines: typeof STATEMENT_LINES) =>
  lines.map((l) => ({ ...l, page: ['fixed', 'other'].includes(l.section) ? 6 : 5 }));

describe('the template', () => {
  test('every template label is a known line of its own block', () => {
    for (const block of PRIME_TEMPLATE) {
      for (const label of block.labels) expect(classifyStatementLine({ section: block.section, label }).unknown).toBe(false);
    }
  });
  test('every label of the golden 08/14 statement is in the template, in its block', () => {
    for (const l of STATEMENT_LINES.filter((x) => x.label !== 'MILES')) {
      const block = PRIME_TEMPLATE.find((b) => b.section === l.section)!;
      expect(block.labels).toContain(normalizeStatementLabel(l.label));
    }
  });
});

describe('a block that does not add up', () => {
  test('FUEL block: STATE FUEL TAX not read — named, with its page', () => {
    const lines = onPages(STATEMENT_LINES.filter((l) => l.label !== 'STATE FUEL TAX'));
    const d = diagnosePrimeBlocks(withStatement({ lines }));
    expect(d).toEqual([
      expect.objectContaining({ section: 'fuel_oil_tax', printed: -2046.69, read: -2173.49, difference: 126.8, wholeBlockMissing: false, readTwice: [], pages: [5] }),
    ]);
    // Every other fuel label was read: exactly the missing one is named.
    expect(d[0].missing).toEqual(['STATE FUEL TAX']);
    expect(blockDiagnosisLine(d[0])).toBe('FUEL block (printed -2046.69, read -2173.49): STATE FUEL TAX missing · page 5');
  });

  test('a line read twice is named', () => {
    const lines = onPages([...STATEMENT_LINES, { section: 'misc', label: 'WIRE CHARGE', amount: -5 }]);
    const d = diagnosePrimeBlocks(withStatement({ lines }));
    expect(d.map((b) => [b.section, b.readTwice])).toEqual([['misc', ['WIRE CHARGE']]]);
  });

  test('07/24 shape: a whole block unread (no line, no TOTAL line) — its share of the TOTAL VARIABLE COSTS gap, the pages around it', () => {
    const lines = onPages(STATEMENT_LINES.filter((l) => l.section !== 'repair'));
    const d = diagnosePrimeBlocks(withStatement({ lines, weekTotalRepair: undefined }));
    // TIRES printed nothing this week either: both are named, once.
    expect(d).toEqual([
      expect.objectContaining({ section: 'repair', name: 'REPAIR or TIRES', printed: null, difference: -652.53, wholeBlockMissing: true, missing: ['UNIT REPAIR EXPENSE', 'RO PARTS REPAIR', 'TIRES'], pages: [5] }),
    ]);
    // The block this truck printed before comes first.
    const tiresUsual = diagnosePrimeBlocks(withStatement({ lines, weekTotalRepair: undefined }), new Set(['TIRES']));
    expect(tiresUsual[0]).toMatchObject({ name: 'TIRES or REPAIR', missing: ['TIRES', 'UNIT REPAIR EXPENSE', 'RO PARTS REPAIR'] });
  });

  test('the automatic re-read reads only the block pages and names the labels', () => {
    const lines = onPages(STATEMENT_LINES.filter((l) => l.section !== 'repair'));
    // The printed totals do not tie (TOTAL STATEMENT misread), so the gate fails.
    const e = withStatement({ lines, weekTotalRepair: undefined, weekTotalStatement: 4375.49 });
    const gate = evaluateSettlementGate(e, { importDate: '2026-08-15' });
    const request = rereadRequestFor(gate, { ...e, pageMap: [5, 6].map((page) => ({ page, kind: 'statement', role: 'content' as const, status: 'read' as const })) });
    expect(request?.pages).toEqual([5]);
    expect(request?.reason).toContain('REPAIR or TIRES block (gap -652.53): no line and no TOTAL line read; UNIT REPAIR EXPENSE, RO PARTS REPAIR, TIRES missing · page 5');
  });
});
