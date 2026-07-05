import type { DocType, Extraction } from '@/src/import/types';

// Verbatim ports of legacy/index.html's Drive-organization helpers
// (~lines 1102-1163), retargeted at Supabase Storage paths instead of
// browser downloads. CLAUDE.md storage convention:
//   documents bucket: {user_id}/{month}/Payroll/Week-N/{filename}
//                      {user_id}/{month}/Equipment-Deductions/{store}/{filename}
//                      {user_id}/{month}/{Category}/{filename}

// legacy/index.html:1102
export function slugify(s: string | undefined): string {
  return (
    (s ?? '')
      .toString()
      .trim()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/(^-+|-+$)/g, '')
      .slice(0, 40) || 'file'
  );
}

// legacy/index.html:1104 — month folder from the DOCUMENT's own date, not
// upload date.
export function monthFolder(dateStr: string | undefined): string {
  const m = (dateStr ?? '').match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : 'Undated';
}

// legacy/index.html:1126 — week-of-month (1-5) from the document date, used
// to split Payroll into Week-1..Week-5 subfolders.
export function weekOfMonth(dateStr: string | undefined): number | null {
  const m = (dateStr ?? '').match(/^\d{4}-\d{2}-(\d{2})/);
  if (!m) return null;
  return Math.min(5, Math.ceil(parseInt(m[1], 10) / 7));
}

// legacy/index.html:1118 — category/vendor subfolder within the month.
export function orgFolderName(docType: DocType, vendor: string | undefined): string {
  const map: Partial<Record<DocType, string>> = {
    settlement: 'Payroll',
    fuel: 'Fuel',
    maintenance: 'Maintenance',
    toll: 'Tolls',
    loan: 'Loans',
  };
  if (map[docType]) return map[docType] as string;
  if ((docType === 'amazon' || docType === 'store') && vendor) {
    return vendor.trim().replace(/[/\\]/g, '-') || 'Purchases';
  }
  return 'Other';
}

// legacy/index.html:1135 — full folder path array for a document.
export function buildDocFolderParts(docType: DocType, dateStr: string | undefined, vendor: string | undefined): string[] {
  const month = monthFolder(dateStr);
  if (docType === 'settlement') {
    const wk = weekOfMonth(dateStr);
    return wk ? [month, 'Payroll', `Week-${wk}`] : [month, 'Payroll'];
  }
  if (docType === 'amazon' || docType === 'store') {
    const store = (vendor || 'Unknown Store').trim().replace(/[/\\]/g, '-');
    return [month, 'Equipment-Deductions', store];
  }
  return [month, orgFolderName(docType, vendor)];
}

// legacy/index.html:1152 — human-readable filename, never internal codes.
export function buildDocFileName(d: Extraction, ext: string): string {
  const date = d.date || 'undated';
  if (d.docType === 'amazon' || d.docType === 'store') {
    const vendor = slugify(d.vendor || 'Unknown-Store');
    const firstItem = d.purchase?.items?.[0]?.name;
    const item = firstItem ? slugify(firstItem) : 'receipt';
    return `${date}_${vendor}_${item}.${ext}`;
  }
  const typeLabel: Partial<Record<DocType, string>> = {
    settlement: 'Payroll-Settlement',
    fuel: 'Fuel-Receipt',
    maintenance: 'Maintenance-Invoice',
    toll: 'Toll-Statement',
    loan: 'Loan-Document',
    w2: 'W2-Form',
  };
  const label = typeLabel[d.docType] ?? 'Document';
  const ident = slugify(d.vendor || d.summary || '');
  return `${date}_${label}${ident ? `_${ident}` : ''}.${ext}`;
}

// Full Storage object path: {user_id}/{month}/.../{filename} (CLAUDE.md).
export function buildStoragePath(userId: string, d: Extraction, ext: string): string {
  const folderParts = buildDocFolderParts(d.docType, d.date, d.vendor);
  const fileName = buildDocFileName(d, ext);
  return [userId, ...folderParts, fileName].join('/');
}
