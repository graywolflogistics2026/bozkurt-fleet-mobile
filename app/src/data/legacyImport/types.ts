// Legacy backup JSON shapes — mirrors buildBackupPayload()/importData() in
// legacy/index.html (~line 2209 / ~line 2245) EXACTLY. Field names below are
// the legacy in-memory record shapes (DB.sett/loads/fuel/ded/maint/tolls/
// reimb, LOANS, CARDS, CAPITAL.draws/extraContributions, gw_health,
// BANK_STMTS/CHK_STMTS), not the new Postgres column names — the mapping to
// Postgres happens in importLegacyBackup.ts. Unknown/extra keys are ignored
// gracefully (CLAUDE.md: "parse it exactly; ignore unknown keys gracefully").

export type LegacySettlement = {
  id?: string;
  date?: string;
  weekEnding: string;
  carrier?: string;
  gross?: number;
  reimb?: number;
  ded?: number;
  net?: number;
  miles?: number;
  revenueItems?: unknown[];
};

export type LegacyLoad = {
  id?: string;
  date?: string;
  pickupDate?: string | null;
  deliveryDate?: string | null;
  order?: string;
  from?: string;
  to?: string;
  loadedMiles?: number;
  emptyMiles?: number;
  revenue?: number;
  rate?: number;
  shipper?: string;
};

// legacy/index.html handleFile() settlement branch: tractorFuel/reeferFuel
// items pushed as {id, date:f.date||d.date, ...f}
export type LegacyFuel = {
  id?: string;
  date?: string;
  location?: string;
  gallons?: number;
  amount?: number;
  discount?: number;
};

// legacy/index.html: saveDed()/handleFile() deduction records. `source` is
// only stamped 'settlement' for settlement-withheld line items (line 2517);
// standalone manual/import deductions leave it undefined (defaults 'manual'
// on our side — CLAUDE.md invariant #1: settlement-withheld is never a tax
// deduction, enforced by source==='settlement' filtering).
export type LegacyDeduction = {
  id?: string;
  date?: string;
  code?: string;
  desc?: string;
  amount: number;
  category?: string;
  store?: string;
  payment?: string;
  source?: 'settlement' | 'import' | 'manual';
};

// legacy/index.html saveMaint()/handleFile(): {id,date,odo,hours,type,shop|unit,invoice,desc,total,covered}
export type LegacyMaintenance = {
  id?: string;
  date?: string;
  odo?: number;
  hours?: number;
  type?: string;
  shop?: string;
  unit?: string;
  invoice?: string;
  desc?: string;
  total?: number;
  covered?: number;
};

export type LegacyToll = {
  id?: string;
  date?: string;
  amount?: number;
  plaza?: string;
  location?: string;
};

// legacy/index.html: DB.reimb.push({id,date,desc,ref,amount})
export type LegacyReimbursement = {
  id?: string;
  date?: string;
  desc?: string;
  ref?: string;
  amount?: number;
};

// legacy/index.html DB.assets.tr shape (rAssets() ~line 1878, ai-import
// settlement.assets.tractor schema) — the backup's OWN truck identity, never
// a hardcoded specific truck (owner decision 2026-07-09: the legacy importer
// is a generic migration feature for any web-app user).
export type LegacyTractorAsset = {
  unit?: string;
  vin?: string;
  year?: number | string;
  make?: string;
  model?: string;
  engine?: string;
  odometer?: number;
};

export type LegacyDB = {
  sett?: LegacySettlement[];
  loads?: LegacyLoad[];
  fuel?: { tr?: LegacyFuel[]; re?: LegacyFuel[] };
  ded?: LegacyDeduction[];
  maint?: LegacyMaintenance[];
  tolls?: { ez?: LegacyToll[]; dw?: LegacyToll[] };
  reimb?: LegacyReimbursement[];
  assets?: { tr?: LegacyTractorAsset | null };
  docs?: unknown[];
};

// legacy/index.html line 985-987 default LOANS shape
export type LegacyLoan = {
  name: string;
  lender?: string;
  original?: number;
  balance?: number;
  payment?: number;
  freq?: string;
  apr?: number;
  due?: string;
};

// legacy/index.html saveCard() ~line 1970
export type LegacyCard = {
  name: string;
  balance?: number;
  limit?: number;
  apr?: number;
  minpay?: number;
  dueday?: string;
};

// legacy/index.html CAPITAL.draws.push / addContribution() ~lines 1015/1047.
// Contributions are ALWAYS created via syncContributionForDeduction(ded) with
// `id` set to the deduction's own id (CLAUDE.md invariant #2: id-linked) —
// there is no separate manual-contribution flow in legacy.
export type LegacyCapitalDraw = {
  id?: string;
  amount: number;
  date: string;
  note?: string;
};

export type LegacyCapitalContribution = {
  id: string; // == the linked deduction's legacy id
  amount: number;
  date: string;
  note?: string;
};

// legacy/index.html calcHealth() ~line 1935 — gw_health shape
export type LegacyHealth = {
  odo?: number;
  mpg?: number;
  lastOil?: number;
  lastFuelFilter?: number;
  lastDpf?: number;
  lastDef?: number;
  lastCoolExt?: number;
  lastCoolant?: number;
  lastTrans?: number;
  transSynthetic?: boolean;
  lastDiff?: number;
  diffSynthetic?: boolean;
  lastAirFilter?: number;
  lastAirDryer?: number;
  lastChassis?: number;
  apuHours?: number;
  lastApuHours?: number;
};

// legacy/index.html importBankStatement() ~line 2378 (BofA business card)
export type LegacyBankStatement = {
  month: string;
  statementTotal?: number;
  transactions?: Array<{
    date?: string;
    merchant?: string;
    amount?: number;
    category?: string;
    deductible?: boolean;
    notes?: string;
  }>;
};

// legacy/index.html importCheckingStatement() ~line 2646
export type LegacyCheckingStatement = {
  month: string;
  openingBalance?: number;
  closingBalance?: number;
  transactions?: Array<{
    date?: string;
    description?: string;
    category?: string;
    type?: 'deposit' | 'withdrawal';
    amount?: number;
  }>;
};

// buildBackupPayload() — legacy/index.html ~line 2209
export type LegacyBackupPayload = {
  DB?: LegacyDB;
  loans?: LegacyLoan[];
  cards?: LegacyCard[];
  capitalDraws?: LegacyCapitalDraw[];
  capitalContributions?: LegacyCapitalContribution[];
  health?: LegacyHealth;
  bizBalance?: string | number;
  bankStatements?: LegacyBankStatement[];
  checkingStatements?: LegacyCheckingStatement[];
  autoSave?: string;
  exportedAt?: string;
};
