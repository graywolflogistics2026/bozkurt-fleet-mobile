import { ACCOUNTANT_EXPORT_COLORS } from '@/src/stats/accountantPackageColors';
import type { LineItem, PerDiemBlock, MiscConcentrationWarning, CapitalAssetRow, OwnersEquitySummary, GroupedScheduleCCategory } from '@/src/stats/accountantPackage';

// FULL VISUAL PARITY WITH WEB (owner decision, v2026.08.05-W chase) — the
// ONE shared HTML template both the PDF export (expo-print) and the Excel
// export (same HTML, `.xls` extension trick — Excel/browsers render an
// `.xls`-named HTML file as a table, no extra dependency needed) render
// from, so the two exports can never visually disagree with each other or
// with this module's own tested output. Extracted out of the screen
// component (previously inline) into this pure, zero-React/zero-Expo
// module specifically so it's unit-testable via plain ts-jest — same
// "pure function, caller owns i18n via t()" convention as
// unlockNudgePresentation.ts/coachNudgeText.ts: every string here is
// ALREADY resolved by the caller (the screen calls t() and passes the
// result in via `AccountantReportStrings`), this module itself never
// touches i18next. `money`/`date` are likewise passed in as plain
// functions (useFormatters()'s own pure closures) rather than imported,
// keeping this module fully framework-free.

export type AccountantReportStrings = {
  grossIncome: string;
  // Already interpolated with the real amount by the caller (or undefined
  // when there are no reimbursements this period — the sub-line is
  // omitted entirely, never shown as "+ $0").
  reimbursementsSubline?: string;
  deductibleExpenses: string;
  reconcilingCaption: string;
  perDiemTitle: string;
  perDiemMonthLabel: string;
  perDiemYtdLabel: string;
  perDiemDaysUnit: string;
  perDiemNote: string;
  // Already interpolated with the real count/pct, or undefined when there
  // is nothing to warn about.
  implausibleDateWarning?: string;
  miscConcentrationWarning?: string;
  lumperFeesTitle: string;
  paidWithLabel: string;
  categoryTableTitle: string;
  lineLabel: string;
  grandTotal: string;
  ownerPaidBadge: string;
  capitalAssetsTitle: string;
  capitalAssetsNote: string;
  noCapitalAssets: string;
  financingCash: string;
  financingLoan: string;
  ownersEquityTitle: string;
  cashContributedLabel: string;
  cashContributedNote: string;
  expensesPaidPersonallyLabel: string;
  expensesPaidPersonallyNote: string;
  reimbursementsTakenBackLabel: string;
  reimbursementsTakenBackNote: string;
  ownerDrawsLabel: string;
  ownerDrawsNote: string;
  netPositionLabel: string;
  footerMealsNote: string;
  footerNonDeductibleNote: string;
  footerOwnerPaidNote: string;
  disclaimer: string;
};

export type AccountantReportFormatters = {
  money: (n: number) => string;
  date: (iso: string) => string;
};

export type AccountantReportInput = {
  // Full header identity string, ALREADY composed by the caller in the
  // exact "company name — truck unit — period — scope" order (spec item
  // 3) — identical on all three surfaces because every surface reads
  // this same pre-built string, never re-assembling it themselves.
  headerLine: string;
  grossIncome: number;
  reimbursementsTotal: number;
  totalExpenses: number;
  perDiem: PerDiemBlock | null;
  implausibleDates: { label: string; date: string }[];
  miscWarning: MiscConcentrationWarning | null;
  lumperFees: LineItem[];
  lumperTotal: number;
  groupedCategories: GroupedScheduleCCategory[];
  capitalAssets: CapitalAssetRow[];
  ownersEquity: OwnersEquitySummary;
};

const C = ACCOUNTANT_EXPORT_COLORS;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// The one shared "line item row" renderer — used both inside the Lumper
// Fees table and inside each category's own line-item list, so an
// owner-paid row gets the IDENTICAL amber treatment + "Paid with" column
// value regardless of which section it appears in (spec item 1).
function lineItemRow(item: LineItem, strings: AccountantReportStrings, fmt: AccountantReportFormatters): string {
  const bg = item.isOwnerPaid ? ` style="background:${C.ownerPaidBg}"` : '';
  const badge = item.isOwnerPaid ? ` <span class="badge">💰 ${esc(strings.ownerPaidBadge)}</span>` : '';
  const paidWith = item.isOwnerPaid && item.paymentMethod ? esc(item.paymentMethod) : '';
  return `<tr${bg}><td>${item.date ? esc(fmt.date(item.date)) : ''} — ${esc(item.description)}${badge}</td><td>${paidWith}</td><td class="amt">${fmt.money(item.amount)}</td></tr>`;
}

