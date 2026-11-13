// THE READER'S STATE MACHINE (P4) and the pieces around it: content range,
// fallback split, attachments, schemas, cost. Every state is reachable, no
// state loops, at most 2 content reads, an identical result stops at once.
import { PRIME_13_WEEKS } from './fixtures/prime13Weeks';
import { printedFromExtraction, printedFromWeek } from './fixtures/printedReading';
import { addDays, figuresOf, primeRangeReply } from './fixtures/runReader';
import { golden0814 } from '@/src/data/__tests__/golden0814Fixture';
import {
  MAX_CONTENT_READS,
  afterAnswers,
  afterAttachment,
  afterContent,
  afterRange,
  afterSplitSettlement,
  afterSplitStatement,
  canReadAgain,
  isReaderProgress,
  newReaderProgress,
  pendingAttachments,
  readAgain,
  startContentRead,
  statusOf,
  type ReaderProgress,
  type Transition,
} from '../machine';
import { MAX_ATTACHMENT_PAGES, RANGE_WINDOW_PAGES, contentRange, pagesUpTo } from '../range';
import { ATTACHMENT_SCHEMA, CONTENT_SCHEMA, RANGE_SCHEMA, SETTLEMENT_PART_SCHEMA, STATEMENT_PART_SCHEMA, type AttachmentReply, type ContentReading, type JsonSchema, type SettlementPart, type StatementPart } from '../schema';
import { ROLE_MODEL, costByRole, costEntry, costOf, totalCost } from '../cost';
import { readingToExtraction } from '../toExtraction';

const week = (iso: string) => PRIME_13_WEEKS.find((w) => w.weekEnding === iso)!;
const ctx = (iso: string) => ({ importDate: addDays(iso, 1) });

function atContent(iso: string): ReaderProgress {
  const w = week(iso);
  const range = contentRange(primeRangeReply(w.pages, w.lastContentPage, w.cashFlowPrinted), w.pages);
  return afterRange(newReaderProgress(w.pages), { ok: true, value: range }).progress;
}
const read = (p: ReaderProgress) => startContentRead(p)!;
const good = (iso: string) => printedFromWeek(week(iso));
// A reading whose printed TOTAL STATEMENT does not tie to the statement's
// other printed totals: the gate fails.
const broken = (iso: string, by = 100): ContentReading => {
  const r = good(iso);
  return {
    ...r,
    statement: {
      ...r.statement,
      rows: r.statement.rows.map((row) => (/^TOTAL STATEMENT/.test(row.label) ? { ...row, weeks: shift(row.weeks, by) } : row)),
    },
  };
};
function shift(printed: string, by: number): string {
  const neg = printed.trim().endsWith('-');
  const n = Number(printed.replace(/[-,]/g, '')) * (neg ? -1 : 1) + by;
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `${s}-` : s;
}
// 07/24 without its ADVANCES line: TOTAL MISCELLANEOUS -550.00 is printed,
// nothing was read in the block, so the owner is asked for ADVANCES.
const withoutAdvances = (): ContentReading => {
  const r = good('2026-07-24');
  return { ...r, statement: { ...r.statement, rows: r.statement.rows.filter((row) => row.label !== 'ADVANCES') } };
};

