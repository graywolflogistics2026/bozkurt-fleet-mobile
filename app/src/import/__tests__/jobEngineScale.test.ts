// SCALE TO ANY PAGE COUNT (owner add-on 2026-10-13): "no page count may
// make a job hang." Synthetic PDFs of 8, 17, 30, 60 and 150 pages and a
// 200-page file, run through the job engine in a simulated 150 s
// Free-plan world (./jobSimulation.ts). Prints the matrix (time to ready,
// runs, model calls, memory ceiling, behavior over each limit). Times and
// memory are ESTIMATES from the simulation's assumed per-page durations
// and pdf-lib factor — not measurements; the call counts, run counts and
// limit behavior follow exactly from the code.
import { checkImportLimits, MAX_IMPORT_FILE_BYTES, type PageKind } from '../../../../supabase/functions/ai-import/jobEngine';
import { attachmentMix, primeDoc, simulateImport, TEXT_PAGE_BYTES, type DocSpec, type SimOptions, type SimResult } from './jobSimulation';

const MB = 1024 * 1024;

// Attachment pages sized so the whole file stays under the 10 MB limit
// (a 150-page file under 10 MB averages ~65 KB per page).
function fitAttachments(doc: DocSpec): DocSpec {
  const attachments = doc.pages.filter((p) => p.kind !== 'settlement' && p.kind !== 'statement');
  const contentBytes = doc.pages.length * 0 + (doc.pages.length - attachments.length) * TEXT_PAGE_BYTES;
  const per = attachments.length > 0 ? Math.min(450 * 1024, Math.floor((9.5 * MB - contentBytes) / attachments.length)) : 0;
  return { ...doc, pages: doc.pages.map((p) => (p.kind === 'settlement' || p.kind === 'statement' ? p : { ...p, bytes: per })) };
}

function primeWithStatementAt(totalPages: number, statementPages: [number, number]): DocSpec {
  const pages: DocSpec['pages'] = [];
  for (let p = 1; p <= totalPages; p++) {
    let kind: PageKind = p < statementPages[0] ? 'settlement' : attachmentMix(totalPages)[p - 1];
    if (p === statementPages[0] || p === statementPages[1]) kind = 'statement';
    pages.push({ kind, bytes: TEXT_PAGE_BYTES, tcf: p === statementPages[1] });
  }
  return fitAttachments({ carrier: 'Prime Inc.', pages });
}

function unknownLayout(totalPages: number): DocSpec {
  return fitAttachments({ carrier: 'Acme Freight', pages: Array.from({ length: totalPages }, () => ({ kind: 'settlement' as PageKind, bytes: TEXT_PAGE_BYTES })) });
}

type Scenario = { name: string; doc: DocSpec; opts?: SimOptions };

const SCENARIOS: Scenario[] = [
  { name: '8 pages, Prime, whole document', doc: { ...fitAttachments(primeDoc(4, attachmentMix(2))), wholeDocMs: 85_000 } },
  { name: '8 pages, Prime, whole document times out', doc: { ...fitAttachments(primeDoc(4, attachmentMix(2))), wholeDocMs: 130_000 } },
  { name: '17 pages, Prime (6 content + 11 attachments)', doc: fitAttachments(primeDoc(4, attachmentMix(11))) },
  { name: '30 pages, Prime', doc: fitAttachments(primeDoc(4, attachmentMix(24))) },
  { name: '30 pages, unknown carrier', doc: unknownLayout(30) },
  { name: '60 pages, Prime', doc: fitAttachments(primeDoc(4, attachmentMix(54))) },
  { name: '60 pages, Prime, statement on pages 24-25', doc: primeWithStatementAt(60, [24, 25]) },
  { name: '150 pages, Prime', doc: fitAttachments(primeDoc(4, attachmentMix(144))) },
  { name: '150 pages, unknown carrier, "Read the first 40"', doc: unknownLayout(150), opts: { answerPageCap: 'read_first' } },
];