function scheduleCChip(line: string | null, strings: AccountantReportStrings): string {
  if (!line) return '';
  return ` <span class="chip">${esc(strings.lineLabel)} ${esc(line)}</span>`;
}

export function buildAccountantReportHtml(
  input: AccountantReportInput,
  strings: AccountantReportStrings,
  fmt: AccountantReportFormatters
): string {
  const { headerLine, grossIncome, reimbursementsTotal, totalExpenses, perDiem, implausibleDates, miscWarning, lumperFees, lumperTotal, groupedCategories, capitalAssets, ownersEquity } = input;

  const warningRows = implausibleDates.map((w) => `<tr><td>${esc(w.label)}</td><td>${esc(w.date)}</td></tr>`).join('');
  const lumperRows = lumperFees.map((l) => lineItemRow(l, strings, fmt)).join('');

  const categorySections = groupedCategories
    .map(
      (cat) => `
        <tr class="subtotal" style="background:${C.subtotalRowBg}">
          <td colspan="2" class="cat-name">${esc(cat.category)}${scheduleCChip(cat.scheduleCLine, strings)}</td>
          <td class="amt cat-amt">${fmt.money(cat.amount)}</td>
        </tr>
        ${cat.items.map((item) => lineItemRow(item, strings, fmt)).join('')}
      `
    )
    .join('');

  const assetRows = capitalAssets
    .map(
      (a) =>
        `<tr><td colspan="2">${esc(a.type)} — ${esc(a.name)}${a.date ? ` (${esc(fmt.date(a.date))})` : ''} (${a.financing === 'loan' ? esc(strings.financingLoan) : esc(strings.financingCash)})</td><td class="amt">${fmt.money(a.price)}</td></tr>`
    )
    .join('');

  const flows = ownersEquity.flows;

  return `
    <html>
      <head><meta charset="utf-8" />
        <style>
          body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #111; padding: 24px; }
          h1 { font-size: 20px; margin-bottom: 4px; }
          h2 { font-size: 15px; margin-top: 24px; margin-bottom: 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; }
          td { padding: 6px 8px; border-bottom: 1px solid #eee; }
          td.amt { text-align: right; white-space: nowrap; }
          .total { font-weight: 700; border-top: 2px solid #333; }
          .total.expenses-row { background: ${C.totalRowBg}; }
          .income-row { background: ${C.grossIncomeBg}; }
          .muted { color: #666; font-size: 11px; margin-top: 24px; }
          .caption { color: #666; font-size: 11px; margin: 4px 0 12px; }
          .warn { color: #b45309; }
          .badge { display: inline-block; font-size: 10px; font-weight: 700; color: #92400e; background: ${C.ownerPaidBg}; border-radius: 4px; padding: 1px 6px; }
          .chip { display: inline-block; font-size: 10px; font-weight: 700; color: #1e40af; background: ${C.capitalAssetsHeaderBg}; border-radius: 4px; padding: 1px 6px; }
          tr.subtotal td { font-weight: 800; font-size: 14px; }
          .lumper-header { background: ${C.lumperHeaderBg}; padding: 6px 8px; }
          .assets-section { background: ${C.capitalAssetsBg}; padding: 8px; border-radius: 6px; }
          .assets-header { background: ${C.capitalAssetsHeaderBg}; padding: 6px 8px; font-weight: 700; }
          tr.flow-in { background: ${C.contributionsInBg}; }
          tr.flow-out { background: ${C.drawsOutBg}; }
        </style>
      </head>
      <body>
        <h1>${esc(headerLine)}</h1>

        <table>
          <tr class="income-row"><td style="font-weight:700">${esc(strings.grossIncome)}</td><td class="amt">${fmt.money(grossIncome)}</td></tr>
          ${
            reimbursementsTotal > 0 && strings.reimbursementsSubline
              ? `<tr><td colspan="2" class="caption">${esc(strings.reimbursementsSubline)}</td></tr>`
              : ''
          }
          <tr class="total expenses-row"><td>${esc(strings.deductibleExpenses)}</td><td class="amt">${fmt.money(totalExpenses)}</td></tr>
        </table>
        <div class="caption">${esc(strings.reconcilingCaption)}</div>

        ${
          perDiem
            ? `<h2>${esc(strings.perDiemTitle)}</h2><table>
                ${
                  // PER DIEM YTD BUG FIX — a "This Month" row is only ever
                  // shown when the report is genuinely scoped to one
                  // month; when it's null (All Year), only the YTD row
                  // renders, so this section can never show two rows with
                  // the same number under different labels.
                  perDiem.monthDays != null
                    ? `<tr><td>${esc(strings.perDiemMonthLabel)}</td><td class="amt">${perDiem.monthDays} ${esc(strings.perDiemDaysUnit)} — ${fmt.money(perDiem.monthDeduction ?? 0)}</td></tr>`
                    : ''
                }
                <tr><td>${esc(strings.perDiemYtdLabel)}</td><td class="amt">${perDiem.ytdDays} ${esc(strings.perDiemDaysUnit)} — ${fmt.money(perDiem.ytdDeduction)}</td></tr>
              </table>`
            : ''
        }

        ${
          implausibleDates.length > 0 && strings.implausibleDateWarning
            ? `<h2 class="warn">${esc(strings.implausibleDateWarning)}</h2><table>${warningRows}</table>`
            : ''
        }

        ${miscWarning && strings.miscConcentrationWarning ? `<h2 class="warn">${esc(strings.miscConcentrationWarning)}</h2>` : ''}

        ${
          lumperFees.length > 0
            ? `<h2 class="lumper-header">${esc(strings.lumperFeesTitle)}</h2>
               <table><tr><td></td><td>${esc(strings.paidWithLabel)}</td><td class="amt"></td></tr>${lumperRows}<tr class="total"><td colspan="2">${esc(strings.grandTotal)}</td><td class="amt">${fmt.money(lumperTotal)}</td></tr></table>`
            : ''
        }

        <h2>${esc(strings.categoryTableTitle)}</h2>
        <table>
          <tr><td></td><td>${esc(strings.paidWithLabel)}</td><td class="amt"></td></tr>
          ${categorySections}
          <tr class="total expenses-row"><td colspan="2">${esc(strings.grandTotal)}</td><td class="amt">${fmt.money(totalExpenses)}</td></tr>
        </table>

        <div class="assets-section">
          <div class="assets-header">${esc(strings.capitalAssetsTitle)}</div>
          <table>${assetRows || `<tr><td colspan="2">${esc(strings.noCapitalAssets)}</td><td></td></tr>`}</table>
          <div class="caption">${esc(strings.capitalAssetsNote)}</div>
        </div>

        <h2>${esc(strings.ownersEquityTitle)}</h2>
        <table>
          <tr class="flow-in"><td>${esc(strings.cashContributedLabel)} (${flows.cashContributedCount})</td><td class="amt">${fmt.money(flows.cashContributed)}</td></tr>
          <tr><td colspan="2" class="caption">${esc(strings.cashContributedNote)}</td></tr>
          <tr class="flow-in"><td>${esc(strings.expensesPaidPersonallyLabel)} (${flows.expensesPaidPersonallyOutstandingCount})</td><td class="amt">${fmt.money(flows.expensesPaidPersonallyOutstanding)}</td></tr>
          <tr><td colspan="2" class="caption">${esc(strings.expensesPaidPersonallyNote)}</td></tr>
          <tr class="flow-out"><td>${esc(strings.reimbursementsTakenBackLabel)} (${flows.reimbursementsTakenBackCount})</td><td class="amt">-${fmt.money(flows.reimbursementsTakenBack)}</td></tr>
          <tr><td colspan="2" class="caption">${esc(strings.reimbursementsTakenBackNote)}</td></tr>
          <tr class="flow-out"><td>${esc(strings.ownerDrawsLabel)} (${flows.ownerDrawsCount})</td><td class="amt">-${fmt.money(flows.ownerDraws)}</td></tr>
          <tr><td colspan="2" class="caption">${esc(strings.ownerDrawsNote)}</td></tr>
          <tr class="total"><td>${esc(strings.netPositionLabel)}</td><td class="amt">${fmt.money(flows.netPosition)}</td></tr>
        </table>

        <p class="muted">${esc(strings.footerMealsNote)}<br/>${esc(strings.footerNonDeductibleNote)}<br/>${esc(strings.footerOwnerPaidNote)}<br/>${esc(strings.disclaimer)}</p>
      </body>
    </html>
  `;
}
