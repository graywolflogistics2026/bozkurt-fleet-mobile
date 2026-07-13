import type { Deduction } from '@/src/types/db';

// Asset Register (PROMPTS.md Session 9a) — legacy's own ASSETS2/localStorage
// list (legacy/index.html:1092) is superseded here: rather than a second,
// separately-maintained ledger, an "asset" is simply any deduction already
// booked into one of these five equipment-like canonical categories
// (docs/INDUSTRY_TAXONOMY.md §B) that also carries a warranty_years value
// from ai-import's store-purchase extraction (docs/PENDING_SQL.md §7). This
// keeps a single source of truth (deductions) instead of a parallel table
// that could silently drift from the P&L.
export const ASSET_CATEGORIES = [
  'Tools & Equipment',
  'Electronics',
  'Comfort & Sleeper',
  'Truck Supplies & Equipment',
  'Safety Gear & Workwear',
] as const;

export type WarrantyStatus = 'active' | 'expired' | 'none';

export type AssetRow = {
  deduction: Deduction;
  warrantyExpires: string | null; // YYYY-MM-DD
  warrantyStatus: WarrantyStatus;
  needsReview: boolean;
};

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function warrantyExpiration(x: Deduction): string | null {
  if (!x.ded_date || !x.warranty_years) return null;
  return addMonths(x.ded_date, Math.round(Number(x.warranty_years) * 12));
}

export function isAssetCategory(category: string | null): boolean {
  if (!category) return false;
  return (ASSET_CATEGORIES as readonly string[]).includes(category);
}

export function buildAssetRegister(deductions: Deduction[], todayIso: string): AssetRow[] {
  return deductions
    .filter((x) => isAssetCategory(x.category))
    .map((x) => {
      const warrantyExpires = warrantyExpiration(x);
      const warrantyStatus: WarrantyStatus = !warrantyExpires ? 'none' : warrantyExpires >= todayIso ? 'active' : 'expired';
      return {
        deduction: x,
        warrantyExpires,
        warrantyStatus,
        needsReview: (x.description ?? '').startsWith('NEEDS REVIEW: '),
      };
    })
    .sort((a, b) => (b.deduction.ded_date ?? '').localeCompare(a.deduction.ded_date ?? ''));
}

export function activeWarranties(assets: AssetRow[]): AssetRow[] {
  return assets
    .filter((a) => a.warrantyStatus === 'active')
    .sort((a, b) => (a.warrantyExpires ?? '').localeCompare(b.warrantyExpires ?? ''));
}

export type AssetCategoryBreakdown = { category: string; count: number; total: number };

// Legacy's category-breakdown card (FEATURE_INVENTORY.md §1 row 18: "Tools,
// Comfort, Electronics, Supplies, Safety, Total") — one row per
// ASSET_CATEGORIES value plus a Total row, in that fixed order (not
// sorted by amount) so it reads the same every time.
export function buildAssetCategoryBreakdown(assets: AssetRow[]): AssetCategoryBreakdown[] {
  const rows = ASSET_CATEGORIES.map((category) => {
    const inCategory = assets.filter((a) => a.deduction.category === category);
    return {
      category,
      count: inCategory.length,
      total: inCategory.reduce((sum, a) => sum + Number(a.deduction.amount ?? 0), 0),
    };
  });
  const total: AssetCategoryBreakdown = {
    category: 'Total',
    count: assets.length,
    total: assets.reduce((sum, a) => sum + Number(a.deduction.amount ?? 0), 0),
  };
  return [...rows, total];
}

// This-month $ (legacy stat tile) — assets whose ded_date falls within the
// given YYYY-MM.
export function thisMonthTotal(assets: AssetRow[], monthKey: string): number {
  return assets
    .filter((a) => (a.deduction.ded_date ?? '').startsWith(monthKey))
    .reduce((sum, a) => sum + Number(a.deduction.amount ?? 0), 0);
}
