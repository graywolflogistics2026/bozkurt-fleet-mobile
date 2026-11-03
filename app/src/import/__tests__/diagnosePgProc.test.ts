// DATABASE CHECK BY pg_proc (owner decision 2026-11-03): the Diagnostics
// database line comes from pg_proc (PENDING_SQL §85); the old PostgREST
// probe is only the fallback until §85 runs. Model labels are the real ids.
import * as fs from 'fs';
import * as path from 'path';
import { DIAGNOSE_MODELS, missingFromPgProc, REQUIRED_RPCS, type DiagnoseReport } from '../../../../supabase/functions/ai-import/diagnose';
import { buildReportSections, formatReportText, type ClientInfo } from '@/src/lib/systemReport';
import en from '@/src/i18n/locales/en.json';

const enT = (key: string, opts?: Record<string, unknown>) => {
  let v: unknown = en;
  for (const p of key.split('.')) v = (v as Record<string, unknown> | undefined)?.[p];
  if (typeof v !== 'string') throw new Error(`missing en key ${key}`);
  return v.replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => String(opts?.[k] ?? ''));
};

describe('missingFromPgProc', () => {
  test('all 8 functions exist: pg_proc returns an empty list', () => {
    expect(REQUIRED_RPCS).toHaveLength(8);
    expect(missingFromPgProc([], null)).toEqual([]);
  });
  test('names pg_proc reports missing are kept; names never asked for are not', () => {
    expect(missingFromPgProc(['import_job_saved', 'not_asked', 7], null)).toEqual(['import_job_saved']);
  });
  test('before §85 runs (the call errors) the probe is used', () => {
    expect(missingFromPgProc(null, { code: 'PGRST202', message: 'Could not find the function public.diagnose_missing_functions' })).toBeNull();
    expect(missingFromPgProc({ not: 'an array' }, null)).toBeNull();
  });
});

const CLIENT: ClientInfo = {
  version: '1.1.0',
  updateId: 'abcdef12-3456',
  updateIdShort: 'abcdef12',
  channel: 'preview',
  runtimeVersion: '1.1.0',
  gitCommitHash: 'e28b0a1000',
  gitCommitHashShort: 'e28b0a1',
  isEmbeddedLaunch: false,
  scannerPresent: true,
  platform: 'android 34',
};

function report(schema: DiagnoseReport['schema']): DiagnoseReport {
  return {
    serverBuildId: 'b',
    deploymentId: null,
    plan: { plan: 'pro', exitBySeconds: 300, wallClockSeconds: 400 },
    anthropicKeyPresent: true,
    storageReachable: true,
    schema,
    jobs: { last24hByStatus: {}, lastErrors: [], lastJobs: [] },
    models: [],
    checkedAt: '2026-11-03T12:00:00.000Z',
  } as unknown as DiagnoseReport;
}

describe('Diagnostics database line', () => {
  test('says which way the functions were checked', () => {
    const ok = formatReportText(buildReportSections(CLIENT, report({ ok: true, missingColumns: [], missingFunctions: [], functionsCheckedBy: 'pg_proc' }), [], enT), 'r', 'now');
    expect(ok).toContain('Database: OK (pg_proc)');
    const probe = formatReportText(
      buildReportSections(CLIENT, report({ ok: false, missingColumns: [], missingFunctions: ['import_job_claim'], functionsCheckedBy: 'probe' }), [], enT),
      'r',
      'now'
    );
    expect(probe).toContain('import_job_claim (probe)');
  });
});

describe('model labels', () => {
  test('the model ids are spelled as the API names them ("fable", never "faible")', () => {
    expect(DIAGNOSE_MODELS).toContain('claude-fable-5-1');
    const root = path.resolve(__dirname, '../../../..');
    const files = [
      'supabase/functions/ai-import/diagnose.ts',
      'supabase/functions/ai-import/index.ts',
      'app/src/lib/systemReport.ts',
      ...['en', 'es', 'ru', 'tr', 'hi', 'ar', 'uk'].map((l) => `app/src/i18n/locales/${l}.json`),
    ];
    for (const f of files) expect(fs.readFileSync(path.join(root, f), 'utf8')).not.toMatch(/faible/i);
  });
});
