import type { LegacyBackupPayload } from '@/src/data/legacyImport/types';

export type LegacyImportPreview = {
  settlements: number;
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

export function buildImportPreview(payload: LegacyBackupPayload): LegacyImportPreview {
  const db = payload.DB ?? {};
  return {
    settlements: db.sett?.length ?? 0,
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
}
