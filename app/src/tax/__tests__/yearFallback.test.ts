import { resolveTaxYearData } from '@/src/tax/yearFallback';
import { fixtureTaxYearData } from '@/src/tax/__tests__/fixtures';

const row2026 = fixtureTaxYearData;
const row2025 = { ...fixtureTaxYearData, tax_year: 2025 };

describe('resolveTaxYearData', () => {
  it('uses the requested year directly when its row is published', () => {
    const result = resolveTaxYearData(2026, row2026, row2025);
    expect(result).toEqual({ data: row2026, requestedYear: 2026, resolvedYear: 2026, isFallback: false });
  });

  it('falls back to the latest published year when the requested year is missing/unpublished', () => {
    const result = resolveTaxYearData(2027, null, row2026);
    expect(result).toEqual({ data: row2026, requestedYear: 2027, resolvedYear: 2026, isFallback: true });
  });

  it('throws when neither the requested nor a fallback row exists', () => {
    expect(() => resolveTaxYearData(2027, null, null)).toThrow();
  });
});
