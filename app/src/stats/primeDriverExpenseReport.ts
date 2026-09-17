import type { PrimeDriverExpenseMonth } from '@/src/stats/primeDriverExpenses';

// "FOR PRIME INC DRIVERS" OUT-OF-POCKET EXPENSE TRACKER — EXPORT (owner
// decision 2026-09-17). A SEPARATE, standalone report builder from
// src/stats/accountantPackageReport.ts's buildAccountantReportHtml() —
// never modifies or extends that module — but deliberately mirrors its
// established conventions: one shared HTML template for both the PDF
// (expo-print) and Excel (`.xls`-extension trick) exports so the two can
// never visually disagree; pure, zero-React/Expo/i18next module (every
// string is already resolved by the caller via t(), same "pure function,
// caller owns i18n" split as accountantPackageReport.ts/
// unlockNudgePresentation.ts); money/date passed in as plain formatter
// functions.

export type PrimeDriverExpenseReportStrings = {
  categoryTableTitle: string;
  daysAwayFromHomeLabel: string;
  grandTotalLabel: string;
  noEntriesLabel: string;
  disclaimer: string;
};

export type PrimeDriverExpenseReportFormatters = {
  money: (n: number) => string;
  date: (iso: string) => string;
};

const ENGLISH_MONTH_SLUGS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

// FILE NAMING — mirrors buildAccountantReportFilename()'s own established
// convention exactly (fixed English month slugs, never the screen's own
// translated pill labels, so a shared/downloaded file's name stays
// portable across every locale/OS/share target) — its own separate
// function/file, never a call into that module.
export function buildPrimeDriverExpenseReportFilename(year: number, month: number, extension: string): string {
  const periodSlug = `${ENGLISH_MONTH_SLUGS[month - 1]}-${year}`;
  return `prime-driver-expenses-${periodSlug}.${extension}`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildPrimeDriverExpenseReportHtml(
  headerLine: string,
  monthData: PrimeDriverExpenseMonth,
  strings: PrimeDriverExpenseReportStrings,
  fmt: PrimeDriverExpenseReportFormatters
): string {
  const sectionsHtml = monthData.sections
    .map((section) => {
      const rowsHtml = section.rows.length
        ? section.rows
            .map(
              (r) =>
                `<tr><td>${r.exp_date ? esc(fmt.date(r.exp_date)) : ''}</td><td>${esc(r.note ?? '')}</td><td class="amt">${fmt.money(Number(r.amount ?? 0))}</td></tr>`
            )
            .join('')
        : `<tr><td colspan="3" class="empty">${esc(strings.noEntriesLabel)}</td></tr>`;
      return `
        <tr class="subtotal"><td colspan="2" class="cat-name">${esc(section.category)}</td><td class="amt cat-amt">${fmt.money(section.subtotal)}</td></tr>
        ${rowsHtml}
      `;
    })
    .join('');

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
          td.empty { color: #888; font-style: italic; }
          tr.subtotal td { background: #f1f5f9; font-weight: 700; }
          td.cat-name { font-size: 14px; }
          .total-row td { font-weight: 700; font-size: 15px; border-top: 2px solid #333; }
          .muted { color: #666; font-size: 11px; margin-top: 16px; }
        </style>
      </head>
      <body>
        <h1>${esc(headerLine)}</h1>
        <h2>${esc(strings.categoryTableTitle)}</h2>
        <table>${sectionsHtml}</table>
        <table>
          <tr><td>${esc(strings.daysAwayFromHomeLabel)}</td><td class="amt">${monthData.daysAwayFromHome}</td></tr>
          <tr class="total-row"><td>${esc(strings.grandTotalLabel)}</td><td class="amt">${fmt.money(monthData.grandTotal)}</td></tr>
        </table>
        <p class="muted">${esc(strings.disclaimer)}</p>
      </body>
    </html>
  `;
}
