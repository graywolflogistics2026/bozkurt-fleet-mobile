// SYSTEM CHECK + SEND REPORT (statement reading plan step A, owner
// 2026-10-31, docs/decisions/statement-reading-2026-10.md). Pure: builds
// the Settings > Diagnostics lines and the plain-text report the "Share
// report" button sends. Green or red per line.
//
// PRIVACY: the report holds versions, booleans, names, counts, page
// numbers and error CODES only — never an amount, a file name, an error
// message from a job, a secret or bank digits. The server's own report
// (ai-import mode "diagnose", supabase/functions/ai-import/diagnose.ts) is
// already built that way; this module only reads the same fields, and
// runs the bank-digit scrubber over the finished text as a last guard.
import type { DiagnoseReport, JobLine, ModelCheckResult } from '../../../supabase/functions/ai-import/diagnose';
import { scrubBankDigitsInText } from '@/src/import/bankDigits';
import { isEmbeddedBuild, NULL_NAMES, stamp, type BuildInfo } from '@/src/lib/buildInfoFormat';
import { finalStateOf, type ImportJob } from '@/src/import/importJobs';

export type { DiagnoseReport, JobLine, ModelCheckResult };

// ok: true = green, false = red, null = information only.
export type ReportLine = { ok: boolean | null; label: string; value: string };
export type ReportSection = { title: string; lines: ReportLine[] };

export type Translate = (key: string, opts?: Record<string, unknown>) => string;

export type ClientInfo = BuildInfo & { scannerPresent: boolean; platform: string };

const CODE_RE = /^[a-z0-9_:-]{1,40}$/i;
function code(v: unknown): string | null {
  return typeof v === 'string' && CODE_RE.test(v) ? v : null;
}

export function clientSection(info: ClientInfo, t: Translate): ReportSection {
  return {
    title: t('diagnostics.appTitle'),
    lines: [
      // UPDATE VISIBILITY FIX (owner 2026-11-03): a null value prints the
      // API that returned it, never "unknown"; "embedded build" only when
      // isEmbeddedLaunch AND no update id (buildInfoFormat.ts).
      {
        ok: info.version !== NULL_NAMES.version,
        label: t('diagnostics.appVersion'),
        value: info.buildVersion ? `${info.version} (build ${info.buildVersion})` : info.version,
      },
      { ok: !!info.runtimeVersion, label: t('diagnostics.runtime'), value: info.runtimeVersion ?? NULL_NAMES.runtimeVersion },
      {
        ok: !!info.updateIdShort,
        label: t('diagnostics.update'),
        value: info.updateIdShort
          ? [info.updateIdShort, stamp(info.updateCreatedAt)].filter(Boolean).join(' · ')
          : isEmbeddedBuild(info)
            ? t('diagnostics.embeddedBuild')
            : NULL_NAMES.updateId,
      },
      { ok: !!info.channel, label: t('diagnostics.channel'), value: info.channel ?? NULL_NAMES.channel },
      { ok: info.scannerPresent, label: t('diagnostics.scanner'), value: info.scannerPresent ? t('diagnostics.yes') : t('diagnostics.no') },
      { ok: null, label: t('diagnostics.buildStamp'), value: info.gitCommitHashShort ?? NULL_NAMES.gitCommitHash },
      { ok: null, label: t('diagnostics.platform'), value: info.platform },
      ...(info.errors && info.errors.length > 0 ? [{ ok: false, label: t('diagnostics.apiErrors'), value: info.errors.join(', ') }] : []),
    ],
  };
}

function modelLine(m: ModelCheckResult, t: Translate): ReportLine {
  const parts: string[] = [];
  parts.push(m.ok ? t('diagnostics.ok') : m.outcome + (m.httpStatus ? ` (${m.httpStatus})` : ''));
  parts.push(`${Math.round(m.latencyMs / 100) / 10} s`);
  if (m.inputTokens !== null && m.outputTokens !== null) {
    parts.push(t('diagnostics.tokens', { input: m.inputTokens, output: m.outputTokens }));
  }
  if (!m.ok && m.detail) parts.push(m.detail);
  return { ok: m.ok, label: m.model, value: parts.join(' · ') };
}

