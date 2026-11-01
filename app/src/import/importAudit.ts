import { BRAND_NAME } from '@/src/brand';
import { estimateNoticeStrings, estimateNoticeTextFooter, estimateNoticeTextHeader } from '@/src/legal/estimateNotice';
import type { Extraction } from './types';
import { parseAmount } from './amount';
import { scrubBankDigits, scrubBankDigitsInText } from './bankDigits';
import type { ReviewInputs } from './reviewVerdict';
import { lineDetailsDifference } from './reviewVerdict';

// SHARE AUDIT ON THE IMPORT PREVIEW (owner decision 2026-10-17, item 5):
// every line the AI read WITH its amount, every check result and every
// per-group difference, so a real import can be diagnosed from what the
// AI actually returned. The owner's own data, shared only by the owner's
// own tap; bank digits are removed (routing/account numbers never leave).

type T = (key: string, options?: Record<string, unknown>) => string;

const n = (v: unknown) => {
  const x = parseAmount(v);
  return Number.isFinite(x) ? x.toFixed(2) : '—';
};
const txt = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');
const join = (...parts: unknown[]) => parts.map(txt).filter(Boolean).join(' ');

export function buildImportAuditText(extraction: Extraction, inputs: ReviewInputs, t: T): string {
  const e = scrubBankDigits(extraction);
  const s = e.settlement ?? {};
  const out: string[] = [];
  const section = (key: string, count?: number) => {
    out.push('');
    out.push(`== ${t(`importAudit.${key}`)}${count != null ? ` (${count})` : ''}`);
  };

  // Batch D item 10: the estimate notice opens and closes every share text.
  const notice = estimateNoticeStrings(t, BRAND_NAME);
  out.push(...estimateNoticeTextHeader(notice));
  out.push(t('importAudit.title'));
  out.push(
    `${t('importAudit.week')}: ${txt(s.weekEnding) || '—'} · ${txt(s.carrier) || '—'} · ${t('importAudit.unit')} ${txt(s.unit) || '—'}`
  );

  section('totals');
  out.push(`grossRevenue ${n(s.grossRevenue)} · reimbursements ${n(s.reimbursements)} · totalDeductions ${n(s.totalDeductions)}`);
  out.push(`netPay ${n(s.netPay)} · depositAmount ${n(s.depositAmount)} · totalMiles ${txt(String(s.totalMiles ?? '')) || '—'}`);
  if (s.totalLabels) out.push(`totalLabels ${JSON.stringify(s.totalLabels)}`);

  section('revenue', s.revenueItems?.length ?? 0);
  for (const r of s.revenueItems ?? []) out.push(`${join(r.order, r.desc) || '—'}  ${n(r.amount)}`);
  section('reimbursements', s.reimbursementItems?.length ?? 0);
  for (const r of s.reimbursementItems ?? []) out.push(`${join(r.code, r.desc, r.ref) || '—'}  ${n(r.amount)}`);
  section('deductions', s.deductions?.length ?? 0);
  for (const d of s.deductions ?? []) out.push(`${join(d.code, d.desc) || '—'}  ${n(d.amount)}`);
  const fuel = [...(s.tractorFuel ?? []).map((f) => ({ ...f, type: 'tractor' })), ...(s.reeferFuel ?? []).map((f) => ({ ...f, type: 'reefer' }))];
  section('fuel', fuel.length);
  for (const f of fuel) out.push(`${f.type} ${txt(f.date) || '—'}  ${n(f.amount)}  (discount ${n(f.discount)})`);
  section('loads', s.loads?.length ?? 0);
  for (const l of s.loads ?? []) out.push(`${txt(l.order) || '—'}  loaded ${l.loadedMiles ?? 0} · empty ${l.emptyMiles ?? 0}  ${n(l.revenue)}`);

  const op = s.operating;
  if (op && (op.lines?.length ?? 0) > 0) {
    section('statement', op.lines!.length);
    for (const l of op.lines ?? []) out.push(`${txt(l.section)} · ${txt(l.label)}  ${n(l.amount)}`);
    out.push(
      `TOTAL REVENUE ${n(op.weekTotalRevenue)} · TOTAL OPERATING EXPENSES ${n(op.weekTotalOperatingExpenses)} · TOTAL STATEMENT ${n(op.weekTotalStatement)}`
    );
    out.push(
      `PRIOR WEEK BALANCE FORWARD ${n(op.priorWeekBalanceForward)} · TOTAL CASH FLOW ${n(op.weekTotalCashFlow)} · SETTLEMENT TO OPERATOR ${n(op.settlementToOperator)} · DIRECT DEPOSIT ${n(op.directDeposit)}`
    );
    out.push(`weekEnding ${txt(op.weekEnding) || '—'} · MILES ${op.weekMiles ?? '—'}`);
  }

  const check = inputs.check;
  if (check) {
    section('checks', check.checks.length);
    out.push(`gate ${check.gatePassed ? '✓' : '✗'}${(check.gateMissing?.length ?? 0) > 0 ? ` · not read: ${check.gateMissing!.join(', ')}` : ''}`);
    for (const c of check.checks) {
      out.push(`${c.passed ? '✓' : '✗'} ${t(`importScreen.primeCheck.${c.id}`)}: ${c.expectedText ?? c.expected.toFixed(2)} / ${c.actualText ?? c.actual.toFixed(2)}`);
    }
  }
  section('lineChecks', inputs.issues.length);
  for (const issue of inputs.issues) out.push(`✗ ${issue.type} ${JSON.stringify({ ...issue, type: undefined })}`);
  if (inputs.groups) {
    section('groups', inputs.groups.length);
    for (const g of inputs.groups) {
      out.push(
        `${g.passed ? '✓' : '✗'} ${t(`importScreen.group.${g.group}`)}: ${g.settlement.toFixed(2)} / ${g.statement.toFixed(2)} (${g.difference.toFixed(2)})`
      );
    }
  }
  const difference = lineDetailsDifference(inputs);
  if (difference != null) out.push(t('importAudit.lineDifference', { amount: Math.abs(difference).toFixed(2) }));

  if ((e.pageMap?.length ?? 0) > 0) {
    section('pages', e.pageMap!.length);
    for (const p of e.pageMap ?? []) out.push(`p${p.page} ${p.kind} ${p.role} ${p.status}${p.cause ? ` (${p.cause})` : ''}`);
  }
  if (txt(e.summary)) {
    section('aiNote');
    out.push(txt(e.summary));
  }
  out.push(...estimateNoticeTextFooter(notice));
  return scrubBankDigitsInText(out.join('\n'));
}
