// ONE TARGETED RE-READ FOR LINE DETAILS (owner decision 2026-11-03,
// priority of evidence): a saveable week whose block lines do not add up
// reads that block's pages once more first; if the re-read comes back
// worse, the saveable reading is kept.
import { STATEMENT_LINES, withStatement } from '@/src/data/__tests__/golden0814Fixture';
import { verdictOfReading } from '@/src/import/jobVerdict';
import { decideJobVerdict, reviewOf } from '../../../../supabase/functions/ai-import/jobEngine';
import { jobLine } from '../../../../supabase/functions/ai-import/diagnose';
import { jobLineText } from '@/src/lib/systemReport';

const opts = { nowIso: '2026-11-03T12:00:00Z', rereadable: true };
const onPages = (lines: typeof STATEMENT_LINES) => lines.map((l) => ({ ...l, page: ['fixed', 'other'].includes(l.section) ? 6 : 5 }));
// The 07/24 shape: STATE FUEL TAX not read, printed totals tie.
const reading = withStatement({ lines: onPages(STATEMENT_LINES.filter((l) => l.label !== 'STATE FUEL TAX')) });

describe('line-details re-read', () => {
  test('the verdict passes and asks for the FUEL block page once, naming the missing label', () => {
    const v = verdictOfReading(reading, 1, { importDate: '2026-08-15' });
    expect(v).toMatchObject({ readNo: 1, status: 'pass', lineReread: { pages: [5] } });
    expect(v.lineReread!.reason).toBe('FUEL block (printed -2046.69, read -2173.49): STATE FUEL TAX missing · page 5');
    expect(v.details).toEqual([{ check: 'block_fuel_oil_tax', printed: -2046.69, read: -2173.49 }]);
  });

  test('read 1 pass with block mismatch -> one re-read of page 5, the reading kept for rollback', () => {
    const v = verdictOfReading(reading, 1, { importDate: '2026-08-15' });
    const d = decideJobVerdict(reviewOf(null), v, opts);
    expect(d).toMatchObject({ action: 'reread', pages: [5], keepForRollback: true });
    expect(d.review).toMatchObject({ reads: 2, lineReread: { fromRead: 1 } });
    expect(d.review.triggers[0]).toMatchObject({ check: 'line_details', pages: [5] });

    // Read 2 still differs: final pass (never a second line re-read).
    const again = decideJobVerdict(d.review, { ...v, readNo: 2 }, opts);
    expect(again).toMatchObject({ action: 'final', review: { final: { state: 'ready_final', reason: 'pass' } } });

    // Read 2 came back worse (a fail): the kept reading is restored.
    const worse = decideJobVerdict(d.review, { readNo: 2, status: 'fail', reason: 'statement_check_failed', failures: ['statementTotal'] }, opts);
    expect(worse).toMatchObject({ action: 'rollback', review: { final: { state: 'ready_final', reason: 'line_reread_worse' } } });
  });

  test('a matching week never re-reads; a week that cannot be read again just passes', () => {
    expect(verdictOfReading(withStatement({}), 1, { importDate: '2026-08-15' })).toEqual({ readNo: 1, status: 'pass' });
    const v = verdictOfReading(reading, 1, { importDate: '2026-08-15' });
    expect(decideJobVerdict(reviewOf(null), v, { ...opts, rereadable: false })).toMatchObject({ action: 'final', review: { final: { state: 'ready_final', details: v.details } } });
  });

  test('Diagnostics names the block, the missing label and the page from the job', () => {
    const v = verdictOfReading(reading, 1, { importDate: '2026-08-15' });
    const first = decideJobVerdict(reviewOf(null), v, opts);
    const done = decideJobVerdict(first.review, { ...v, readNo: 2 }, opts);
    const l = jobLine({ id: 'feedf00d-1', status: 'ready', created_at: '2026-11-03T12:00:00Z', pages_done: 6, pages_total: 11, review: done.review });
    expect(jobLineText(l, (k) => k)).toContain('re-read: line_details: FUEL block (printed -2046.69, read -2173.49): STATE FUEL TAX missing · page 5');
    expect(jobLineText(l, (k) => k)).toContain('block_fuel_oil_tax: -2046.69 / -2173.49');
  });
});
