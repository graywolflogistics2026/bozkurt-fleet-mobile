// "OKUYUCU NOTLARI", 18-week workbook (round 2 item K2, owner 2026-11-13):
// 34 cases, each a named test. Cases 1-19 and 34 are the 13-week cases,
// already named tests in readerNotes.test.ts (checked here by text); cases
// 20-33 are new and tested below, through the reader (range -> one read ->
// the one gate) or the copy -> contract step.
import { READER_NOTES } from './fixtures/prime13Weeks';
import { PRIME_18_WEEKS, READER_NOTES_34 } from './fixtures/prime18Weeks';
import { printedFromWeek, WAGES_1106, WAGES_1113 } from './fixtures/printedReading';
import { addDays, figuresOf, readThrough } from './fixtures/runReader';
import { readingToExtraction, signedLineAmount } from '../toExtraction';
import { classifyStatementLine } from '@/src/import/primeStatementLines';
import { PRIME_TEMPLATE } from '@/src/import/primeStatementTemplate';
import { mapSettlement } from '@/src/import/mapExtraction';
import { readPrimeEscrow } from '@/src/import/primeEscrow';
import { buildPrimeGroupChecks } from '@/src/import/primeLineGroups';
import { checkSettlementReconciliation } from '@/src/import/settlementReconciliation';
import { sanitizeExtraction } from '@/src/import/sanitizeExtraction';
import { buildSettlementStatement } from '@/src/import/settlementStatement';
import type { ContentReading, ReadSettlementLine, ReadStatementRow } from '../schema';

const week = (iso: string) => PRIME_18_WEEKS.find((w) => w.weekEnding === iso)!;
const wageOf = (iso: string) => (iso === '2026-11-06' ? WAGES_1106 : iso === '2026-11-13' ? WAGES_1113 : undefined);
const reading = (iso: string, rows?: (r: ReadStatementRow[]) => ReadStatementRow[]) => printedFromWeek(week(iso), { wage: wageOf(iso), statementOverride: rows });
const run = (iso: string, r: ContentReading = reading(iso)) => {
  const w = week(iso);
  const importDate = addDays(iso, 1);
  const t = readThrough(r, { pages: w.pages, lastContentPage: w.lastContentPage, cashFlowPrinted: w.cashFlowPrinted, importDate });
  return { t, f: figuresOf(t.extraction!, importDate), s: t.extraction!.settlement! };
};
const note = (i: number) => `${i + 1}. ${READER_NOTES_34[i].case} (${READER_NOTES_34[i].firstSeen})`;
const line = (section: ReadSettlementLine['section'], code: string, description: string, amount: string, direction: ReadSettlementLine['direction']): ReadSettlementLine => ({
  page: 1,
  section,
  code,
  description,
  reference: '',
  amount,
  direction,
});
const meta = { pagesTotal: 11, contentPages: [1, 2, 3, 4, 5, 6], attachmentPages: [] };

test('the workbook lists 34 cases; the 20 known ones are the 13-week tests, word for word', () => {
  expect(READER_NOTES_34).toHaveLength(34);
  const known = READER_NOTES.map((n) => n.case);
  const kept = READER_NOTES_34.filter((n) => known.includes(n.case)).map((n) => n.case);
  expect(kept).toHaveLength(20);
  // The one 13-week case reworded: the PDF type (now case 20 below).
  expect(known.filter((c) => !kept.includes(c))).toEqual([READER_NOTES[19].case]);
});