export function jobLineText(j: JobLine, t: Translate): string {
  const parts: string[] = [j.status];
  if (j.pagesTotal !== null || j.pagesDone !== null) {
    parts.push(t('diagnostics.pagesDone', { done: j.pagesDone ?? 0, total: j.pagesTotal ?? '?' }));
  }
  if (j.errorStep) parts.push(j.errorPage !== null ? `${j.errorStep} @ p${j.errorPage}` : j.errorStep);
  // DIAGNOSTICS JOB DETAIL (owner 2026-11-03): where the verdict came from,
  // the final state, the failing checks and each page error with its page.
  if (j.verdictSource !== undefined && (j.status === 'ready' || j.finalState)) {
    parts.push(j.finalState ? `verdict ${j.verdictSource} ${j.finalState}` : `verdict ${j.verdictSource}`);
  }
  if (j.failingChecks && j.failingChecks.length > 0) parts.push(`checks ${j.failingChecks.join(', ')}`);
  if (j.pageErrors && j.pageErrors.length > 0) {
    parts.push(j.pageErrors.map((e) => `p${e.page} ${e.type}${e.role ? ` (${e.role})` : ''}`).join(', '));
  } else if (j.failedChecks.length > 0) {
    parts.push(j.failedChecks.join(', '));
  }
  return parts.join(' · ');
}

function jobIsBad(j: JobLine): boolean {
  return j.status === 'failed' || j.errorStep !== null || j.failedChecks.length > 0 || j.finalState === 'failed_final' || (j.pageErrors?.length ?? 0) > 0;
}

function dayLabel(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace('T', ' ') : '—';
}

export function serverSections(r: DiagnoseReport, t: Translate): ReportSection[] {
  const server: ReportSection = {
    title: t('diagnostics.serverTitle'),
    lines: [
      { ok: true, label: t('diagnostics.serverBuild'), value: r.serverBuildId + (r.deploymentId ? ` (${r.deploymentId.slice(0, 12)})` : '') },
      {
        ok: null,
        label: t('diagnostics.plan'),
        value: t('diagnostics.planValue', { plan: r.plan.plan, exitBy: r.plan.exitBySeconds, wallClock: r.plan.wallClockSeconds }),
      },
      { ok: r.anthropicKeyPresent, label: t('diagnostics.aiKey'), value: r.anthropicKeyPresent ? t('diagnostics.yes') : t('diagnostics.no') },
      { ok: r.storageReachable, label: t('diagnostics.storage'), value: r.storageReachable ? t('diagnostics.ok') : t('diagnostics.notReachable') },
      {
        ok: r.schema.ok,
        label: t('diagnostics.database'),
        value:
          (r.schema.ok
            ? t('diagnostics.ok')
            : t('diagnostics.missing', { names: [...r.schema.missingColumns, ...r.schema.missingFunctions].join(', ') })) +
          // Which way the functions were checked (pg_proc since §85).
          (r.schema.functionsCheckedBy ? ` (${r.schema.functionsCheckedBy})` : ''),
      },
    ],
  };
  const models: ReportSection = {
    title: t('diagnostics.modelsTitle'),
    lines: r.models.length > 0 ? r.models.map((m) => modelLine(m, t)) : [{ ok: false, label: t('diagnostics.aiKey'), value: t('diagnostics.no') }],
  };
  const counts = Object.entries(r.jobs.last24hByStatus)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([s, n]) => `${s} ${n}`)
    .join(', ');
  const jobs: ReportSection = {
    title: t('diagnostics.jobsTitle'),
    lines: [
      { ok: null, label: t('diagnostics.last24h'), value: counts || '0' },
      ...r.jobs.lastErrors.map((j) => ({ ok: false, label: `${t('diagnostics.error')} ${dayLabel(j.createdAt)}`, value: jobLineText(j, t) })),
    ],
  };
  return [server, models, jobs];
}

