// DIAGNOSTICS JOB DETAIL + SERVER BUILD STAMP (owner decision 2026-11-03).
import * as fs from 'fs';
import * as path from 'path';
import { jobLine, stampedBuildId, summarizeJobs, AI_IMPORT_BUILD_ID } from '../../../../supabase/functions/ai-import/diagnose';
import { AI_IMPORT_GIT_HASH } from '../../../../supabase/functions/ai-import/buildStamp';
import { clientJobToLine, jobLineText, withAppVerdicts } from '@/src/lib/systemReport';
import { setLocalFinal, type ImportJob } from '@/src/import/importJobs';
import en from '@/src/i18n/locales/en.json';

const enT = (key: string, opts?: Record<string, unknown>) => {
  let v: unknown = en;
  for (const p of key.split('.')) v = (v as Record<string, unknown> | undefined)?.[p];
  if (typeof v !== 'string') throw new Error(`missing en key ${key}`);
  return v.replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => String(opts?.[k] ?? ''));
};

describe('the 10-page "ready 4/10 unreadable" job names its page and cause', () => {
  const row = {
    id: 'a1b2c3d4-0000-0000-0000-000000000000',
    status: 'ready',
    created_at: '2026-11-03T09:10:00Z',
    pages_done: 4,
    pages_total: 10,
    page_results: {
      '1': { status: 'done', role: 'content', kind: 'settlement' },
      '2': { status: 'done', role: 'content', kind: 'settlement' },
      '3': { status: 'done', role: 'content', kind: 'statement' },
      '4': { status: 'done', role: 'content', kind: 'statement' },
      '7': { status: 'failed', role: 'attachment', kind: 'delivery_receipt', error: { type: 'unreadable', message: 'never shown' } },
    },
    progress: { failed: [{ page: 7, kind: 'delivery_receipt', type: 'unreadable', run: 1 }] },
    review: null,
  };
  test('page 7, unreadable, attachment; message never copied', () => {
    const l = jobLine(row);
    expect(l.pageErrors).toEqual([{ page: 7, type: 'unreadable', role: 'attachment', kind: 'delivery_receipt', detail: null, attempts: null }]);
    expect(l.verdictSource).toBe('none');
    expect(JSON.stringify(l)).not.toContain('never shown');
    expect(jobLineText(l, enT)).toBe('ready · 4/10 pages · verdict none · p7 unreadable (attachment)');
  });
});

describe('verdict source, final state and failing checks per job', () => {
  test('a server verdict', () => {
    const l = jobLine({
      id: 'f00dbabe-1',
      status: 'ready',
      created_at: '2026-11-03T09:26:00Z',
      pages_done: 6,
      pages_total: 8,
      review: { reads: 2, final: { state: 'failed_final', reason: 'same_values', failures: ['variableCosts'], details: [{ check: 'variableCosts', printed: -592.69, read: -609.87 }] } },
    });
    expect(l).toMatchObject({ jobId: 'f00dbabe', verdictSource: 'server', finalState: 'failed_final', failingChecks: ['variableCosts'] });
    expect(jobLineText(l, enT)).toBe('ready · 6/8 pages · verdict server failed_final · checks variableCosts · variableCosts: -592.69 / -609.87');
    // A failed_final job is listed among the errors although its status is ready.
    const s = summarizeJobs([{ id: 'f00dbabe-1', status: 'ready', created_at: '2026-11-03T09:26:00Z', review: { final: { state: 'failed_final' } } }], Date.parse('2026-11-03T10:00:00Z'));
    expect(s.lastErrors).toHaveLength(1);
  });

  test('a verdict decided on the device is marked "app"', () => {
    const job = {
      id: 'c0ffee00-9999',
      status: 'ready',
      pagesDone: 6,
      pagesTotal: 9,
      createdAt: '2026-11-03T09:00:00Z',
      review: { reads: 1, final: null, triggers: [] },
    } as unknown as ImportJob;
    setLocalFinal(job.id, 1, 'ready_final');
    expect(clientJobToLine(job)).toMatchObject({ verdictSource: 'app', finalState: 'ready_final' });
    const serverLine = jobLine({ id: job.id, status: 'ready', created_at: job.createdAt, pages_done: 6, pages_total: 9, review: null });
    expect(withAppVerdicts([serverLine], [job])[0]).toMatchObject({ verdictSource: 'app', finalState: 'ready_final' });
  });
});

