// SHARE AUDIT ON THE IMPORT PREVIEW (owner decision 2026-10-17, item 5).
import { buildImportAuditText } from '@/src/import/importAudit';
import { reviewInputsOf } from '@/src/import/reviewVerdict';
import type { Extraction } from '@/src/import/types';

describe('Share audit on the import preview', () => {
  const extraction: Extraction = {
    docType: 'settlement',
    confidence: 'high',
    summary: 'Prime settlement — DIRECT DEPOSIT TO BANK ROUTING #111000025 ACCT # 4455-6677-88 for 3,072.57',
    settlement: {
      weekEnding: '2026-08-14',
      carrier: 'PRIME INC.',
      unit: '283940',
      grossRevenue: 7914.1,
      totalDeductions: 4100.66,
      netPay: 4276.08,
      revenueItems: [{ desc: 'OWNER REVENUE', order: '4844270', amount: 2900.4 }],
      deductions: [
        { code: 'UF', desc: 'TRACTOR FUEL', amount: 341.04 },
        { code: 'PO', desc: 'NORTH STAR GRILL, MO', amount: 62.25 },
      ],
      operating: {
        lines: [
          { section: 'fuel_oil_tax', label: 'TRACTOR FUEL', amount: -341.04 },
          { section: 'misc', label: 'PRIME POINT-OF-SALE', amount: -62.25 },
        ],
        weekTotalOperatingExpenses: -403.29,
      },
    },
  };

  test('every line the AI read with its amount, the check results and per-group differences; never bank digits', () => {
    const t = (key: string, o?: Record<string, unknown>) => (o ? `${key} ${JSON.stringify(o)}` : key);
    const text = buildImportAuditText(extraction, reviewInputsOf(extraction), t);
    expect(text).toContain('4844270 OWNER REVENUE  2900.40');
    expect(text).toContain('UF TRACTOR FUEL  341.04');
    expect(text).toContain('PO NORTH STAR GRILL, MO  62.25');
    expect(text).toContain('fuel_oil_tax · TRACTOR FUEL  -341.04');
    expect(text).toContain('importScreen.group.tractor_fuel: 341.04 / 341.04 (0.00)');
    expect(text).toContain('importScreen.group.meals: 62.25 / 62.25 (0.00)');
    expect(text).toContain('importAudit.lineChecks');
    expect(text).not.toContain('111000025');
    expect(text).not.toContain('4455-6677-88');
    expect(text).toContain('3,072.57');
  });
});
