import { BRAND_NAME } from '@/src/brand';
import { estimateNoticeStrings, estimateNoticeTextFooter, estimateNoticeTextHeader } from '@/src/legal/estimateNotice';
import type { KpiResult } from '@/src/stats/kpi';
import { ledgerTotals } from '@/src/stats/auditLedger';
import { CERTIFICATION_TEXT } from '@/src/import/weekReview';
import { settlementDeposit, type SettlementStatement } from '@/src/import/settlementStatement';

// "SHARE AUDIT" (owner decision 2026-10-13, Part 2 A3): plain text for the
// native share sheet — carrier name, printed totals, every ledger row — so
// the owner can collect real statements from other carriers. Pure: the
// caller passes its own translator and money formatter.
type T = (key: string, options?: Record<string, unknown>) => string;

export type AuditSettlement = {
  id: string;
  week_ending: string | null;
  carrier?: string | null;
  gross: number | null;
  net: number | null;
  statement?: SettlementStatement | null;
  // Batch C item 5 (§82).
  certified_at?: string | null;
};

export function buildAuditText(args: {
  kpi: KpiResult;
  settlements: AuditSettlement[];
  t: T;
  money: (n: number) => string;
  dateTime?: (iso: string) => string;
}): string {
  const { kpi, settlements, t, money } = args;
  // Batch D item 10: the estimate notice opens and closes every share text.
  const notice = estimateNoticeStrings(t, BRAND_NAME);
  const out: string[] = [...estimateNoticeTextHeader(notice), t('audit.share.heading')];

  for (const s of settlements) {
    const p = s.statement?.printed;
    const dep = settlementDeposit(s);
    out.push('');
    out.push(
      t('audit.share.week', {
        date: s.week_ending ?? '—',
        carrier: s.carrier || t('audit.share.unknownCarrier'),
        // Batch D2 2.3: the only week status is certified / not certified.
        label: t(s.certified_at ? 'certify.certified' : 'certify.notCertified'),
      })
    );
    const fmt = (n: number | null | undefined) => (n == null ? t('audit.share.notPrinted') : money(n));
    out.push(
      t('audit.share.printed', {
        gross: fmt(p?.grossRevenue ?? null),
        reimbursements: fmt(p?.reimbursements ?? null),
        deductions: fmt(p?.totalDeductions ?? null),
        netDue: fmt(p?.netDue ?? null),
      })
    );
    out.push(
      dep.owedToCarrier > 0
        ? t('audit.share.owed', { amount: money(dep.owedToCarrier) })
        : t(dep.source === 'net_due' ? 'audit.share.netDueOnly' : 'audit.share.deposited', { amount: money(dep.deposited) })
    );
    if (s.certified_at) {
      out.push(t('weekReview.certifiedOn', { date: args.dateTime ? args.dateTime(s.certified_at) : s.certified_at }));
      out.push(CERTIFICATION_TEXT);
    }
  }

  out.push('');
  out.push(t('audit.share.rowsTitle'));
  for (const r of kpi.ledger) {
    out.push(
      `${t(`audit.status.${r.status}`)} · ${r.date ?? ''} · ${r.category ?? ''} · ${r.label} · ${money(r.amount)} · ${t(`audit.reason.${r.reason}`)}`
    );
  }
  const totals = ledgerTotals(kpi.ledger);
  out.push('');
  out.push(
    t('audit.share.totals', {
      counted: money(totals.counted),
      offset: money(totals.offset),
      expenses: money(totals.expenses),
      excluded: money(totals.excluded),
    })
  );
  out.push(t('audit.share.profit', { gross: money(kpi.gross), expenses: money(kpi.expenses.total), profit: money(kpi.net) }));
  out.push(...estimateNoticeTextFooter(notice));
  return out.join('\n');
}
