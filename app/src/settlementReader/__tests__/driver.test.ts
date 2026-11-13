// THE READER'S RUN LOOP with simulated model replies: what the Edge
// Function does for one job, call by call (range -> one content read ->
// gate -> attachments), saving after every call and continuing in the next
// run when time is up.
import { PRIME_13_WEEKS } from './fixtures/prime13Weeks';
import { printedFromExtraction, printedFromWeek } from './fixtures/printedReading';
import { figuresOf, primeRangeReply } from './fixtures/runReader';
import { golden0814 } from '@/src/data/__tests__/golden0814Fixture';
import { MAX_READER_RUNS, runReader, type ModelReply, type ModelRequest, type ReaderIO } from '../driver';
import { newReaderProgress, type JobStatus, type ReaderProgress } from '../machine';
import type { AttachmentReply, ContentReading } from '../schema';
import type { Extraction } from '@/src/import/types';

const week = (iso: string) => PRIME_13_WEEKS.find((w) => w.weekEnding === iso)!;
const usage = { input_tokens: 10_000, output_tokens: 2_000 };
const ok = (value: unknown): ModelReply => ({ outcome: { ok: true, value }, usage, ms: 1000 });
const err = (error: 'timeout' | 'refusal' | 'busy'): ModelReply => ({ outcome: { ok: false, error }, usage: null, ms: 1000 });
const otherPage: AttachmentReply = { kind: 'other', repair: { invoice: '', shop: '', unit: '', description: '', odometer: '', total: '' }, tolls: { agency: '', total: '', items: [] } };

type Saved = { progress: ReaderProgress; status: JobStatus; extraction?: Extraction | null; final?: boolean };

function fakeIO(opts: {
  reply: (req: ModelRequest, n: number) => ModelReply;
  general?: () => ModelReply;
  clock?: number[]; // elapsed ms returned on each elapsedMs() call (last one repeats)
  limits?: ReaderIO['limits'];
  loseLeaseAt?: number;
}) {
  const requests: ModelRequest[] = [];
  const saved: Saved[] = [];
  const usageLog: { success: boolean; reason?: string }[] = [];
  let continued = 0;
  let clockAt = 0;
  const io: ReaderIO = {
    limits: opts.limits ?? { exitByMs: 300_000, callEndLimitMs: 310_000, startMarginMs: 15_000 },
    elapsedMs: () => {
      const c = opts.clock ?? [0];
      return c[Math.min(clockAt++, c.length - 1)];
    },
    async call(req) {
      requests.push(req);
      return opts.reply(req, requests.length);
    },
    async general() {
      requests.push({ role: 'content', model: 'general' } as ModelRequest);
      return opts.general!();
    },
    async save(s) {
      saved.push(s);
      return opts.loseLeaseAt == null || saved.length < opts.loseLeaseAt;
    },
    async logImport(success, reason) {
      usageLog.push({ success, ...(reason ? { reason } : {}) });
    },
    async continueInNextRun() {
      continued++;
    },
    log: () => {},
  };
  return { io, requests, saved, usageLog, continued: () => continued };
}

const lastSaved = (saved: Saved[]) => saved[saved.length - 1];
const lastExtraction = (saved: Saved[]) => [...saved].reverse().find((s) => s.extraction)?.extraction ?? null;

