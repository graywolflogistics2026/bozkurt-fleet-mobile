import fs from 'fs';
import path from 'path';
import { estimateBannerTokens } from '@/src/theme';
import { contrastRatio, estimateBannerHtml, estimateFooterHtml, ESTIMATE_NOTICE_CSS } from '@/src/legal/estimateNotice';
import { canAcceptTos } from '@/src/legal/tosScrollGate';
import { resolveNeedsTos } from '@/src/auth/profileGates';
import { TOS_BODY, TOS_VERSION } from '@/src/config/termsOfUse';
import { buildAuditText } from '@/src/stats/auditShare';
import { buildImportAuditText } from '@/src/import/importAudit';
import { reviewInputsOf } from '@/src/import/reviewVerdict';
import { computeKpis } from '@/src/stats/kpi';
import { BRAND_NAME } from '@/src/brand';
import { localeNotice, translator } from './localeNotice';
import en from '@/src/i18n/locales/en.json';
import tr from '@/src/i18n/locales/tr.json';
import es from '@/src/i18n/locales/es.json';
import ru from '@/src/i18n/locales/ru.json';
import hi from '@/src/i18n/locales/hi.json';
import ar from '@/src/i18n/locales/ar.json';
import uk from '@/src/i18n/locales/uk.json';

// ESTIMATES ONLY - NOT TAX ADVICE (owner decision 2026-10-30, batch D item
// 10) — enforcement. Report/export builders are covered in
// accountantPackageReport.test.ts and primeDriverExpenseReport.test.ts
// (their fixtures carry the real notice strings) and asserted here too.

const APP = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(APP, rel), 'utf8');

