// Statement reading plan step A: ai-import mode "diagnose" (pure parts)
// and the Settings > Diagnostics report. The model client is mocked —
// no network.
import {
  assembleDiagnoseReport,
  buildModelCheckBody,
  columnErrorMeansMissing,
  DIAGNOSE_MODELS,
  estimateCostUsd,
  interpretModelResponse,
  planInfo,
  rpcProbePresent,
  runModelCheck,
  summarizeJobs,
  type DiagnoseReport,
  type FetchLike,
} from '../../../../supabase/functions/ai-import/diagnose';
import { limitsForPlan } from '../../../../supabase/functions/ai-import/jobEngine';
import { scrubBankDigitsInText } from '../../../../supabase/functions/ai-import/bankDigits';
import { buildReportSections, formatReportText, type ClientInfo } from '@/src/lib/systemReport';
import type { ImportJob } from '@/src/import/importJobs';
import en from '@/src/i18n/locales/en.json';
import es from '@/src/i18n/locales/es.json';
import ru from '@/src/i18n/locales/ru.json';
import tr from '@/src/i18n/locales/tr.json';
import hi from '@/src/i18n/locales/hi.json';

const API_KEY = 'sk-ant-api03-SECRETSECRETSECRET-abcdef';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlc2VjcmV0';

function okReply(model: string) {
  return {
    status: 200,
    json: async () => ({
      model,
      stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"ok":true,"word":"ready"}' }],
      usage: { input_tokens: 40, output_tokens: 12 },
    }),
  };
}

describe('model check request shape', () => {
  it.each(DIAGNOSE_MODELS)('%s uses structured output, adaptive thinking and an effort, no forced tool or temperature', (model) => {
    const body = buildModelCheckBody(model) as Record<string, any>;
    expect(body.model).toBe(model);
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.output_config.format.schema.additionalProperties).toBe(false);
    expect(['low', 'medium']).toContain(body.output_config.effort);
    expect(body.tool_choice).toBeUndefined();
    expect(body.tools).toBeUndefined();
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBeGreaterThanOrEqual(2000);
  });
});

describe('model check result', () => {
  it('OK with latency and tokens', async () => {
    let t = 1000;
    const fetcher: FetchLike = jest.fn(async (_url, init) => {
      t += 850;
      expect(init.headers['x-api-key']).toBe(API_KEY);
      return okReply('claude-opus-5-5');
    });
    const r = await runModelCheck('claude-opus-5-5', API_KEY, fetcher, scrubBankDigitsInText, { now: () => t });
    expect(r).toMatchObject({ ok: true, outcome: 'ok', httpStatus: 200, inputTokens: 40, outputTokens: 12, latencyMs: 850 });
    expect(r.costUsd).toBeCloseTo((40 * 4 + 12 * 20) / 1e6, 10);
  });

  it('reports the exact API error type and message', () => {
    const r = interpretModelResponse(
      'claude-fable-5-1',
      400,
      { type: 'error', error: { type: 'invalid_request_error', message: 'This model requires 30-day data retention.' } },
      120,
      [API_KEY],
      scrubBankDigitsInText,
    );
    expect(r).toMatchObject({ ok: false, outcome: 'invalid_request_error', httpStatus: 400 });
    expect(r.detail).toBe('This model requires 30-day data retention.');
  });

  it('not found is a failure', () => {
    const r = interpretModelResponse('claude-sonnet-5-5', 404, { error: { type: 'not_found_error', message: 'model: x' } }, 50, [], scrubBankDigitsInText);
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('not_found_error');
  });

  it.each(['refusal', 'max_tokens'])('stop_reason %s is a failure of that call', (stop) => {
    const r = interpretModelResponse(
      'claude-haiku-5-5',
      200,
      { stop_reason: stop, content: [{ type: 'text', text: '{"ok":true,"word":"ready"}' }], usage: { input_tokens: 1, output_tokens: 1 } },
      10,
      [],
      scrubBankDigitsInText,
    );
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe(stop);
  });

  it('a reply that does not match the schema is a failure', () => {
    const r = interpretModelResponse('claude-haiku-5-5', 200, { stop_reason: 'end_turn', content: [{ type: 'text', text: 'sure!' }] }, 10, [], scrubBankDigitsInText);
    expect(r).toMatchObject({ ok: false, outcome: 'bad_output' });
  });

  it('a network error never echoes the key', async () => {
    const fetcher: FetchLike = async () => {
      throw new Error(`connect failed for key ${API_KEY}`);
    };
    const r = await runModelCheck('claude-opus-5-5', API_KEY, fetcher, scrubBankDigitsInText);
    expect(r.outcome).toBe('network');
    expect(r.detail).not.toContain(API_KEY);
    expect(r.detail).toContain('[secret]');
  });

  it('prices', () => {
    expect(estimateCostUsd('claude-haiku-5-5', 1_000_000, 0)).toBeCloseTo(0.1);
    expect(estimateCostUsd('unknown-model', 1, 1)).toBeNull();
  });
});