describe('mergeConflict: the field, both values, each page with its label, and the week ending', () => {
  test('08/21 (8 pages): settlement.operating.directDeposit 1,884.36 (p3 NET AMOUNT DUE UNIT) / 1,884.73 (p4)', () => {
    const l = jobLine({
      id: 'abcd1234-08',
      status: 'ready',
      created_at: '2026-11-03T11:00:00Z',
      pages_done: 6,
      pages_total: 8,
      page_results: {
        '1': { status: 'done', role: 'content', kind: 'settlement', extraction: { settlement: { weekEnding: '2026-08-21' } } },
        '3': { status: 'done', role: 'content', kind: 'settlement', extraction: { settlement: { operating: { directDeposit: 1884.36, directDepositLabel: 'NET AMOUNT DUE UNIT' } } } },
        '4': { status: 'done', role: 'content', kind: 'statement', extraction: { settlement: { operating: { directDeposit: 1884.73 } } } },
        '6': { status: 'failed', role: 'content', kind: 'statement', attempts: 2, error: { type: 'unreadable', detail: 'parse_failed', message: 'never shown' } },
      },
      review: { reads: 1, final: { state: 'failed_final', reason: 'same_values', failures: ['mergeConflict'], details: [{ check: 'settlement.operating.directDeposit', printed: 1884.36, read: 1884.73 }] } },
    });
    expect(l.weekEnding).toBe('2026-08-21');
    expect(l.failingDetails).toEqual([
      {
        check: 'settlement.operating.directDeposit',
        printed: 1884.36,
        read: 1884.73,
        pages: [
          { page: 3, value: 1884.36, label: 'NET AMOUNT DUE UNIT' },
          { page: 4, value: 1884.73, label: null },
        ],
      },
    ]);
    expect(jobLineText(l, enT)).toBe(
      'W/E 2026-08-21 · ready · 6/8 pages · verdict server failed_final · checks mergeConflict · settlement.operating.directDeposit: 1884.36 / 1884.73 (p3 1884.36 "NET AMOUNT DUE UNIT"; p4 1884.73) · p6 unreadable (content, parse_failed, 2 tries)'
    );
    expect(JSON.stringify(l)).not.toContain('never shown');
  });
});

describe('server build stamp', () => {
  test('the build id is the git hash written at deploy time, never "step-A"', () => {
    expect(stampedBuildId('598448f', '2026-11-03T14:05:00Z')).toBe('ai-import 598448f (2026-11-03T14:05:00Z)');
    expect(stampedBuildId('598448f+dirty', '')).toBe('ai-import 598448f+dirty');
    expect(stampedBuildId('step-A', '')).toBe('ai-import not-stamped');
    expect(AI_IMPORT_BUILD_ID).not.toContain('step-A');
  });
  test('the committed stamp file is never stamped; the deploy script writes and restores it', () => {
    expect(AI_IMPORT_GIT_HASH).toBe('not-stamped');
    const script = fs.readFileSync(path.resolve(__dirname, '../../../../scripts/deploy-ai-import.ps1'), 'utf8');
    expect(script).toContain('git rev-parse --short HEAD');
    expect(script).toContain('npx supabase functions deploy ai-import --project-ref mbzonnoglreoeqihzfce');
    // Every CLI call goes through npx (no global supabase on the owner's machine).
    expect(script.split(/\r?\n/).filter((l) => /^\s*supabase /.test(l))).toEqual([]);
    expect(script).toMatch(/finally\s*\{\s*\[System\.IO\.File\]::WriteAllText\(\$stampFile, \$original\)/);
  });
});
