// supabase/functions/ai-import/diagnose.ts — the "diagnose" mode's pure
// parts (statement reading plan step A, owner 2026-10-31,
// docs/decisions/statement-reading-2026-10.md). No Deno APIs here, so Jest
// tests it directly (app/src/import/__tests__/diagnose.test.ts).
//
// PRIVACY: the report holds booleans, names and counts only. It never
// holds a secret value, an amount, a file name or bank digits. Every
// string that comes from outside (an API error message) is cut short,
// bank-digit scrubbed and secret-redacted; assembleDiagnoseReport() runs
// the redaction once more over the whole report as a last guard.
//
// This module does not change how imports read anything. It has no
// imports (same convention as chunking.ts/jobEngine.ts) so Jest loads it
// directly; index.ts passes in the plan limits and the bank-digit scrubber
// (bankDigits.ts scrubBankDigitsInText).
export type Scrub = (text: string) => string;

// The server build shown in Diagnostics. Since 2026-11-03 it is the git
// commit written into buildStamp.ts by scripts/deploy-ai-import.ps1 at
// deploy time (index.ts passes it to assembleDiagnoseReport); this name is
// only the fallback.
export const AI_IMPORT_BUILD_ID = 'ai-import not-stamped';

// "ai-import e86e0ca (2026-11-03T14:05:00Z)" from the stamp file's values.
export function stampedBuildId(gitHash: string, deployedAt: string): string {
  const hash = /^[0-9a-f]{7,40}(\+dirty)?$/.test(gitHash) ? gitHash : 'not-stamped';
  return deployedAt ? `ai-import ${hash} (${deployedAt})` : `ai-import ${hash}`;
}

// ---------------------------------------------------------------------
// Schema the code needs (PENDING_SQL §77-§83 plus the core job/usage
// columns). Checked with a zero-row select per table: a missing column
// makes that select fail, and then each column is probed alone so the
// report names exactly which ones are missing.
// ---------------------------------------------------------------------
export const REQUIRED_COLUMNS: { table: string; columns: string[] }[] = [
  {
    table: 'import_jobs',
    columns: [
      'id', 'user_id', 'status', 'result_json', 'error_step', 'error_message', 'document_id',
      'created_at', 'updated_at', 'completed_at',
      // §78
      'page_plan', 'page_results', 'progress', 'heartbeat_at', 'lease_owner', 'lease_until', 'error_page', 'invocation_count',
    ],
  },
  { table: 'ai_usage_log', columns: ['user_id', 'call_type', 'success', 'failure_reason'] },
  {
    table: 'settlements',
    columns: [
      'statement', // §77
      // §82
      'loaded_miles', 'empty_miles', 'miles_split_source', 'miles_split_label', 'miles_split_flag',
      'review_acknowledged', 'certified_at', 'certification_text_version', 'certification_app_version',
    ],
  },
  { table: 'trucks', columns: ['nickname', 'plate', 'purchase_tax_treatment', 'purchase_document_id'] }, // §79, §81
  { table: 'deductions', columns: ['duplicate_kept_at'] }, // §83
  { table: 'fuel_purchases', columns: ['duplicate_kept_at'] },
  { table: 'maintenance_records', columns: ['duplicate_kept_at'] },
  { table: 'tolls', columns: ['duplicate_kept_at'] },
];

// Database functions the code calls (§78, §80). Never executed: each is
// probed with an argument name no function has (DIAGNOSE_PROBE_ARG), so
// PostgREST answers "could not find" (PGRST202) without running anything.
// When the function exists under that name, its hint says "Perhaps you
// meant to call the function public.<name>(...)"; no such hint = missing.
export const REQUIRED_RPCS: string[] = [
  'import_job_claim',
  'import_job_release',
  'import_job_put_page',
  'import_job_saved',
  'consume_ai_import_credit_for',
  'document_linked_rows',
  'preview_document_delete',
  'delete_document_cascade',
];
export const DIAGNOSE_PROBE_ARG = { diagnose_probe_never_a_real_arg: true };

// DATABASE CHECK BY pg_proc (owner decision 2026-11-03): the probe above
// reported all 8 functions "missing" although they exist (PostgREST gives
// no "Perhaps you meant" hint for them). The check now asks the catalog
// itself: public.diagnose_missing_functions(p_names text[]) (PENDING_SQL
// §85) returns the names with no row in pg_proc for schema public. Until
// §85 runs, that call errors and the old probe is used (labeled "probe").
export const PG_PROC_RPC = 'diagnose_missing_functions';
export type FunctionsCheckedBy = 'pg_proc' | 'probe';