describe('EstimateBanner colors', () => {
  for (const mode of ['dark', 'light'] as const) {
    const tok = estimateBannerTokens[mode];
    it(`${mode}: headline and body text are >= 4.5:1 on the banner background`, () => {
      expect(contrastRatio(tok.headline, tok.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tok.body, tok.bg)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${mode}: the border and icon stand out (>= 3:1, non-text)`, () => {
      expect(contrastRatio(tok.border, tok.bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(tok.icon, tok.bg)).toBeGreaterThanOrEqual(3);
    });
  }
  it('the export banner colors pass too (print, light paper)', () => {
    expect(ESTIMATE_NOTICE_CSS).toContain('#fff4d6');
    expect(contrastRatio('#3a2300', '#fff4d6')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#7a2e00', '#fff4d6')).toBeGreaterThanOrEqual(4.5);
  });
  it('contrastRatio matches the WCAG reference (black on white = 21)', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });
});

describe('the words', () => {
  it('EN headline/body exactly as the owner wrote them', () => {
    const n = localeNotice(en);
    expect(n.headline).toBe('ESTIMATES ONLY - NOT TAX ADVICE.');
    expect(n.body).toBe(
      'BOZKA TRUCKING AI is a record-keeping and estimating tool, not a tax preparer, accountant or law firm. Numbers are AI-generated estimates from your documents and can be wrong. Confirm everything with a licensed tax professional before you file or pay.'
    );
    expect(n.preparedBy).toBe('Prepared by the owner with AI-generated estimates. Not reviewed by a CPA.');
  });
  it('TR headline with proper Turkish characters', () => {
    expect(localeNotice(tr).headline).toBe('SADECE TAHMİNDİR - VERGİ TAVSİYESİ DEĞİLDİR.');
  });
  it('every locale has every estimate.* key; the 5 enabled ones are translated', () => {
    const keys = (o: Record<string, unknown>, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]));
    const enKeys = keys(en.estimate as Record<string, unknown>).sort();
    for (const loc of [es, ru, tr, hi, ar, uk]) expect(keys(loc.estimate as Record<string, unknown>).sort()).toEqual(enKeys);
    for (const loc of [es, ru, tr, hi]) expect(loc.estimate.headline).not.toBe(en.estimate.headline);
  });
});

describe('exports carry the full banner on page 1 and a footer on every page', () => {
  const n = localeNotice(en, 'Record-keeping aid. Not an accounting or tax document.');
  it('HTML banner + repeating footer', () => {
    const html = estimateBannerHtml(n) + estimateFooterHtml(n);
    expect(html).toContain('ESTIMATES ONLY - NOT TAX ADVICE.');
    expect(html).toContain('not a tax preparer, accountant or law firm');
    expect(html).toContain('Prepared by the owner with AI-generated estimates. Not reviewed by a CPA.');
    expect(html).toContain('Record-keeping aid. Not an accounting or tax document.');
    expect(ESTIMATE_NOTICE_CSS).toMatch(/\.estimate-footer\{position:fixed;bottom:0/);
  });

  it('the audit share text opens with the banner and ends with the footer', () => {
    const kpi = computeKpis({ trucks: [], settlements: [], loads: [], deductions: [], fuelPurchases: [], maintenanceRecords: [], tolls: [], reimbursements: [], truckScope: null, window: null });
    const text = buildAuditText({ kpi, settlements: [], t: translator(en), money: (x) => x.toFixed(2) });
    expect(text.startsWith('⚠ ESTIMATES ONLY - NOT TAX ADVICE.')).toBe(true);
    expect(text).toContain('Prepared by the owner with AI-generated estimates. Not reviewed by a CPA.');
    expect(text.trimEnd().endsWith(en.estimate.footer)).toBe(true);
  });

  it('the import audit share text opens with the banner and ends with the footer', () => {
    const extraction = { docType: 'settlement', confidence: 'high', settlement: {} } as unknown as Parameters<typeof buildImportAuditText>[0];
    const text = buildImportAuditText(extraction, reviewInputsOf(extraction), translator(en));
    expect(text.startsWith('⚠ ESTIMATES ONLY - NOT TAX ADVICE.')).toBe(true);
    expect(text).toContain(en.estimate.body.replace('{{brand}}', BRAND_NAME));
    expect(text.trimEnd().endsWith(en.estimate.footer)).toBe(true);
  });

  it('every report builder renders the banner and the footer', () => {
    for (const f of ['src/stats/accountantPackageReport.ts', 'src/stats/primeDriverExpenseReport.ts']) {
      const src = read(f);
      expect(src).toContain('estimateBannerHtml(strings.estimateNotice)');
      expect(src).toContain('estimateFooterHtml(strings.estimateNotice)');
      expect(src).toContain('ESTIMATE_NOTICE_CSS');
    }
    expect(read('app/(tabs)/more/prime-driver-expenses.tsx')).toMatch(/estimateNotice: estimateNoticeStrings\([^\n]*'estimate\.primeNote'/);
    expect(read('app/(tabs)/more/accountant-package.tsx')).toContain('estimateNotice: estimateNoticeStrings(');
  });
});

describe('every listed screen renders the notice', () => {
  const FULL: [string, RegExp][] = [
    ['app/(tabs)/more/tax-estimator.tsx', /<EstimateBanner \/>/],
    ['app/(tabs)/more/accountant-package.tsx', /<EstimateBanner \/>/],
    ['src/components/WeekReviewCard.tsx', /<EstimateBanner \/>/],
    ['app/(tabs)/more/trucks.tsx', /<EstimateBanner \/>/],
    ['app/(tabs)/more/prime-driver-expenses.tsx', /<EstimateBanner note=\{t\('estimate\.primeNote'\)\} \/>/],
    ['app/(tabs)/more/cash-flow.tsx', /<EstimateBanner note=\{t\('estimate\.forecastNote'\)\} \/>/],
  ];
  it.each(FULL)('%s', (file, re) => expect(read(file)).toMatch(re));

  it('Home: a one-line strip directly above the tax strip and under the AI weekly review', () => {
    const home = read('app/(tabs)/index.tsx');
    expect(home).toMatch(/<ScreenTitle>\{t\('dashboard\.taxStrip\.title'\)\}<\/ScreenTitle>\s*<EstimateStrip \/>/);
    expect(home).toMatch(/weeklyReviewExplanation\} when="week" \/>\s*<EstimateStrip \/>/);
  });
  it('AI Coach answers carry the one-line strip', () => {
    expect((read('app/(tabs)/more/ceo-mode.tsx').match(/<EstimateStrip \/>/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it('the banner has no close/dismiss control', () => {
    const src = read('src/components/EstimateBanner.tsx');
    const banner = src.slice(src.indexOf('export function EstimateBanner'), src.indexOf('export function EstimateStrip'));
    expect(banner).not.toMatch(/onClose|dismiss|setVisible/i);
  });
});

describe('"Before you start" acknowledgment gate', () => {
  const base = { hasSession: true, profileLoaded: true, currentTosVersion: TOS_VERSION };
  it('shows on first launch after sign-in (nothing accepted yet)', () => {
    expect(resolveNeedsTos({ ...base, tosAcceptedAt: null, tosVersion: null })).toBe(true);
  });
  it('shows again after the text version changes', () => {
    expect(TOS_VERSION).not.toBe('draft-2026-07-04');
    expect(resolveNeedsTos({ ...base, tosAcceptedAt: '2026-08-01T00:00:00Z', tosVersion: 'draft-2026-07-04' })).toBe(true);
  });
  it('does not show once the current version is accepted', () => {
    expect(resolveNeedsTos({ ...base, tosAcceptedAt: '2026-10-31T00:00:00Z', tosVersion: TOS_VERSION })).toBe(false);
  });
  it('Continue needs the "I understand" box AND the scroll gate', () => {
    expect(canAcceptTos({ understood: false, scrollGateSatisfied: true })).toBe(false);
    expect(canAcceptTos({ understood: true, scrollGateSatisfied: false })).toBe(false);
    expect(canAcceptTos({ understood: true, scrollGateSatisfied: true })).toBe(true);
  });
  it('the gate screen shows the banner + bullets, a checkbox that starts unticked, and no skip', () => {
    const src = read('app/tos.tsx');
    expect(src).toContain('<EstimateAcknowledgmentText');
    expect(src).toContain('useState(false);');
    expect(src).toMatch(/accessibilityRole="checkbox"/);
    expect(src).toMatch(/disabled=\{!canContinue\}/);
    expect(src).not.toMatch(/router\.(replace|push|back)/);
  });
  it('the accepted text includes the notice; Settings -> Legal shows the same text', () => {
    expect(TOS_BODY).toContain('ESTIMATES ONLY - NOT TAX ADVICE.');
    expect(TOS_BODY).toContain(`${BRAND_NAME} is a record-keeping and estimating tool`);
    expect(read('app/(tabs)/more/settings.tsx')).toContain('<EstimateAcknowledgmentText');
  });
});