describe('states', () => {
  test('status column per state', () => {
    expect(['reading', 'ready', 'needs_input', 'failed'].map((s) => statusOf(s as never))).toEqual(['processing', 'ready', 'needs_decision', 'failed']);
    expect(isReaderProgress(newReaderProgress(8))).toBe(true);
    expect(isReaderProgress({ stage: 'pages' })).toBe(false);
  });

  test('reading -> ready', () => {
    const t = afterContent(read(atContent('2026-08-14')), { ok: true, value: good('2026-08-14') }, ctx('2026-08-14'));
    expect([t.progress.state, t.status, t.progress.readsStarted]).toEqual(['ready', 'ready', 1]);
    expect(t.extraction?.docType).toBe('settlement');
  });

  test('reading -> needs_input -> ready (the owner types ADVANCES; no model call)', () => {
    const t = afterContent(read(atContent('2026-07-24')), { ok: true, value: withoutAdvances() }, ctx('2026-07-24'));
    expect([t.progress.state, t.status]).toEqual(['needs_input', 'needs_decision']);
    // Nothing of the misc block was read: every misc profit line is asked.
    expect(t.progress.questions.map((q) => q.label)).toEqual(['ADVANCES', 'OPERATOR TRK EXTRAS', 'PERSONAL PYMNT RCV']);
    const partial = afterAnswers(t.progress, t.extraction!, [{ label: 'OPERATOR TRK EXTRAS', amount: 0 }], ctx('2026-07-24'))!;
    expect([partial.progress.state, partial.progress.questions.map((q) => q.label)]).toEqual(['needs_input', ['ADVANCES', 'PERSONAL PYMNT RCV']]);
    const answered = afterAnswers(partial.progress, partial.extraction!, [{ label: 'ADVANCES', amount: 550 }, { label: 'PERSONAL PYMNT RCV', amount: 0 }], ctx('2026-07-24'))!;
    expect([answered.progress.state, answered.progress.readsStarted]).toEqual(['ready', 1]);
    expect(figuresOf(answered.extraction!, '2026-07-25')).toMatchObject({ status: 'pass', owedToCarrier: 1155.28 });
    // Answers are only taken in needs_input.
    expect(afterAnswers(answered.progress, answered.extraction!, [], ctx('2026-07-24'))).toBeNull();
  });

  test('reading -> failed: the gate fails twice with different results (max 2 reads)', () => {
    const first = afterContent(read(atContent('2026-08-14')), { ok: true, value: broken('2026-08-14', 100) }, ctx('2026-08-14'));
    expect([first.progress.state, first.progress.step, first.progress.lastReadCause]).toEqual(['reading', 'content', 'auto']);
    const second = afterContent(read(first.progress), { ok: true, value: broken('2026-08-14', 200) }, ctx('2026-08-14'));
    expect([second.progress.state, second.status, second.progress.readsStarted]).toEqual(['failed', 'failed', MAX_CONTENT_READS]);
    expect(second.progress.failure?.reason).toBeDefined();
    expect(second.progress.failure?.reason).not.toBe('same_result');
    expect(startContentRead(second.progress)).toBeNull();
    expect(canReadAgain(second.progress)).toBe(false);
    expect(readAgain(second.progress)).toBeNull();
  });

  test('an identical result stops at once', () => {
    const first = afterContent(read(atContent('2026-08-14')), { ok: true, value: broken('2026-08-14') }, ctx('2026-08-14'));
    // The job read again itself; the owner's [Read again] is not offered
    // while reading.
    expect(canReadAgain(first.progress)).toBe(false);
    const p = { ...first.progress, readsStarted: 0 }; // as if reads remained
    const second = afterContent(read(p), { ok: true, value: broken('2026-08-14') }, ctx('2026-08-14'));
    expect(second.progress.state).toBe('failed');
    expect(second.progress.reads.map((r) => r.signature)).toEqual([first.progress.reads[0].signature, first.progress.reads[0].signature]);
  });

  test('failed -> [Read again] -> reading, only while reads remain, counts toward the max', () => {
    let p = read(atContent('2026-08-14'));
    p = afterContent(p, { ok: false, error: 'refusal' }, ctx('2026-08-14')).progress;
    expect([p.state, p.step]).toEqual(['reading', 'content']);
    p = afterContent(read(p), { ok: false, error: 'refusal' }, ctx('2026-08-14')).progress;
    expect([p.state, p.failure]).toEqual(['failed', { reason: 'model_failed', error: 'refusal' }]);
    expect(readAgain(p)).toBeNull();

    // A first read that fails with reads left (e.g. the worker stopped
    // after one auto read was spent elsewhere).
    const once = { ...read(atContent('2026-08-14')), state: 'failed' as const, step: 'done' as const, failure: { reason: 'model_failed' as const } };
    expect(canReadAgain(once)).toBe(true);
    const again = readAgain(once)!;
    expect([again.progress.state, again.status, again.progress.lastReadCause]).toEqual(['reading', 'processing', 'read_again']);
    const done = afterContent(read(again.progress), { ok: true, value: good('2026-08-14') }, ctx('2026-08-14'));
    expect([done.progress.state, done.progress.readsStarted]).toEqual(['ready', 2]);
  });

  test('range not found -> failed, never a content read', () => {
    const reply = { carrier: 'PRIME INC.', isSettlement: true, pages: [{ page: 1, kind: 'attachment' as const, hasTotalCashFlow: false, hasTotalStatement: false }] };
    const t = afterRange(newReaderProgress(8), { ok: true, value: contentRange(reply, 8) });
    expect([t.progress.state, t.progress.failure?.reason]).toEqual(['failed', 'range_not_found']);
    expect(startContentRead(t.progress)).toBeNull();
    // A range failure is ours (owner 2026-11-13): Read again re-runs the
    // range call (no content read was counted), at most 3 range calls.
    expect(canReadAgain(t.progress)).toBe(true);
    expect(readAgain(t.progress)?.progress.step).toBe('range');
    const range = { role: 'range' as const, model: 'm', inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, usd: 0, ms: 0, outcome: 'ok' };
    expect(canReadAgain({ ...t.progress, cost: [range, range, range] })).toBe(false);
    const err = afterRange(newReaderProgress(8), { ok: false, error: 'busy' });
    expect(err.progress.failure).toEqual({ reason: 'range_not_found', error: 'busy' });
  });

  test('no loops: from any state, model reads end within 2 (exhaustive walk)', () => {
    // Walk every sequence of outcomes; each path ends in ready, needs_input
    // or failed within MAX_CONTENT_READS content reads (+ split halves).
    const outcomes = [
      { ok: true as const, value: good('2026-08-14') },
      { ok: true as const, value: broken('2026-08-14', 100) },
      { ok: true as const, value: broken('2026-08-14', 300) },
      { ok: false as const, error: 'refusal' as const },
      { ok: false as const, error: 'timeout' as const },
    ];
    let paths = 0;
    const walk = (p: ReaderProgress, depth: number) => {
      expect(depth).toBeLessThanOrEqual(MAX_CONTENT_READS * 3);
      if (p.state !== 'reading') {
        paths++;
        expect(p.readsStarted).toBeLessThanOrEqual(MAX_CONTENT_READS);
        return;
      }
      if (p.step === 'split_settlement') {
        walk(afterSplitSettlement(p, { ok: true, value: good('2026-08-14') }).progress, depth + 1);
        walk(afterSplitSettlement(p, { ok: false, error: 'timeout' }).progress, depth + 1);
        return;
      }
      if (p.step === 'split_statement') {
        walk(afterSplitStatement(p, { ok: true, value: { statement: good('2026-08-14').statement } }, ctx('2026-08-14')).progress, depth + 1);
        return;
      }
      const started = startContentRead(p);
      expect(started).not.toBeNull();
      for (const o of outcomes) walk(afterContent(started!, o, ctx('2026-08-14')).progress, depth + 1);
    };
    walk(atContent('2026-08-14'), 0);
    expect(paths).toBeGreaterThan(20);
  });
});

