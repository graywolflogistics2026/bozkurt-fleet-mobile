// EVERY column that points at documents.id (batch A item 7, 2026-10-30,
// read from docs/SCHEMA.sql + docs/PENDING_SQL.md). The orphan checks used
// to look at only settlements/deductions/maintenance_records, so a document
// still attached to a bank statement, compliance item, misc income row,
// household income row, import job or "For Prime Inc Drivers" expense was
// counted as an orphan and could be deleted out from under it.
// documentReferences.test.ts fails if the SQL gains a reference not listed.
export const DOCUMENT_REFERENCES: ReadonlyArray<{ table: string; column: string }> = [
  { table: 'settlements', column: 'document_id' },
  { table: 'deductions', column: 'document_id' },
  { table: 'maintenance_records', column: 'document_id' },
  { table: 'bank_statements', column: 'document_id' },
  { table: 'household_income', column: 'document_id' },
  { table: 'compliance_items', column: 'source_document_id' },
  { table: 'misc_income', column: 'document_id' },
  { table: 'import_jobs', column: 'document_id' },
  { table: 'prime_driver_expenses', column: 'document_id' },
  // Batch B (§81): the truck's purchase document.
  { table: 'trucks', column: 'purchase_document_id' },
];

// A table (or, before §81 runs, trucks.purchase_document_id) that does not
// exist on this database yet holds no references.
export function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    error.code === '42703' ||
    /could not find the table/i.test(error.message ?? '') ||
    /column .*purchase_document_id.* does not exist/i.test(error.message ?? '')
  );
}