// The pg_proc answer, or null when it cannot be used (fall back to the
// probe). Only names that were asked for are kept.
export function missingFromPgProc(data: unknown, error: unknown, asked: string[] = REQUIRED_RPCS): string[] | null {
  if (error || !Array.isArray(data)) return null;
  const set = new Set(asked);
  return data.filter((n): n is string => typeof n === 'string' && set.has(n)).sort();
}

export function rpcProbePresent(
  name: string,
  err: { code?: string | null; message?: string | null; hint?: string | null; details?: string | null } | null,
): boolean {
  // No error would mean it ran; with an argument no function has, that
  // cannot happen, but it would still prove the function exists.
  if (!err) return true;
  const text = `${err.hint ?? ''} ${err.message ?? ''} ${err.details ?? ''}`;
  if (err.code === 'PGRST202' || /could not find the function/i.test(text)) {
    const lower = text.toLowerCase();
    const n = name.toLowerCase();
    return lower.includes(`perhaps you meant to call the function public.${n}(`) || lower.includes(`perhaps you meant to call the function ${n}(`);
  }
  // Any other answer (permission denied, wrong argument type) comes from
  // a function that exists.
  return true;
}

export function columnErrorMeansMissing(err: { code?: string | null; message?: string | null } | null): boolean {
  if (!err) return false;
  if (err.code === '42703' || err.code === 'PGRST204' || err.code === '42P01' || err.code === 'PGRST205') return true;
  return /does not exist|could not find/i.test(err.message ?? '');
}

// ---------------------------------------------------------------------
// Plan and budget.
// ---------------------------------------------------------------------
export type PlanInfo = { plan: 'free' | 'pro'; exitBySeconds: number; wallClockSeconds: number };

export function planInfo(tier: 'free' | 'paid', limits: { exitByMs: number; wallClockMs: number }): PlanInfo {
  return {
    plan: tier === 'paid' ? 'pro' : 'free',
    exitBySeconds: Math.round(limits.exitByMs / 1000),
    wallClockSeconds: Math.round(limits.wallClockMs / 1000),
  };
}

// ---------------------------------------------------------------------
// Live model check: one tiny call per model, in the request shape the
// import will use (structured output via output_config.format, adaptive
// thinking, an output_config.effort value). Forced tool_choice and
// temperature are not sent (both 400 on these models).
// ---------------------------------------------------------------------
export const DIAGNOSE_MODELS = ['claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;
export type DiagnoseModel = (typeof DIAGNOSE_MODELS)[number];

// The effort each model will run at in the import (plan step B).
export const MODEL_CHECK_EFFORT: Record<DiagnoseModel, 'low' | 'medium'> = {
  'claude-opus-5-5': 'medium',
  'claude-fable-5-1': 'medium',
  'claude-sonnet-5-5': 'low',
  'claude-haiku-5-5': 'low',
};

// max_tokens covers thinking plus the reply; generous so a tiny check
// never ends at max_tokens because of thinking.
export const MODEL_CHECK_MAX_TOKENS = 4000;
export const MODEL_CHECK_TIMEOUT_MS = 45_000;
export const ANTHROPIC_VERSION = '2023-06-01';

export const MODEL_CHECK_SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, word: { type: 'string' } },
  required: ['ok', 'word'],
  additionalProperties: false,
} as const;

export function buildModelCheckBody(model: DiagnoseModel): Record<string, unknown> {
  return {
    model,
    max_tokens: MODEL_CHECK_MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: MODEL_CHECK_EFFORT[model],
      format: { type: 'json_schema', schema: MODEL_CHECK_SCHEMA },
    },
    messages: [{ role: 'user', content: 'System check. Answer with ok set to true and word set to "ready".' }],
  };
}

// USD per million tokens (input, output), from the published price list.
export const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const p = PRICE_PER_MTOK[model];
  if (!p) return null;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export type ModelCheckResult = {
  model: string;
  ok: boolean;
  httpStatus: number | null;
  // 'ok' | an API error type ('not_found_error', 'invalid_request_error',
  // ...) | 'refusal' | 'max_tokens' | 'bad_output' | 'timeout' | 'network'
  outcome: string;
  // The API's own error message, short and scrubbed (never a secret).
  detail: string | null;
  stopReason: string | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
};

const DETAIL_MAX = 240;

export function cleanDetail(text: unknown, secrets: string[], scrub: Scrub): string | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  return redactSecrets(scrub(text), secrets).slice(0, DETAIL_MAX);
}