describe('fallback split (P1: timeout or max_tokens only)', () => {
  const split = (error: 'timeout' | 'max_tokens'): Transition => afterContent(read(atContent('2026-08-14')), { ok: false, error }, ctx('2026-08-14'));

  test.each(['timeout', 'max_tokens'] as const)('%s -> settlement pages, then statement pages, combined by key -> ready', (error) => {
    const s1 = split(error);
    expect([s1.progress.state, s1.progress.step, s1.progress.readsStarted]).toEqual(['reading', 'split_settlement', 1]);
    // The range: pages 1-4 settlement, 5-6 statement.
    expect(s1.progress.range).toMatchObject({ lastContentPage: 6, statementFirst: 5 });
    const whole = good('2026-08-14');
    const { statement, ...settlementPart } = whole;
    const s2 = afterSplitSettlement(s1.progress, { ok: true, value: settlementPart as SettlementPart });
    expect(s2.progress.step).toBe('split_statement');
    const s3 = afterSplitStatement(s2.progress, { ok: true, value: { statement } as StatementPart }, ctx('2026-08-14'));
    expect([s3.progress.state, s3.progress.splitSettlement, s3.progress.readsStarted]).toEqual(['ready', null, 1]);
    expect(figuresOf(s3.extraction!, '2026-08-15')).toMatchObject({ status: 'pass', deposited: week('2026-08-14').deposited, profit: week('2026-08-14').profit });
  });

  test('a refusal or a bad reply does not split', () => {
    for (const error of ['refusal', 'unreadable_reply', 'api_error', 'busy'] as const) {
      expect(afterContent(read(atContent('2026-08-14')), { ok: false, error }, ctx('2026-08-14')).progress.step).toBe('content');
    }
  });

  test('a failed half counts as a failed read', () => {
    const s1 = split('timeout');
    const s2 = afterSplitSettlement(s1.progress, { ok: false, error: 'timeout' });
    expect([s2.progress.state, s2.progress.step, s2.progress.reads[0].outcome]).toEqual(['reading', 'content', 'model_failed']);
    const again = afterContent(read(s2.progress), { ok: false, error: 'timeout' }, ctx('2026-08-14'));
    const half = afterSplitSettlement(again.progress, { ok: false, error: 'max_tokens' });
    expect([half.progress.state, half.progress.failure]).toEqual(['failed', { reason: 'model_failed', error: 'max_tokens' }]);
  });
});