const results = new Map<string, SimResult>();

function secs(ms: number | null): string {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

describe('scale: no page count makes a job hang', () => {
  for (const sc of SCENARIOS) {
    it(sc.name, async () => {
      const sim = await simulateImport(sc.doc, sc.opts);
      results.set(sc.name, sim);
      // Every run obeys the call-start rule and exits by 130 s; the
      // platform never had to stop one.
      expect(sim.violations).toEqual([]);
      expect(sim.invocations.some((i) => i.killed)).toBe(false);
      for (const inv of sim.invocations) expect((inv.endMs ?? 0) - inv.startMs).toBeLessThanOrEqual(130_000);
      // It reaches "ready to review".
      expect(sim.readyAtMs).not.toBeNull();
      expect(['ready']).toContain(sim.row.status);
      // Ready to review costs CONTENT pages: the model never saw more
      // than 12 attachment pages, and no stored page was ever sent.
      expect(sim.modelCalls.attachment).toBeLessThanOrEqual(12);
      const stored = sim.row.plan.pages.filter((p) => p.role === 'stored').map((p) => p.page);
      for (const p of stored) expect(sim.pageCalls.has(p)).toBe(false);
      // ONE import against the allowance, whatever the page count.
      expect(sim.usage.filter((u) => u.callType === 'ai_import' && u.success)).toHaveLength(1);
      // Memory estimate stays far below the 256 MB worker limit.
      expect(sim.peakMemoryBytes).toBeLessThan(64 * MB);
    });
  }

  it('150 pages, unknown carrier: asks before reading past 40 — never a silent truncation', async () => {
    const sim = await simulateImport(unknownLayout(150));
    expect(sim.row.status).toBe('needs_decision');
    expect(sim.modelCalls.content).toBe(0);
    expect((sim.row.progress as { question: unknown }).question).toEqual({ kind: 'page_cap', totalPages: 150, cap: 40 });
    const read = await simulateImport(unknownLayout(150), { answerPageCap: 'read_first' });
    expect(read.modelCalls.content).toBe(40);
    expect(read.row.plan.pages.filter((p) => p.role === 'stored')).toHaveLength(110);
    const cancelled = await simulateImport(unknownLayout(150), { answerPageCap: 'cancel' });
    expect(cancelled.row.status).toBe('failed');
    expect(cancelled.modelCalls.content).toBe(0);
  });

  it('200 pages, or more than 10 MB, is refused before anything is read, with a way forward', () => {
    expect(checkImportLimits(200, 9 * MB)).toEqual({
      code: 'too_many_pages',
      message:
        'This file has 200 pages; the limit is 150 pages per import. Split it into smaller files (for example the settlement pages on their own) and import each one.',
    });
    expect(checkImportLimits(20, MAX_IMPORT_FILE_BYTES + 1)?.code).toBe('oversized');
  });

  afterAll(() => {
    const rows = SCENARIOS.map((sc) => {
      const r = results.get(sc.name);
      if (!r) return `| ${sc.name} | not run |`;
      const stored = r.row.plan.pages.filter((p) => p.role === 'stored').length;
      return `| ${sc.name} | ${secs(r.readyAtMs)} | ${secs(r.finishedAtMs)} | ${r.invocations.length} | ${r.modelCalls.whole}/${r.modelCalls.classify}/${r.modelCalls.content}/${r.modelCalls.attachment} | ${stored} | ${(r.peakMemoryBytes / MB).toFixed(0)} MB |`;
    });
    // eslint-disable-next-line no-console
    console.log(
      [
        '| Scenario | Ready to review (est.) | All done (est.) | Runs | Model calls whole/classify/content/attachment | Pages stored unread | Peak memory (est.) |',
        '|---|---|---|---|---|---|---|',
        ...rows,
        '| 200 pages | refused at start (limit 150) | — | 0 | 0 | — | — |',
      ].join('\n')
    );
  });
});
