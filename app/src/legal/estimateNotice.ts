// ESTIMATES ONLY - NOT TAX ADVICE (owner decision 2026-10-30, batch D item
// 10). The one place the export/share/report forms of the notice are
// built, so every PDF, Excel sheet, share text and report carries the same
// words. Text is DRAFT pending attorney review (docs/TERMS_OF_USE_DRAFT.md).
// The on-screen form is src/components/EstimateBanner.tsx.

export type EstimateNoticeStrings = {
  headline: string; // "ESTIMATES ONLY - NOT TAX ADVICE."
  body: string; // full paragraph, brand already interpolated
  preparedBy: string; // "Prepared by the owner with AI-generated estimates. Not reviewed by a CPA."
  footer: string; // one line repeated on every page
  note?: string | null; // screen/report-specific extra line
};

type T = (key: string, options?: Record<string, unknown>) => string;

export function estimateNoticeStrings(t: T, brand: string, note?: string | null): EstimateNoticeStrings {
  return {
    headline: t('estimate.headline'),
    body: t('estimate.body', { brand }),
    preparedBy: t('estimate.preparedBy'),
    footer: t('estimate.footer'),
    note: note ?? null,
  };
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// CSS for the banner and for a footer that repeats on every printed page
// (expo-print renders through the platform's print engine, which repeats
// `position: fixed` elements on each page).
export const ESTIMATE_NOTICE_CSS = `
.estimate-banner{border:3px solid #b45309;background:#fff4d6;color:#3a2300;padding:10px 12px;margin:0 0 14px 0;border-radius:6px}
.estimate-banner .eh{font-size:18px;font-weight:800;text-transform:uppercase;color:#7a2e00;margin:0 0 4px 0}
.estimate-banner .eb{font-size:14px;font-weight:600;margin:0 0 4px 0}
.estimate-banner .ep{font-size:12px;font-weight:700;margin:0}
.estimate-footer{position:fixed;bottom:0;left:0;right:0;font-size:9px;color:#555;text-align:center;border-top:1px solid #ccc;padding-top:2px;background:#fff}
body{padding-bottom:22px}
`;

// Full banner for the top of the first page.
export function estimateBannerHtml(s: EstimateNoticeStrings): string {
  return (
    `<div class="estimate-banner" role="note">` +
    `<p class="eh">&#9888; ${esc(s.headline)}</p>` +
    `<p class="eb">${esc(s.body)}</p>` +
    (s.note ? `<p class="eb">${esc(s.note)}</p>` : '') +
    `<p class="ep">${esc(s.preparedBy)}</p>` +
    `</div>`
  );
}

// One-line footer for every page.
export function estimateFooterHtml(s: EstimateNoticeStrings): string {
  return `<div class="estimate-footer">${esc(s.footer)} · ${esc(s.preparedBy)}</div>`;
}

// Plain-text form for share sheets (top block + last line).
export function estimateNoticeTextHeader(s: EstimateNoticeStrings): string[] {
  return [`⚠ ${s.headline}`, s.body, ...(s.note ? [s.note] : []), s.preparedBy, ''];
}
export function estimateNoticeTextFooter(s: EstimateNoticeStrings): string[] {
  return ['', `— ${s.footer}`];
}

// WCAG 2.x contrast ratio between two #rrggbb colors.
function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
