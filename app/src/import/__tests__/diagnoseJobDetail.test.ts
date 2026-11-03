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
    expect(l.pageErrors).toEqual([{ page: 7, type: 'unreadable', role: 'attachment', kind: 'delivery_receipt' }]);
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
    expect(jobLineText(l, enT)).toBe('ready · 6/8 pages · verdict server failed_final · checks variableCosts');
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
    expect(script).toContain('supabase functions deploy ai-import --project-ref mbzonnoglreoeqihzfce');
    expect(script).toMatch(/finally\s*\{\s*\[System\.IO\.File\]::WriteAllText\(\$stampFile, \$original\)/);
  });
});
