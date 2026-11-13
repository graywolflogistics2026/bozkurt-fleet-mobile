// Runs a simulated document through the new reader exactly as the server
// does: range -> one content read -> the one gate -> state. Not a test file.
import { sanitizeExtraction } from '@/src/import/sanitizeExtraction';
import { buildSettlementStatement, settlementDeposit } from '@/src/import/settlementStatement';
import { readPrimeEscrow } from '@/src/import/primeEscrow';
import { statementWeekOf } from '@/src/stats/statementRoute';
import { evaluateSettlementGate } from '@/src/import/settlementGate';
import type { Extraction } from '@/src/import/types';
import { afterContent, afterRange, newReaderProgress, startContentRead, type Transition } from '../../machine';
import { contentRange } from '../../range';
import type { ContentReading, RangeReply } from '../../schema';

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// What the range call says about a Prime file: settlement pages, then the
// statement on the last two content pages, then attachments.
export function primeRangeReply(pages: number, lastContentPage: number, cashFlowPrinted: boolean): RangeReply {
  const shown = Math.min(pages, 10);
  return {
    carrier: 'PRIME INC.',
    isSettlement: true,
    pages: Array.from({ length: shown }, (_, i) => {
      const page = i + 1;
      const kind = page <= lastContentPage - 2 ? 'settlement' : page <= lastContentPage ? 'statement' : 'attachment';
      return { page, kind, hasTotalCashFlow: cashFlowPrinted && page === lastContentPage, hasTotalStatement: page === lastContentPage };
    }),
  };
}

export function readThrough(reading: ContentReading, opts: { pages: number; lastContentPage: number; cashFlowPrinted: boolean; importDate: string }): Transition {
  const range = contentRange(primeRangeReply(opts.pages, opts.lastContentPage, opts.cashFlowPrinted), opts.pages);
  let p = afterRange(newReaderProgress(opts.pages), { ok: true, value: range }).progress;
  p = startContentRead(p)!;
  return afterContent(p, { ok: true, value: reading }, { importDate: opts.importDate });
}

export type WeekFigures = {
  status: string | undefined;
  revenue: number;
  netDue: number | null;
  deposited: number;
  owedToCarrier: number;
  expenses: number;
  profit: number;
  miles: number | null;
  bondHeld: number | null;
  ytdRevenue: number | null;
  ytdPaid: number | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

// The figures the app shows and saves for a reading (card headline,
// statement route, escrow).
export function figuresOf(extraction: Extraction, importDate: string): WeekFigures {
  const sanitized = sanitizeExtraction(extraction);
  const gate = evaluateSettlementGate(sanitized, { importDate });
  const statement = buildSettlementStatement(sanitized, { savedFlagged: false, priorLabelsSeen: new Set() });
  const week = statementWeekOf({ id: 'preview', statement });
  const deposit = settlementDeposit({ statement });
  const op = sanitized.settlement?.operating;
  return {
    status: gate?.status,
    revenue: r2(week?.gross ?? NaN),
    netDue: statement.printed.netDue,
    deposited: r2(deposit.deposited),
    owedToCarrier: r2(deposit.owedToCarrier),
    expenses: r2(week?.expenses ?? NaN),
    profit: r2((week?.gross ?? NaN) - (week?.expenses ?? NaN)),
    miles: gate && gate.status !== 'fail' ? gate.headline.miles : null,
    bondHeld: readPrimeEscrow(sanitized)?.held ?? null,
    ytdRevenue: op?.ytdTotalRevenue ?? null,
    ytdPaid: op?.ytdSettlementToOperator ?? null,
  };
}