// The last 5 import jobs. From the server report when the check ran (it
// has page error types); otherwise from the app's own job list.
export function clientJobToLine(job: ImportJob): JobLine {
  const failed = new Set<string>();
  const pageErrors: NonNullable<JobLine['pageErrors']> = [];
  for (const f of job.progress?.failed ?? []) {
    const c = code(f?.type);
    if (c) failed.add(c);
    if (Number.isInteger(f?.page)) pageErrors.push({ page: f.page, type: c ?? 'unknown_cause', role: null, kind: code(f.kind) });
  }
  const serverFinal = job.review?.final?.state ?? null;
  const final = finalStateOf(job);
  const checks = new Set<string>();
  for (const d of job.review?.final?.details ?? []) if (code(d.check)) checks.add(d.check);
  for (const f of job.review?.final?.failures ?? []) if (code(f)) checks.add(f);
  return {
    status: code(job.status) ?? 'unknown',
    createdAt: job.createdAt ?? null,
    pagesDone: typeof job.pagesDone === 'number' ? job.pagesDone : null,
    pagesTotal: typeof job.pagesTotal === 'number' ? job.pagesTotal : null,
    errorStep: code(job.errorStep),
    errorPage: typeof job.errorPage === 'number' ? job.errorPage : null,
    failedChecks: [...failed].sort(),
    jobId: job.id ? job.id.slice(0, 8) : null,
    verdictSource: serverFinal ? 'server' : final && job.review !== undefined ? 'app' : 'none',
    finalState: final,
    failingChecks: [...checks].sort(),
    pageErrors: pageErrors.sort((a, b) => a.page - b.page),
  };
}

// The server's job lines, with a verdict the app decided on this device
// (an ai-import that could not take it) marked as 'app'.
export function withAppVerdicts(lines: JobLine[], clientJobs: ImportJob[]): JobLine[] {
  return lines.map((l) => {
    if (l.verdictSource !== 'none' || !l.jobId) return l;
    const job = clientJobs.find((j) => j.id.startsWith(l.jobId!));
    const local = job ? clientJobToLine(job) : null;
    return local && local.verdictSource === 'app' ? { ...l, verdictSource: 'app', finalState: local.finalState } : l;
  });
}

export function lastJobsSection(lines: JobLine[], t: Translate): ReportSection {
  return {
    title: t('diagnostics.lastJobsTitle'),
    lines:
      lines.length > 0
        ? lines.slice(0, 5).map((j) => ({ ok: !jobIsBad(j), label: dayLabel(j.createdAt), value: jobLineText(j, t) }))
        : [{ ok: null, label: t('diagnostics.lastJobsTitle'), value: t('diagnostics.none') }],
  };
}

export function buildReportSections(
  client: ClientInfo,
  server: DiagnoseReport | null,
  clientJobs: ImportJob[],
  t: Translate,
): ReportSection[] {
  const sections = [clientSection(client, t)];
  if (server) sections.push(...serverSections(server, t));
  const jobLines = server ? withAppVerdicts(server.jobs.lastJobs, clientJobs) : clientJobs.slice(0, 5).map(clientJobToLine);
  sections.push(lastJobsSection(jobLines, t));
  return sections;
}

export function markerFor(ok: boolean | null): string {
  return ok === true ? '🟢' : ok === false ? '🔴' : '⚪';
}

export function formatReportText(sections: ReportSection[], header: string, checkedAt: string): string {
  const out: string[] = [header, checkedAt, ''];
  for (const s of sections) {
    out.push(s.title);
    for (const l of s.lines) out.push(`${markerFor(l.ok)} ${l.label}: ${l.value}`);
    out.push('');
  }
  return scrubBankDigitsInText(out.join('\n').trimEnd());
}