describe('Okuyucu notları: the new cases 20-33', () => {
  test(note(19), () => {
    // Image-only scans (weeks 1-12) and text-layer PDFs (13-17) go through
    // the same reader: the file is sent as a document, no text extraction.
    for (const w of PRIME_18_WEEKS.slice(9, 17)) expect([w.weekEnding, run(w.weekEnding).t.progress.state]).toEqual([w.weekEnding, 'ready']);
  });

  test(note(20), () => {
    const { s, f } = run('2026-11-06');
    expect([s.grossRevenue, s.reimbursements, s.totalDeductions, s.totalWageExpense, s.netPay]).toEqual([2534.68, 65.33, 1369.04, 805.5, 425.47]);
    expect(Math.round((2534.68 + 65.33 - 1369.04 - 805.5) * 100) / 100).toBe(425.47);
    expect(s.subtotalPriorWage).toBe(1230.97);
    expect(f).toMatchObject({ status: 'pass', profit: 580.73 });
  });

  test(note(21), () => {
    const { s } = run('2026-11-06');
    expect(s.wageItems!.map((w) => `${w.code} ${w.amount}`)).toEqual(['DF 54.99', 'DU 4.31', 'DU 1.43', 'WC 79.66', 'WD 663.87', '2S 1.24']);
    // Saved as class WAGES by their section, never a code question.
    const rows = mapSettlement({ docType: 'settlement', settlement: s }, 'u', 't').deductions.filter((d) => (d as { economic_class?: string }).economic_class === 'WAGES');
    expect(rows.map((d) => d.code)).toEqual(['DF', 'DU', 'DU', 'WC', 'WD', '2S']);
    expect((s.deductions ?? []).some((d) => ['DF', 'DU', 'WC', 'WD', '2S'].includes(d.code ?? ''))).toBe(false);
  });

  test(note(22), () => {
    for (const [label, section] of [
      ['DRIVER WAGE', 'misc'],
      ['DRIVER FICA WG/DP', 'misc'],
      ['DRIVER UNEMPLOYMENT TAX', 'misc'],
      ['DRIVER WORK COMP.', 'fixed'],
    ] as const) {
      expect(classifyStatementLine({ section, label })).toEqual({ treatment: { kind: 'expense', category: 'Wages & Payroll Taxes (W-2)' }, unknown: false });
    }
    expect(PRIME_TEMPLATE.find((b) => b.section === 'misc')!.labels).toEqual(expect.arrayContaining(['DRIVER WAGE', 'DRIVER FICA WG DP', 'DRIVER UNEMPLOYMENT TAX']));
    expect(PRIME_TEMPLATE.find((b) => b.section === 'fixed')!.labels).toContain('DRIVER WORK COMP');
  });

  test(note(23), () => {
    const { s } = run('2026-11-06');
    expect([s.totalDeductions, s.totalDeductionsFromSettlements]).toEqual([1369.04, 2174.54]);
    expect(checkSettlementReconciliation({ docType: 'settlement', settlement: s }).issues.filter((i) => i.type === 'wageIdentityMismatch')).toEqual([]);
  });

  test(note(24), () => {
    const r = reading('2026-11-06');
    const team = line('revenue', 'RV', '+ TEAM', '1,691.94', 'credit');
    expect(signedLineAmount(team)).toBe(1691.94);
    const e = readingToExtraction({ ...r, settlementLines: [...r.settlementLines, team] }, meta);
    expect(e.settlement!.revenueItems).toEqual([{ code: 'RV', desc: '+ TEAM', order: '', amount: 1691.94 }]);
  });

  test(note(25), () => {
    expect(classifyStatementLine({ section: 'misc', label: 'PAYROLL FEE' })).toEqual({ treatment: { kind: 'expense', category: 'Wages & Payroll Taxes (W-2)' }, unknown: false });
    const r = reading('2026-11-06');
    const e = readingToExtraction(
      { ...r, settlementLines: [...r.settlementLines, line('deduction', 'PF', 'PAYROLL FEE', '10.00', 'charge'), line('reimbursement', 'PC', 'PETTY CASH REIM', '39.50', 'credit')] },
      meta
    );
    expect(e.settlement!.deductions).toEqual([{ code: 'PF', desc: 'PAYROLL FEE', amount: 10 }]);
    expect(e.settlement!.reimbursementItems).toEqual([{ code: 'PC', desc: 'PETTY CASH REIM', ref: '', amount: 39.5 }]);
  });

  test(note(26), () => {
    expect(run('2026-10-30').f).toMatchObject({ status: 'pass', deposited: 0, owedToCarrier: 212.57, profit: -113.8 });
    const { s, f } = run('2026-11-06');
    expect(s.operating!.priorWeekBalanceForward).toBe(-212.57);
    expect(f).toMatchObject({ deposited: 214.04, owedToCarrier: 0 });
  });

  test(note(27), () => {
    const { t, f } = run('2026-11-13');
    const escrow = readPrimeEscrow(sanitizeExtraction(t.extraction!))!;
    expect([escrow.held, t.extraction!.settlement!.operating!.escrowThisWeek, f.bondHeld]).toEqual([1750, 50, 1750]);
    // Not hard-coded: 100 every other week, 50 here, from the printed rows.
    expect(run('2026-11-06').f.bondHeld).toBe(1700);
  });

  test(note(28), () => {
    expect(classifyStatementLine({ section: 'misc', label: 'PRIME POINT-OF-SALE' })).toEqual({ treatment: { kind: 'exclude', reason: 'meals_per_diem' }, unknown: false });
    const { t, f } = run('2026-11-13');
    const statement = buildSettlementStatement(sanitizeExtraction(t.extraction!), { savedFlagged: false, priorLabelsSeen: new Set() });
    expect(JSON.stringify(statement)).toContain('PRIME POINT-OF-SALE');
    expect(f.profit).toBe(4260.65);
    expect(signedLineAmount(line('deduction', 'CU', '** CAFE SLC, UT **', '63.06', 'charge'))).toBe(63.06);
  });

  test(note(29), () => {
    const { s, f } = run('2026-11-13');
    expect(Math.round(s.wageItems!.reduce((a, w) => a + (w.amount ?? 0), 0) * 100) / 100).toBe(1099.06);
    expect([s.totalDeductions, s.totalWageExpense, s.netPay]).toEqual([4418.59, 1099.06, 4147.59]);
    expect(f).toMatchObject({ status: 'pass', profit: 4260.65, deposited: 4148.99 });
  });

  test(note(30), () => {
    const sf = line('reimbursement', 'SF', 'FUEL TAX ADJUSTMENT', '163.68', 'credit');
    expect(signedLineAmount(sf)).toBe(163.68);
    const e = readingToExtraction({ ...reading('2026-10-16'), settlementLines: [line('deduction', 'SF', 'STATE FUEL TAX', '200.00', 'charge'), sf] }, meta);
    expect(e.settlement!.reimbursementItems).toEqual([{ code: 'SF', desc: 'FUEL TAX ADJUSTMENT', ref: '', amount: 163.68 }]);
    // Netted in its group: 200.00 − 163.68.
    const e2 = { ...e, settlement: { ...e.settlement!, operating: { lines: [{ section: 'fuel_oil_tax', label: 'STATE FUEL TAX', amount: -36.32 }] } } };
    expect(buildPrimeGroupChecks(e2)!.find((g) => g.group === 'state_fuel_tax')).toMatchObject({ settlement: 36.32, statement: 36.32, passed: true });
  });

  test(note(31), () => {
    const r = reading('2026-10-16');
    const revenue = [
      line('revenue', 'RV', 'LINEHAUL', '9,543.84', 'credit'),
      line('revenue', 'ET', 'EZ PASS TOLL', '22.49', 'credit'),
      line('revenue', 'HT', 'TOLLS', '30.00', 'credit'),
      line('revenue', 'DT', 'DETENTION', '21.60', 'credit'),
      line('revenue', 'VS', 'SAFETY INC', '13.40', 'credit'),
      line('revenue', 'YS', 'SERVICE INC', '13.40', 'credit'),
    ];
    const e = readingToExtraction({ ...r, settlementLines: revenue }, meta);
    expect(e.settlement!.revenueItems!.map((x) => x.amount)).toEqual([9543.84, 22.49, 30, 21.6, 13.4, 13.4]);
    expect(checkSettlementReconciliation(e).issues.filter((i) => i.type === 'revenueLinesMismatch')).toEqual([]);
  });

  test(note(32), () => {
    const blankWeeks = (rows: ReadStatementRow[]) => {
      const at = rows.findIndex((x) => x.label === 'TOTAL MISCELLANEOUS');
      const extra = ['UNIT REPAIR EXPENSE', 'MISCELLANEOUS', 'PRIME POINT-OF-SALE'].map((label) => ({ page: 5, label, weeks: '', ytd: '1,234.56-', ltd: '1,234.56-' }));
      return [...rows.slice(0, at), ...extra, ...rows.slice(at)];
    };
    const { t, f } = run('2026-10-16', reading('2026-10-16', blankWeeks));
    expect(t.progress.state).toBe('ready');
    expect(t.extraction!.settlement!.operating!.lines!.some((l) => l.label === 'UNIT REPAIR EXPENSE')).toBe(false);
    expect(f).toMatchObject({ status: 'pass', profit: week('2026-10-16').profit });
  });
});
