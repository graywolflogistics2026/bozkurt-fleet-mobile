import type { LegacyBackupPayload } from '@/src/data/legacyImport/types';

export type LegacyImportPreview = {
  settlements: number;
  settlementsMissingWeekEnding: number;
  loads: number;
  fuelPurchases: number;
  deductions: number;
  maintenanceRecords: number;
  tolls: number;
  reimbursements: number;
  loans: number;
  creditCards: number;
  capitalDraws: number;
  capitalContributions: number;
  bankStatements: number;
  checkingStatements: number;
  hasHealthData: boolean;
  hasBizBalance: boolean;
  exportedAt: string | null;
};

// Logged (not just shown in the preview card) so a field-name/shape mismatch
// between this parser and the REAL buildBackupPayload() JSON is visible in
// the device logs before the user ever taps "Import" — a mismatch here
// previously produced a silent "0 imported" for the whole entity with no
// error, since an empty parsed array looks identical to "nothing to do".
export function buildImportPreview(payload: LegacyBackupPayload): LegacyImportPreview {
  const db = payload.DB ?? {};
  const sett = db.sett ?? [];

  const preview: LegacyImportPreview = {
    settlements: sett.length,
    settlementsMissingWeekEnding: sett.filter((s) => !s.weekEnding).length,
    loads: db.loads?.length ?? 0,
    fuelPurchases: (db.fuel?.tr?.length ?? 0) + (db.fuel?.re?.length ?? 0),
    deductions: db.ded?.length ?? 0,
    maintenanceRecords: db.maint?.length ?? 0,
    tolls: (db.tolls?.ez?.length ?? 0) + (db.tolls?.dw?.length ?? 0),
    reimbursements: db.reimb?.length ?? 0,
    loans: payload.loans?.length ?? 0,
    creditCards: payload.cards?.length ?? 0,
    capitalDraws: payload.capitalDraws?.length ?? 0,
    capitalContributions: payload.capitalContributions?.length ?? 0,
    bankStatements: payload.bankStatements?.length ?? 0,
    checkingStatements: payload.checkingStatements?.length ?? 0,
    hasHealthData: !!payload.health && Object.keys(payload.health).length > 0,
    hasBizBalance: payload.bizBalance !== undefined && payload.bizBalance !== null,
    exportedAt: payload.exportedAt ?? null,
  };

  console.log('[legacy-import] parsed top-level counts:', JSON.stringify(preview));
  if (!payload.DB) console.log('[legacy-import] WARNING: payload.DB is missing entirely.');
  if (preview.settlementsMissingWeekEnding > 0) {
    console.log(
      `[legacy-import] WARNING: ${preview.settlementsMissingWeekEnding}/${preview.settlements} settlement(s) have no weekEnding — will fall back to their date field.`
    );
  }

  return preview;
}