describe('schema probes', () => {
  it('a missing column is named, other errors are not', () => {
    expect(columnErrorMeansMissing({ code: '42703', message: 'column settlements.statement does not exist' })).toBe(true);
    expect(columnErrorMeansMissing({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(columnErrorMeansMissing(null)).toBe(false);
  });

  it('a database function is present only when PostgREST suggests that exact name', () => {
    expect(
      rpcProbePresent('import_job_claim', {
        code: 'PGRST202',
        message: 'Could not find the function public.import_job_claim(diagnose_probe_never_a_real_arg) in the schema cache',
        hint: 'Perhaps you meant to call the function public.import_job_claim(p_job_id, p_lease_seconds, p_owner)',
      }),
    ).toBe(true);
    expect(
      rpcProbePresent('import_job_saved', {
        code: 'PGRST202',
        message: 'Could not find the function public.import_job_saved(diagnose_probe_never_a_real_arg) in the schema cache',
        hint: 'Perhaps you meant to call the function public.import_job_claim(p_job_id, p_lease_seconds, p_owner)',
      }),
    ).toBe(false);
    expect(rpcProbePresent('import_job_saved', { code: 'PGRST202', message: 'Could not find the function', hint: null })).toBe(false);
    expect(rpcProbePresent('x', { code: '42501', message: 'permission denied for function x' })).toBe(true);
  });
});

describe('plan', () => {
  it('free and pro budgets', () => {
    expect(planInfo('free', limitsForPlan('free'))).toEqual({ plan: 'free', exitBySeconds: 130, wallClockSeconds: 150 });
    expect(planInfo('paid', limitsForPlan('paid'))).toEqual({ plan: 'pro', exitBySeconds: 300, wallClockSeconds: 400 });
  });
});

const NOW = Date.parse('2026-10-31T12:00:00Z');
const JOB_ROWS = [
  {
    status: 'failed',
    created_at: '2026-10-31T10:00:00Z',
    error_step: 'parse_failed',
    error_page: 6,
    pages_done: 5,
    pages_total: 8,
    page_results: { '6': { status: 'failed', error: { type: 'unreadable', message: 'DIRECT DEPOSIT routing 111000025 $1,884.73' } } },
    progress: { failed: [{ page: 6, kind: 'statement', type: 'unreadable', run: 2 }] },
    error_message: 'Statement GRWLLG-OY-PrimeInc6.pdf deposit 1,884.73 acct 123456789',
  },
  { status: 'ready', created_at: '2026-10-31T09:00:00Z', pages_done: 8, pages_total: 8 },
  { status: 'ready', created_at: '2026-10-29T09:00:00Z', pages_done: 17, pages_total: 17 },
];

describe('job summary', () => {
  it('counts the last 24 h by status and lists errors by code only', () => {
    const s = summarizeJobs(JOB_ROWS, NOW);
    expect(s.last24hByStatus).toEqual({ failed: 1, ready: 1 });
    expect(s.lastErrors).toEqual([
      { status: 'failed', createdAt: '2026-10-31T10:00:00Z', pagesDone: 5, pagesTotal: 8, errorStep: 'parse_failed', errorPage: 6, failedChecks: ['unreadable'] },
    ]);
    expect(s.lastJobs).toHaveLength(3);
  });
});

function fullReport(): DiagnoseReport {
  return assembleDiagnoseReport(
    {
      deploymentId: 'dep-123',
      plan: planInfo('paid', limitsForPlan('paid')),
      anthropicKeyPresent: true,
      storageReachable: true,
      schema: { ok: false, missingColumns: ['settlements.statement'], missingFunctions: ['import_job_saved'] },
      jobs: summarizeJobs(JOB_ROWS, NOW),
      models: [
        { model: 'claude-opus-5-5', ok: true, httpStatus: 200, outcome: 'ok', detail: null, stopReason: 'end_turn', latencyMs: 2400, inputTokens: 40, outputTokens: 12, costUsd: 0.0004 },
        {
          model: 'claude-fable-5-1',
          ok: false,
          httpStatus: 401,
          outcome: 'authentication_error',
          detail: `invalid x-api-key ${API_KEY} for account 987654321`,
          stopReason: null,
          latencyMs: 300,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
        },
      ],
      checkedAt: '2026-10-31T12:00:00.000Z',
    },
    [API_KEY, SERVICE_KEY],
    scrubBankDigitsInText,
  );
}

describe('diagnose never returns a secret', () => {
  it('no key, no service token, no file name, no amount, no bank digits anywhere in the report', () => {
    const text = JSON.stringify(fullReport());
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain('sk-ant-');
    expect(text).not.toContain(SERVICE_KEY);
    expect(text).not.toContain('GRWLLG');
    expect(text).not.toContain('1,884.73');
    expect(text).not.toContain('111000025');
    expect(text).not.toContain('123456789');
    expect(text).not.toContain('987654321');
    expect(text).toContain('[secret]');
  });
});

const CLIENT: ClientInfo = {
  version: '1.1.0',
  updateId: 'abcdef12-3456-7890-abcd-ef1234567890',
  updateIdShort: 'abcdef12',
  channel: 'preview',
  runtimeVersion: '1.1.0',
  gitCommitHash: 'f16b24f0000',
  gitCommitHashShort: 'f16b24f',
  isEmbeddedLaunch: false,
  scannerPresent: true,
  platform: 'android 34',
};

const enT = (key: string, opts?: Record<string, unknown>) => {
  let v: any = en;
  for (const p of key.split('.')) v = v?.[p];
  if (typeof v !== 'string') throw new Error(`missing en key ${key}`);
  return v.replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => String(opts?.[k] ?? ''));
};

describe('Share report text', () => {
  it('green and red per line, everything from the check, no amounts or digits', () => {
    const sections = buildReportSections(CLIENT, fullReport(), [], enT);
    const text = formatReportText(sections, enT('diagnostics.reportHeader'), '2026-10-31T12:00:00.000Z');
    expect(text).toContain('🟢 App version: 1.1.0');
    expect(text).toContain('🟢 Document scanner: yes');
    expect(text).toContain('🟢 Channel: preview');
    expect(text).toContain('Build stamp: f16b24f');
    expect(text).toContain('pro · stops by 300 s of 400 s');
    expect(text).toContain('🔴 Database: missing: settlements.statement, import_job_saved');
    expect(text).toContain('🟢 claude-opus-5-5: OK · 2.4 s · 40 in / 12 out tokens');
    expect(text).toContain('🔴 claude-fable-5-1: authentication_error (401)');
    expect(text).toContain('failed · 5/8 pages · parse_failed @ p6 · unreadable');
    expect(text).not.toContain('$');
    expect(text).not.toContain('1,884');
    expect(text).not.toContain('GRWLLG');
    expect(text).not.toContain(API_KEY);
  });

  it('without a server check, the last 5 jobs come from the app list (codes only)', () => {
    const jobs: ImportJob[] = Array.from({ length: 7 }, (_, i) => ({
      id: `j${i}`,
      status: i === 0 ? 'failed' : 'ready',
      pagesDone: 3,
      pagesTotal: 8,
      fileName: 'Prime settlement 1,884.73.pdf',
      mediaType: 'application/pdf',
      errorMessage: i === 0 ? 'deposit 1,884.73 to routing 111000025' : null,
      errorStep: i === 0 ? 'parse_failed' : null,
      createdAt: `2026-10-3${i % 2}T0${i}:00:00Z`,
      updatedAt: '2026-10-31T00:00:00Z',
      completedAt: null,
    }));
    const sections = buildReportSections({ ...CLIENT, isEmbeddedLaunch: true, scannerPresent: false }, null, jobs, enT);
    const text = formatReportText(sections, 'r', 'now');
    expect(text).toContain('🔴 Update: embedded build (no OTA update)');
    expect(text).toContain('🔴 Document scanner: no');
    const jobSection = sections[sections.length - 1];
    expect(jobSection.lines).toHaveLength(5);
    expect(jobSection.lines[0].ok).toBe(false);
    expect(text).not.toContain('1,884');
    expect(text).not.toContain('111000025');
    expect(text).not.toContain('.pdf');
  });
});

describe('diagnostics strings in the 5 enabled locales', () => {
  it('every en key exists and keeps its placeholders in es, ru, tr, hi', () => {
    const base = (en as any).diagnostics as Record<string, string>;
    for (const [name, loc] of Object.entries({ es, ru, tr, hi })) {
      const d = (loc as any).diagnostics as Record<string, string>;
      for (const [k, v] of Object.entries(base)) {
        expect(typeof d[k]).toBe('string');
        const ph = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort();
        expect([name, k, ph(d[k])]).toEqual([name, k, ph(v)]);
      }
    }
    expect((tr as any).diagnostics.shareReport).toBe('Raporu paylaş');
  });
});