describe('runReader', () => {
  test('08/14, 17 pages: range (haiku) -> one content read (opus, pages 1-6) -> ready -> 11 attachments (haiku, one page each)', async () => {
    const w = week('2026-08-14');
    const reading = printedFromExtraction(golden0814(), { cashFlow: true });
    const f = fakeIO({
      reply: (req) => (req.role === 'range' ? ok(primeRangeReply(17, 6, true)) : req.role === 'content' ? ok(reading) : ok(otherPage)),
    });
    const r = await runReader({ progress: newReaderProgress(17, '2026-08-15'), extraction: null }, f.io);
    expect(r).toEqual({ kind: 'final', calls: 13 });
    expect(f.requests.map((q) => [q.role, q.model, q.pages.join(',')])).toEqual([
      ['range', 'claude-haiku-5-5', '1,2,3,4,5,6,7,8,9,10'],
      ['content', 'claude-opus-5-5', '1,2,3,4,5,6'],
      ...Array.from({ length: 11 }, (_, i) => ['attachment', 'claude-haiku-5-5', String(i + 7)]),
    ]);
    expect(f.requests.map((q) => q.effort)).toEqual(['low', 'medium', ...Array(11).fill('low')]);
    const end = lastSaved(f.saved);
    expect([end.status, end.final, end.progress.readsStarted, end.progress.cost.length]).toEqual(['ready', true, 1, 13]);
    expect(f.usageLog).toEqual([{ success: true }]);
    expect(figuresOf(lastExtraction(f.saved)!, '2026-08-15')).toMatchObject({ status: 'pass', deposited: w.deposited, profit: w.profit });
    // The read was counted (saved) BEFORE the content call.
    const beforeContent = f.saved.findIndex((s) => s.progress.readsStarted === 1);
    expect(f.saved[beforeContent].progress.cost.map((c) => c.role)).toEqual(['range']);
  });

  test('8-page week (08/21): 2 attachments; no Fable call anywhere', async () => {
    const f = fakeIO({ reply: (req) => (req.role === 'range' ? ok(primeRangeReply(8, 6, true)) : req.role === 'content' ? ok(printedFromWeek(week('2026-08-21'))) : ok(otherPage)) });
    await runReader({ progress: newReaderProgress(8, '2026-08-22'), extraction: null }, f.io);
    expect(f.requests.map((q) => q.role)).toEqual(['range', 'content', 'attachment', 'attachment']);
    expect(f.requests.some((q) => /fable/i.test(q.model))).toBe(false);
  });

  test('time is up before the content call: saved, continued; the next run starts at the content read (no second range call)', async () => {
    const f = fakeIO({
      reply: (req) => (req.role === 'range' ? ok(primeRangeReply(8, 6, true)) : ok(printedFromWeek(week('2026-08-21')))),
      clock: [0, 250_000],
    });
    const r1 = await runReader({ progress: newReaderProgress(8, '2026-08-22'), extraction: null }, f.io);
    expect(r1.kind).toBe('continued');
    expect(f.continued()).toBe(1);
    const mid = lastSaved(f.saved);
    expect([mid.status, mid.progress.step, mid.progress.readsStarted]).toEqual(['processing', 'content', 0]);
    const g = fakeIO({ reply: (req) => (req.role === 'content' ? ok(printedFromWeek(week('2026-08-21'))) : ok(otherPage)) });
    const r2 = await runReader({ progress: mid.progress, extraction: null }, g.io);
    expect(r2.kind).toBe('final');
    expect(g.requests.map((q) => q.role)).toEqual(['content', 'attachment', 'attachment']);
    expect(lastSaved(g.saved).progress.runs).toBe(2);
  });

  test('fallback split: a content timeout reads pages 1-4, then 5-6; statement rows numbered from 1 are put back on pages 5-6', async () => {
    const whole = printedFromWeek(week('2026-08-14'));
    const { statement, ...settlementPart } = whole;
    const relative = { statement: { ...statement, rows: statement.rows.map((r) => ({ ...r, page: r.page - 4 })) } };
    const f = fakeIO({
      reply: (req) =>
        req.role === 'range' ? ok(primeRangeReply(8, 6, true)) : req.role === 'content' ? err('timeout') : req.role === 'split_settlement' ? ok(settlementPart) : req.role === 'split_statement' ? ok(relative) : ok(otherPage),
    });
    await runReader({ progress: newReaderProgress(8, '2026-08-15'), extraction: null }, f.io);
    expect(f.requests.map((q) => `${q.role}:${q.pages.join(',')}`).slice(0, 4)).toEqual(['range:1,2,3,4,5,6,7,8', 'content:1,2,3,4,5,6', 'split_settlement:1,2,3,4', 'split_statement:5,6']);
    const end = lastSaved(f.saved);
    expect([end.status, end.progress.readsStarted]).toEqual(['ready', 1]);
    const lines = lastExtraction(f.saved)!.settlement!.operating!.lines!;
    expect([...new Set(lines.map((l) => l.page))].sort()).toEqual([...new Set(statement.rows.map((r) => r.page))].sort());
  });

  test('two failing reads -> failed, one failure row in the usage log, no attachments read', async () => {
    const f = fakeIO({ reply: (req) => (req.role === 'range' ? ok(primeRangeReply(8, 6, true)) : err('refusal')) });
    const r = await runReader({ progress: newReaderProgress(8, '2026-08-15'), extraction: null }, f.io);
    expect(r.kind).toBe('final');
    expect(f.requests.map((q) => q.role)).toEqual(['range', 'content', 'content']);
    expect(lastSaved(f.saved)).toMatchObject({ status: 'failed', final: true, progress: { failure: { reason: 'model_failed', error: 'refusal' } } });
    expect(f.usageLog).toEqual([{ success: false, reason: 'model_failed: refusal' }]);
  });

  test('not a settlement: the general reader reads the whole file once', async () => {
    const receipt = { docType: 'store', store: { vendor: 'WALMART' } } as unknown as Extraction;
    const f = fakeIO({ reply: () => ok({ carrier: '', isSettlement: false, pages: [] }), general: () => ok(receipt) });
    await runReader({ progress: newReaderProgress(3, '2026-08-15'), extraction: null }, f.io);
    expect(f.requests.map((q) => q.model)).toEqual(['claude-haiku-5-5', 'general']);
    expect(lastSaved(f.saved)).toMatchObject({ status: 'ready', final: true });
    expect(lastExtraction(f.saved)).toEqual(receipt);
    expect(f.usageLog).toEqual([{ success: true }]);
  });

  test('a lost lease stops the run without another write', async () => {
    const f = fakeIO({ reply: () => ok(primeRangeReply(8, 6, true)), loseLeaseAt: 2 });
    const r = await runReader({ progress: newReaderProgress(8, '2026-08-15'), extraction: null }, f.io);
    expect(r.kind).toBe('lease_lost');
    expect(f.saved).toHaveLength(2);
  });

  test('a chain that never ends is stopped', async () => {
    const f = fakeIO({ reply: () => ok(primeRangeReply(8, 6, true)) });
    const p = { ...newReaderProgress(8, '2026-08-15'), runs: MAX_READER_RUNS };
    const r = await runReader({ progress: p, extraction: null }, f.io);
    expect(r.kind).toBe('final');
    expect(f.requests).toHaveLength(0);
    expect(lastSaved(f.saved).progress.failure).toEqual({ reason: 'too_many_runs' });
  });

  test('a final job makes no call', async () => {
    const f = fakeIO({ reply: () => ok({}) });
    const done = { ...newReaderProgress(8, '2026-08-15'), state: 'failed' as const, step: 'done' as const };
    await runReader({ progress: done, extraction: null }, f.io);
    expect(f.requests).toHaveLength(0);
  });

  test('needs_input counts as one import; the run does not wait for the answers', async () => {
    const r = printedFromWeek(week('2026-07-24'));
    const reading: ContentReading = { ...r, statement: { ...r.statement, rows: r.statement.rows.filter((row) => row.label !== 'ADVANCES') } };
    const f = fakeIO({ reply: (req) => (req.role === 'range' ? ok(primeRangeReply(8, 6, false)) : req.role === 'content' ? ok(reading) : ok(otherPage)) });
    await runReader({ progress: newReaderProgress(8, '2026-07-25'), extraction: null }, f.io);
    expect(lastSaved(f.saved)).toMatchObject({ status: 'needs_decision', final: true });
    expect(f.usageLog).toEqual([{ success: true }]);
  });
});
