// PROFIT FROM TOTALS NEEDS ONLY A FEW LINES (owner decision 2026-11-03):
// a profit line the reading missed is typed by the owner on the review
// card (one field, the printed label shown) instead of failing the week.
import { STATEMENT_LINES, withStatement } from '@/src/data/__tests__/golden0814Fixture';
import { diagnosePrimeBlocks, profitLinesToAsk, withTypedStatementLines } from '@/src/import/primeStatementTemplate';
import { evaluateSettlementGate } from '@/src/import/settlementGate';

const noAdvances = withStatement({ lines: STATEMENT_LINES.filter((l) => l.label !== 'ADVANCES') });

describe('profit lines to ask', () => {
  test('a complete statement asks nothing', () => {
    expect(profitLinesToAsk(withStatement({}))).toEqual([]);
  });

  test('ADVANCES not read: the MISCELLANEOUS profit lines not read are asked, nothing else', () => {
    expect(profitLinesToAsk(noAdvances).map((q) => q.printed)).toEqual(['ADVANCES', 'OPERATOR TRK EXTRAS', 'PERSONAL PYMNT RCV']);
  });

  test('typing 550 for ADVANCES (0 for the rest) closes the block, adds no $0 rows, and asks nothing more', () => {
    const typed = withTypedStatementLines(noAdvances, [
      { label: 'ADVANCES', amount: 550 },
      { label: 'OPERATOR TRK EXTRAS', amount: 0 },
      { label: 'PERSONAL PYMNT RCV', amount: 0 },
    ]);
    const lines = typed.settlement!.operating!.lines!;
    expect(lines.filter((l) => l.typed)).toEqual([{ section: 'misc', label: 'ADVANCES', amount: -550, typed: true }]);
    expect(lines.some((l) => Number(l.amount) === 0)).toBe(false);
    expect(diagnosePrimeBlocks(typed)).toEqual([]);
    expect(profitLinesToAsk(typed)).toEqual([]);
    expect(evaluateSettlementGate(typed, { importDate: '2026-08-15' })?.status).toBe(evaluateSettlementGate(withStatement({}), { importDate: '2026-08-15' })?.status);
  });

  test('a credit line is signed plus, whatever sign was typed', () => {
    const t = withTypedStatementLines(noAdvances, [{ label: 'PERSONAL PYMNT RCV', amount: -25 }]);
    expect(t.settlement!.operating!.lines!.at(-1)).toMatchObject({ label: 'PERSONAL PYMNT RCV', amount: 25 });
  });
});