describe('content range (range test, owner table 2026-11-13)', () => {
  test.each(PRIME_13_WEEKS.map((w) => [w.weekEnding, w] as const))('%s', (_iso, w) => {
    const r = contentRange(primeRangeReply(w.pages, w.lastContentPage, w.cashFlowPrinted), w.pages);
    if (!r.ok) throw new Error('range not found');
    const after = w.pages - w.lastContentPage;
    expect(r.range).toMatchObject({ lastContentPage: w.lastContentPage, cashFlowPrinted: w.cashFlowPrinted, isSettlement: true });
    expect(r.range.attachmentPages).toEqual(pagesUpTo(w.lastContentPage + Math.min(after, MAX_ATTACHMENT_PAGES), w.lastContentPage + 1));
    expect(r.range.attachmentsNotRead).toBe(Math.max(0, after - MAX_ATTACHMENT_PAGES));
  });

  test('the owner\'s table', () => {
    expect(PRIME_13_WEEKS.map((w) => w.lastContentPage)).toEqual([5, 6, 6, 6, 6, 6, 6, 5, 6, 6, 5, 6, 6]);
    expect(PRIME_13_WEEKS.map((w) => w.pages)).toEqual([8, 8, 11, 13, 17, 8, 9, 10, 13, 21, 12, 13, 11]);
  });

  test('09/18 (21 pages): 15 attachments, 12 read, 3 not read', () => {
    const r = contentRange(primeRangeReply(21, 6, true), 21);
    expect(r.ok && [r.range.attachmentPages.length, r.range.attachmentsNotRead, r.range.attachmentPages[11]]).toEqual([12, 3, 18]);
  });

  test('pages outside the range window are ignored; TOTAL CASH FLOW wins over TOTAL STATEMENT', () => {
    const reply = primeRangeReply(13, 6, true);
    reply.pages.push({ page: 12, kind: 'statement', hasTotalCashFlow: true, hasTotalStatement: true });
    reply.pages[4] = { ...reply.pages[4], hasTotalStatement: true };
    const r = contentRange(reply, 13);
    expect(r.ok && r.range.lastContentPage).toBe(6);
    expect(RANGE_WINDOW_PAGES).toBe(10);
  });

  test('another carrier\'s settlement without a statement ends at its last settlement page; not a settlement = whole window', () => {
    const r = contentRange({ carrier: 'ACME', isSettlement: true, pages: [1, 2, 3].map((page) => ({ page, kind: page < 3 ? 'settlement' : 'attachment', hasTotalCashFlow: false, hasTotalStatement: false })) }, 3);
    expect(r.ok && [r.range.lastContentPage, r.range.statementFirst, r.range.attachmentPages]).toEqual([2, null, [3]]);
    const other = contentRange({ carrier: '', isSettlement: false, pages: [] }, 14);
    expect(other.ok && [other.range.lastContentPage, other.range.attachmentPages]).toEqual([10, []]);
  });
});