export function interpretModelResponse(
  model: string,
  httpStatus: number,
  json: unknown,
  latencyMs: number,
  secrets: string[],
  scrub: Scrub,
): ModelCheckResult {
  const body = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const usage = (body.usage && typeof body.usage === 'object' ? body.usage : {}) as Record<string, unknown>;
  const inputTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : null;
  const outputTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : null;
  const costUsd = inputTokens !== null && outputTokens !== null ? estimateCostUsd(model, inputTokens, outputTokens) : null;
  const base = { model, httpStatus, latencyMs, inputTokens, outputTokens, costUsd };

  if (httpStatus < 200 || httpStatus >= 300) {
    const err = (body.error && typeof body.error === 'object' ? body.error : {}) as Record<string, unknown>;
    return {
      ...base,
      ok: false,
      outcome: typeof err.type === 'string' ? err.type : `http_${httpStatus}`,
      detail: cleanDetail(err.message, secrets, scrub),
      stopReason: null,
    };
  }
  const stopReason = typeof body.stop_reason === 'string' ? body.stop_reason : null;
  if (stopReason === 'refusal' || stopReason === 'max_tokens') {
    return { ...base, ok: false, outcome: stopReason, detail: null, stopReason };
  }
  const content = Array.isArray(body.content) ? body.content : [];
  const text = content
    .filter((b): b is { type: string; text: string } => !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text')
    .map((b) => b.text)
    .join('');
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const good = !!parsed && typeof parsed === 'object' && (parsed as { ok?: unknown }).ok === true;
  return { ...base, ok: good, outcome: good ? 'ok' : 'bad_output', detail: null, stopReason };
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  status: number;
  json: () => Promise<unknown>;
}>;

export async function runModelCheck(
  model: DiagnoseModel,
  apiKey: string,
  fetcher: FetchLike,
  scrub: Scrub,
  opts: { timeoutMs?: number; now?: () => number } = {},
): Promise<ModelCheckResult> {
  const now = opts.now ?? (() => Date.now());
  const started = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? MODEL_CHECK_TIMEOUT_MS);
  const secrets = [apiKey];
  try {
    const resp = await fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      body: JSON.stringify(buildModelCheckBody(model)),
      signal: controller.signal,
    });
    let json: unknown = null;
    try {
      json = await resp.json();
    } catch {
      json = null;
    }
    return interpretModelResponse(model, resp.status, json, now() - started, secrets, scrub);
  } catch (e) {
    const aborted = controller.signal.aborted;
    return {
      model,
      ok: false,
      httpStatus: null,
      outcome: aborted ? 'timeout' : 'network',
      detail: aborted ? null : cleanDetail(e instanceof Error ? e.message : String(e), secrets, scrub),
      stopReason: null,
      latencyMs: now() - started,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------
// Import jobs: counts by status for the last 24 h, the last 5 failures
// and the last 5 jobs. Only statuses, page numbers, counts and error
// CODES (error_step, page error types) — never error_message, file names
// or anything read from the document.
// ---------------------------------------------------------------------
export type JobRowForDiagnose = {
  status: string | null;
  created_at: string | null;
  updated_at?: string | null;
  error_step?: string | null;
  error_page?: number | null;
  pages_done?: number | null;
  pages_total?: number | null;
  page_results?: unknown;
  progress?: unknown;
  // Since 2026-11-03: the job id and page_plan.review (verdict).
  id?: string | null;
  review?: unknown;
};

// A page that could not be read: its number, the cause code and its role;
// detail = the exact model outcome (parse_failed, truncated, ...) and the
// tries (since 2026-11-03).
export type PageErrorLine = { page: number; type: string; role: string | null; kind: string | null; detail?: string | null; attempts?: number | null };

// GATE FAILURE DETAIL (owner 2026-11-03): each failing check with both
// values, and — for a field two pages read differently — what every page
// read there, with the printed label it named. Amounts and printed labels
// only (the owner asked for the values); never a file name or message.
export type FailingDetailLine = { check: string; printed: number | string | null; read: number | string | null; pages?: { page: number; value: number | string; label: string | null }[] };

export type JobLine = {
  status: string;
  createdAt: string | null;
  pagesDone: number | null;
  pagesTotal: number | null;
  errorStep: string | null;
  errorPage: number | null;
  // Names of the checks that failed: page error types such as
  // 'parse_failed', 'timeout', 'refused', 'worker_stopped'.
  failedChecks: string[];
  // DIAGNOSTICS JOB DETAIL (owner 2026-11-03), all optional for older
  // reports: first 8 of the job id, where the verdict came from (server =
  // stored on the job; app = decided on the device; none), the final
  // state, the failing statement checks and every page error.
  jobId?: string | null;
  verdictSource?: 'server' | 'app' | 'none';
  finalState?: string | null;
  failingChecks?: string[];
  pageErrors?: PageErrorLine[];
  // The week ending the job's pages read (YYYY-MM-DD), and the details.
  weekEnding?: string | null;
  failingDetails?: FailingDetailLine[];
};

const CODE_RE = /^[a-z0-9_:-]{1,40}$/i;
function codeOrNull(v: unknown): string | null {
  return typeof v === 'string' && CODE_RE.test(v) ? v : null;
}
// A check name or a field path ("settlement.operating.directDeposit").
const PATH_RE = /^[a-z0-9_.:-]{1,80}$/i;
function pathOrNull(v: unknown): string | null {
  return typeof v === 'string' && PATH_RE.test(v) ? v : null;
}
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
function valueOrNull(v: unknown): number | string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^[0-9.,()$ -]{1,20}$/.test(v.trim()) && v.trim()) return v.trim();
  if (typeof v === 'string' && ISO_DAY.test(v)) return v;
  return null;
}
function printedLabel(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const l = v.toUpperCase().replace(/[^A-Z0-9/&]+/g, ' ').trim().slice(0, 40);
  return l || null;
}
function at(obj: unknown, path: string): unknown {
  let v: unknown = obj;
  for (const p of path.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[p] : undefined;
  return v;
}
// What each page read into a field, with its printed label (operating
// fields carry <field>Label, header totals settlement.totalLabels.<field>).
function pageReadsOf(results: Record<string, unknown>, path: string): NonNullable<FailingDetailLine['pages']> {
  if (!path.startsWith('settlement.')) return [];
  const field = path.split('.').pop()!;
  const parent = path.slice(0, path.length - field.length - 1);
  const out: NonNullable<FailingDetailLine['pages']> = [];
  for (const [key, r] of Object.entries(results)) {
    const extraction = (r as { extraction?: unknown } | null)?.extraction;
    const value = valueOrNull(at(extraction, path));
    if (value == null || value === 0 || value === '') continue;
    const label = printedLabel(at(extraction, `${parent}.${field}Label`)) ?? printedLabel(at(extraction, `settlement.totalLabels.${field}`));
    const page = Number(key);
    if (Number.isInteger(page)) out.push({ page, value, label });
  }
  return out.sort((a, b) => a.page - b.page);
}
function weekEndingOf(results: Record<string, unknown>): string | null {
  for (const key of Object.keys(results).sort((a, b) => Number(a) - Number(b))) {
    const extraction = (results[key] as { extraction?: unknown } | null)?.extraction;
    for (const path of ['settlement.weekEnding', 'settlement.operating.weekEnding']) {
      const v = at(extraction, path);
      if (typeof v === 'string' && ISO_DAY.test(v)) return v;
    }
  }
  return null;
}

export function jobLine(row: JobRowForDiagnose): JobLine {
  const failed = new Set<string>();
  const pageErrors = new Map<number, PageErrorLine>();
  const results = row.page_results && typeof row.page_results === 'object' ? (row.page_results as Record<string, unknown>) : {};
  let done = 0;
  let total = 0;
  for (const [key, r] of Object.entries(results)) {
    if (!r || typeof r !== 'object') continue;
    total++;
    const pr = r as { status?: unknown; error?: { type?: unknown; detail?: unknown }; role?: unknown; kind?: unknown; attempts?: unknown };
    if (pr.status === 'done') done++;
    if (pr.status === 'failed') {
      const code = codeOrNull(pr.error?.type);
      if (code) failed.add(code);
      const page = Number(key);
      if (Number.isInteger(page) && page >= 1) {
        pageErrors.set(page, {
          page,
          type: code ?? 'unknown_cause',
          role: codeOrNull(pr.role),
          kind: codeOrNull(pr.kind),
          detail: codeOrNull(pr.error?.detail),
          attempts: typeof pr.attempts === 'number' ? pr.attempts : null,
        });
      }
    }
  }
  const progress = row.progress && typeof row.progress === 'object' ? (row.progress as Record<string, unknown>) : {};
  if (Array.isArray(progress.failed)) {
    for (const f of progress.failed) {
      const pf = (f ?? {}) as { type?: unknown; page?: unknown; kind?: unknown };
      const code = codeOrNull(pf.type);
      if (code) failed.add(code);
      const page = Number(pf.page);
      if (Number.isInteger(page) && page >= 1 && !pageErrors.has(page)) pageErrors.set(page, { page, type: code ?? 'unknown_cause', role: null, kind: codeOrNull(pf.kind) });
    }
  }
  const review = row.review && typeof row.review === 'object' ? (row.review as { final?: { state?: unknown; failures?: unknown; details?: unknown } | null }) : null;
  const final = review?.final && typeof review.final === 'object' ? review.final : null;
  const checks = new Set<string>();
  const failingDetails: FailingDetailLine[] = [];
  if (final && Array.isArray(final.details)) {
    for (const d of final.details) {
      const dd = (d ?? {}) as { check?: unknown; printed?: unknown; read?: unknown };
      const c = pathOrNull(dd.check);
      if (!c) continue;
      if (codeOrNull(c)) checks.add(c);
      const pages = pageReadsOf(results, c);
      failingDetails.push({ check: c, printed: valueOrNull(dd.printed), read: valueOrNull(dd.read) ?? codeOrNull(dd.read), ...(pages.length > 0 ? { pages } : {}) });
    }
  }
  if (final && Array.isArray(final.failures)) for (const f of final.failures) { const c = codeOrNull(f); if (c) checks.add(c); }
  const pDone = typeof row.pages_done === 'number' ? row.pages_done : null;
  const pTotal = typeof row.pages_total === 'number' ? row.pages_total : null;
  return {
    status: codeOrNull(row.status) ?? 'unknown',
    createdAt: typeof row.created_at === 'string' ? row.created_at : null,
    pagesDone: pDone ?? (total > 0 ? done : null),
    pagesTotal: pTotal ?? (total > 0 ? total : null),
    errorStep: codeOrNull(row.error_step),
    errorPage: typeof row.error_page === 'number' ? row.error_page : null,
    failedChecks: [...failed].sort(),
    jobId: typeof row.id === 'string' ? row.id.slice(0, 8) : null,
    verdictSource: final ? 'server' : 'none',
    finalState: final ? codeOrNull(final.state) : null,
    failingChecks: [...checks].sort(),
    pageErrors: [...pageErrors.values()].sort((a, b) => a.page - b.page),
    weekEnding: weekEndingOf(results),
    failingDetails,
  };
}

export type JobSummary = {
  last24hByStatus: Record<string, number>;
  lastErrors: JobLine[];
  lastJobs: JobLine[];
};

export function summarizeJobs(rows: JobRowForDiagnose[], nowMs: number): JobSummary {
  const sorted = [...rows].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
  const dayAgo = nowMs - 24 * 60 * 60 * 1000;
  const counts: Record<string, number> = {};
  for (const r of sorted) {
    const t = r.created_at ? new Date(r.created_at).getTime() : NaN;
    if (!Number.isFinite(t) || t < dayAgo) continue;
    const s = codeOrNull(r.status) ?? 'unknown';
    counts[s] = (counts[s] ?? 0) + 1;
  }
  const lines = sorted.map(jobLine);
  const lastErrors = lines
    .filter((l) => l.status === 'failed' || l.errorStep !== null || l.failedChecks.length > 0 || l.finalState === 'failed_final')
    .slice(0, 5);
  return { last24hByStatus: counts, lastErrors, lastJobs: lines.slice(0, 5) };
}

// ---------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------
export type DiagnoseReport = {
  serverBuildId: string;
  deploymentId: string | null;
  plan: PlanInfo;
  anthropicKeyPresent: boolean;
  storageReachable: boolean;
  schema: { ok: boolean; missingColumns: string[]; missingFunctions: string[]; functionsCheckedBy?: FunctionsCheckedBy };
  jobs: JobSummary;
  models: ModelCheckResult[];
  checkedAt: string;
};

export function redactSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.split(s).join('[secret]');
  }
  // Anything shaped like an Anthropic key or a JWT, even if not in the list.
  out = out.replace(/sk-ant-[A-Za-z0-9_-]+/g, '[secret]');
  out = out.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[secret]');
  return out;
}

function deepRedact<T>(value: T, secrets: string[], scrub: Scrub): T {
  if (typeof value === 'string') return redactSecrets(scrub(value), secrets) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => deepRedact(v, secrets, scrub)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = deepRedact(v, secrets, scrub);
    return out as T;
  }
  return value;
}

export function assembleDiagnoseReport(
  parts: Omit<DiagnoseReport, 'serverBuildId'>,
  secrets: string[],
  scrub: Scrub,
  buildId: string = AI_IMPORT_BUILD_ID
): DiagnoseReport {
  return deepRedact({ serverBuildId: buildId, ...parts }, secrets, scrub);
}