describe('attachments (P5: after ready, never gating)', () => {
  const repair: AttachmentReply = {
    kind: 'repair_invoice',
    repair: { invoice: 'R-1001', shop: 'TA TRUCK SERVICE', unit: '1234', description: 'OIL CHANGE', odometer: '512,300', total: '412.50' },
    tolls: { agency: '', total: '', items: [] },
  };
  const tolls: AttachmentReply = {
    kind: 'toll_bill',
    repair: { invoice: '', shop: '', unit: '', description: '', odometer: '', total: '' },
    tolls: { agency: 'E-ZPASS', total: '23.50', items: [{ date: '08/10/26', plaza: 'P1', location: 'NJ', amount: '23.50' }] },
  };

  test('17-page document: 6 content pages, 11 attachments read one by one; totals never change', () => {
    const t = afterContent(read(atContent('2026-08-14')), { ok: true, value: printedFromExtraction(golden0814(), { cashFlow: true }) }, ctx('2026-08-14'));
    expect(t.progress.state).toBe('ready');
    expect(pendingAttachments(t.progress)).toEqual(pagesUpTo(17, 7));
    expect(t.progress.attachments).toEqual({ total: 11, done: [], failed: [], notRead: 0 });
    const before = figuresOf(t.extraction!, '2026-08-15');
    let p = t.progress;
    let e = t.extraction!;
    for (const page of pendingAttachments(p)) {
      const outcome = page === 9 ? { ok: false as const, error: 'busy' as const } : { ok: true as const, value: page === 7 ? repair : page === 8 ? tolls : { ...repair, kind: 'other' as const } };
      ({ progress: p, extraction: e } = afterAttachment(p, e, page, outcome));
    }
    expect(pendingAttachments(p)).toEqual([]);
    expect([p.attachments.done.length, p.attachments.failed]).toEqual([10, [9]]);
    expect(p.state).toBe('ready');
    expect(figuresOf(e, '2026-08-15')).toEqual(before);
    expect(e.settlement!.maintenance).toContainEqual({ invoice: 'R-1001', unit: '1234', desc: 'TA TRUCK SERVICE — OIL CHANGE', odometer: 512300, total: 412.5 });
    expect(e.pageMap!.find((m) => m.page === 9)!.status).toBe('failed');
    expect(e.pageMap!.find((m) => m.page === 7)!.status).toBe('read');
  });

  test('no attachments while reading or failed', () => {
    expect(pendingAttachments(read(atContent('2026-08-14')))).toEqual([]);
  });
});

describe('schemas (structured output): closed, every key required, same keys as the types', () => {
  const walk = (s: JsonSchema, path: string, out: string[]) => {
    if (s.type === 'object') {
      const props = s.properties as Record<string, JsonSchema>;
      expect([path, s.additionalProperties]).toEqual([path, false]);
      expect([path, [...(s.required as string[])].sort()]).toEqual([path, Object.keys(props).sort()]);
      for (const [k, v] of Object.entries(props)) walk(v, `${path}.${k}`, out);
    } else if (s.type === 'array') walk(s.items as JsonSchema, `${path}[]`, out);
    else out.push(path);
  };
  const keysOf = (v: unknown, path: string, out: string[]) => {
    if (Array.isArray(v)) v.forEach((x) => keysOf(x, `${path}[]`, out));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) keysOf(x, `${path}.${k}`, out);
    else out.push(path);
  };

  test.each([
    ['content', CONTENT_SCHEMA],
    ['settlement part', SETTLEMENT_PART_SCHEMA],
    ['statement part', STATEMENT_PART_SCHEMA],
    ['range', RANGE_SCHEMA],
    ['attachment', ATTACHMENT_SCHEMA],
  ])('%s', (_n, schema) => walk(schema, '$', []));

  test('a printed reading uses only the content schema\'s keys, and every top-level key', () => {
    const fromSchema: string[] = [];
    walk(CONTENT_SCHEMA, '$', fromSchema);
    const fromReading: string[] = [];
    for (const r of [printedFromExtraction(golden0814(), { cashFlow: true }), good('2026-08-14')]) keysOf(r, '$', fromReading);
    expect([...new Set(fromReading)].filter((k) => !fromSchema.includes(k))).toEqual([]);
    expect(Object.keys(good('2026-08-14')).sort()).toEqual(Object.keys(CONTENT_SCHEMA.properties as object).sort());
  });

  test('a non-settlement content reply is docType other', () => {
    const e = readingToExtraction({ ...good('2026-08-14'), docType: 'other' }, { pagesTotal: 3, contentPages: [1, 2, 3], attachmentPages: [] });
    expect(e.docType).toBe('other');
  });
});

describe('cost per role', () => {
  test('models: haiku for range and attachments, opus for content; never Fable', () => {
    expect(ROLE_MODEL).toEqual({
      range: 'claude-haiku-5-5',
      content: 'claude-opus-5-5',
      split_settlement: 'claude-opus-5-5',
      split_statement: 'claude-opus-5-5',
      attachment: 'claude-haiku-5-5',
    });
    expect(Object.values(ROLE_MODEL).some((m) => /fable/i.test(m))).toBe(false);
  });

  test('prices per MTok', () => {
    expect(costOf('claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 100_000 })).toBe(6);
    expect(costOf('claude-opus-5-5', { cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 })).toBe(5.2);
    expect(costOf('claude-haiku-5-5', { input_tokens: 50_000, output_tokens: 1_000 })).toBe(0.0055);
    expect(costOf('claude-haiku-5-5', { input_tokens: 200_000, output_tokens: 1_000 })).toBe(0.1025);
    expect(costOf('unknown-model', { input_tokens: 1_000_000 })).toBe(0);
    expect(costOf('claude-opus-5-5', null)).toBe(0);
  });

  test('entries sum per role and in total', () => {
    const entries = [
      costEntry('range', 'claude-haiku-5-5', { input_tokens: 20_000, output_tokens: 500 }, 900, 'ok'),
      costEntry('content', 'claude-opus-5-5', { input_tokens: 30_000, output_tokens: 8_000 }, 60_000, 'ok'),
      costEntry('attachment', 'claude-haiku-5-5', { input_tokens: 3_000, output_tokens: 300 }, 700, 'ok', 7),
      costEntry('attachment', 'claude-haiku-5-5', { input_tokens: 3_000, output_tokens: 300 }, 700, 'busy', 8),
    ];
    expect(entries[2].page).toBe(7);
    expect(costByRole(entries)).toEqual([
      { role: 'range', calls: 1, inputTokens: 20_000, outputTokens: 500, usd: 0.0023 },
      { role: 'content', calls: 1, inputTokens: 30_000, outputTokens: 8_000, usd: 0.28 },
      { role: 'attachment', calls: 2, inputTokens: 6_000, outputTokens: 600, usd: 0.001 },
    ]);
    expect(totalCost(entries)).toBe(0.2833);
  });
});
