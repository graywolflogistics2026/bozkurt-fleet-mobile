// DAILY TIPS — WHOLE-APP COVERAGE (owner decision, Part 2 of the AI Coach
// "fix stale cache + add daily proactive tips" request). One tip per day
// on Home, chosen from whatever the user's OWN setup/data justifies right
// now, composed entirely client-side from templates (NO ai-advisor call —
// distinct from the weekly financial review, this app's one AI call per
// user per week). A THIRD disjoint topic-key family sharing
// `profiles.nudge_state` with missingDataNudges.ts (item D) and
// periodicCoachNudges.ts (item E2) — every key here is prefixed `tip`, so
// it can never collide with either of those two families' own strings.
//
// VARIETY: every topic below has exactly 3 phrasings (an i18n array,
// `dailyTips.<topic>.v0`/`v1`/`v2`), each its own angle — one states the
// benefit, one asks a question, one leads with a real figure from the
// user's own data whenever one exists. `selectDailyTipVariant()` cycles
// through them 0→1→2→0→... in order, so the SAME topic never reads the
// same way twice until every phrasing has been used once.
//
// ROTATION: `selectDailyTip()` — filters to topics whose PRECONDITION
// currently holds (a tip disappears entirely once the thing it teaches is
// done, since the precondition simply stops matching), then to topics not
// silenced and not shown within the last 30 days ("no topic repeats
// within a month"), then prefers a topic whose CATEGORY differs from the
// last 2 days' own categories ("never three [same-category] tips in a
// row" — the user's own literal example was tax tips specifically; this
// generalizes it to every category), then picks whichever ELIGIBLE
// candidate was shown longest ago (or never shown) — a natural round-
// robin that, combined with the explicit 30-day cooldown, guarantees no
// repeat within a month whenever 2+ topics are eligible.
//
// STICKY ANCHOR + "SHOW ME ANOTHER" (owner decision, bug fix + feature):
// `selectDailyTip()` is only ever called to pick a BRAND NEW topic —
// once one has been recorded as shown today, `findTodaysAnchorTip()`
// (below) reconstructs it directly from persisted state on every render,
// never by recomputing selection live (see that function's own header
// comment for the exact "flash and vanish" bug this closes). "Show me
// another" (src/data/dailyTips.ts's `useDailyTip()`) just calls
// `selectDailyTip()` again on top of the now-updated state — the
// just-shown topic is automatically excluded (its own `lastShownAt` is
// now "today," which the existing 30-day cooldown already treats as
// ineligible), so advancing can never repeat a topic and — since that
// same cooldown persists past today — never lets tomorrow's normal
// rotation offer it again early either. The one thing that's NOT
// persisted is which topic is currently DISPLAYED after several
// advances — that's session-only UI state, so a fresh app open always
// shows the original anchor again, never wherever the user last browsed
// to.
import type { NudgeState, NudgeStateEntry } from '@/src/alerts/nudgeFrequency';

export type DailyTipCategory = 'setup' | 'money' | 'discovery' | 'knowledge';

export type DailyTipTopic =
  | 'tipTransactions'
  | 'tipImport'
  | 'tipLoads'
  | 'tipSettlements'
  | 'tipReimbursements'
  | 'tipOtherIncome'
  | 'tipFuel'
  | 'tipMaintenance'
  | 'tipTolls'
  | 'tipDeductions'
  | 'tipAssetRegister'
  | 'tipAccountantPackage'
  | 'tipTaxEstimator'
  | 'tipDocumentsRenewals'
  | 'tipDocuments'
  | 'tipCategoryLearning'
  | 'tipTruckCostBasis'
  | 'tipTruckDepreciation'
  | 'tipTruckAddTrailer'
  | 'tipTruckComparison'
  | 'tipEquipment'
  | 'tipDrivers'
  | 'tipCapitalAccount'
  | 'tipOperatingPnl'
  | 'tipTruckHealth'
  | 'tipCashFlow'
  | 'tipScorecard'
  | 'tipLoans'
  | 'tipProfitAnalysis'
  | 'tipAiCoachFull'
  | 'tipDeadheadBenchmark'
  | 'tipPerDiemVsMeals'
  | 'tipRepairVsCapitalImprovement'
  | 'tipEscrowRefundable'
  | 'tipAdvanceRepayments'
  | 'tipQuarterlyDeadlines'
  | 'tipSettings';

export type DailyTipCandidate = { topic: DailyTipTopic; detail: Record<string, number | string> };

export const DAILY_TIP_VARIANT_COUNT = 3;

// Every topic here really does have exactly 3 phrasings — asserted by
// dailyTips.test.ts against the actual i18n content, not just assumed.
export const DAILY_TIP_CATEGORY: Record<DailyTipTopic, DailyTipCategory> = {
  tipTransactions: 'discovery',
  tipImport: 'discovery',
  tipLoads: 'discovery',
  tipSettlements: 'discovery',
  tipReimbursements: 'setup',
  tipOtherIncome: 'setup',
  tipFuel: 'money',
  tipMaintenance: 'discovery',
  tipTolls: 'money',
  tipDeductions: 'money',
  tipAssetRegister: 'setup',
  tipAccountantPackage: 'discovery',
  tipTaxEstimator: 'money',
  tipDocumentsRenewals: 'setup',
  tipDocuments: 'discovery',
  tipCategoryLearning: 'discovery',
  tipTruckCostBasis: 'setup',
  tipTruckDepreciation: 'setup',
  tipTruckAddTrailer: 'setup',
  tipTruckComparison: 'money',
  tipEquipment: 'setup',
  tipDrivers: 'setup',
  tipCapitalAccount: 'money',
  tipOperatingPnl: 'money',
  tipTruckHealth: 'discovery',
  tipCashFlow: 'money',
  tipScorecard: 'money',
  tipLoans: 'money',
  tipProfitAnalysis: 'money',
  tipAiCoachFull: 'discovery',
  tipDeadheadBenchmark: 'knowledge',
  tipPerDiemVsMeals: 'knowledge',
  tipRepairVsCapitalImprovement: 'knowledge',
  tipEscrowRefundable: 'knowledge',
  tipAdvanceRepayments: 'knowledge',
  tipQuarterlyDeadlines: 'knowledge',
  tipSettings: 'discovery',
};

export const DAILY_TIP_ROUTE: Record<DailyTipTopic, string> = {
  tipTransactions: '/(tabs)/transactions',
  tipImport: '/(tabs)/import',
  tipLoads: '/(tabs)/more/loads',
  tipSettlements: '/(tabs)/more/settlements',
  tipReimbursements: '/(tabs)/more/reimbursements',
  tipOtherIncome: '/(tabs)/more/other-income',
  tipFuel: '/(tabs)/more/fuel',
  tipMaintenance: '/(tabs)/more/maintenance',
  tipTolls: '/(tabs)/more/tolls',
  tipDeductions: '/(tabs)/deductions',
  tipAssetRegister: '/(tabs)/more/asset-register',
  tipAccountantPackage: '/(tabs)/more/accountant-package',
  tipTaxEstimator: '/(tabs)/more/tax-estimator',
  tipDocumentsRenewals: '/(tabs)/more/compliance',
  tipDocuments: '/(tabs)/more/documents',
  tipCategoryLearning: '/(tabs)/more/category-learning',
  tipTruckCostBasis: '/(tabs)/more/trucks',
  tipTruckDepreciation: '/(tabs)/more/trucks',
  tipTruckAddTrailer: '/(tabs)/more/trucks',
  tipTruckComparison: '/(tabs)/more/truck-comparison',
  tipEquipment: '/(tabs)/more/equipment',
  tipDrivers: '/(tabs)/more/drivers',
  tipCapitalAccount: '/(tabs)/more/capital-account',
  tipOperatingPnl: '/(tabs)/more/operating-pnl',
  tipTruckHealth: '/(tabs)/truck-health',
  tipCashFlow: '/(tabs)/more/cash-flow',
  tipScorecard: '/(tabs)/more/scorecard',
  tipLoans: '/(tabs)/more/loans',
  tipProfitAnalysis: '/(tabs)/more/profit-analysis',
  tipAiCoachFull: '/(tabs)/more/ceo-mode',
  tipDeadheadBenchmark: '/(tabs)/more/scorecard',
  tipPerDiemVsMeals: '/(tabs)/deductions',
  tipRepairVsCapitalImprovement: '/(tabs)/more/maintenance',
  tipEscrowRefundable: '/(tabs)/deductions',
  tipAdvanceRepayments: '/(tabs)/deductions',
  tipQuarterlyDeadlines: '/(tabs)/more/tax-estimator',
  tipSettings: '/(tabs)/more/settings',
};

export const DAILY_TIP_ICON: Record<DailyTipTopic, string> = {
  tipTransactions: '💳',
  tipImport: '➕',
  tipLoads: '🚛',
  tipSettlements: '📋',
  tipReimbursements: '↩️',
  tipOtherIncome: '💵',
  tipFuel: '⛽',
  tipMaintenance: '🔧',
  tipTolls: '🛣️',
  tipDeductions: '🧾',
  tipAssetRegister: '🗄️',
  tipAccountantPackage: '📁',
  tipTaxEstimator: '🧮',
  tipDocumentsRenewals: '🪪',
  tipDocuments: '🗃️',
  tipCategoryLearning: '🧠',
  tipTruckCostBasis: '🚚',
  tipTruckDepreciation: '📉',
  tipTruckAddTrailer: '🚛',
  tipTruckComparison: '📊',
  tipEquipment: '🛠️',
  tipDrivers: '🧑‍✈️',
  tipCapitalAccount: '💰',
  tipOperatingPnl: '📊',
  tipTruckHealth: '🚛',
  tipCashFlow: '🏦',
  tipScorecard: '🏆',
  tipLoans: '📄',
  tipProfitAnalysis: '📈',
  tipAiCoachFull: '🧑‍✈️',
  tipDeadheadBenchmark: '🗺️',
  tipPerDiemVsMeals: '🍽️',
  tipRepairVsCapitalImprovement: '🔩',
  tipEscrowRefundable: '🔒',
  tipAdvanceRepayments: '💸',
  tipQuarterlyDeadlines: '📅',
  tipSettings: '⚙️',
};

// ---------------------------------------------------------------------------
// DETECTORS — each takes minimal, already-fetched row shapes (Pick<...>,
// never a full DB row type) so this stays trivially unit-testable with
// plain fixture objects, same convention as missingDataNudges.ts/
// periodicCoachNudges.ts. Every detector returns null the instant its
// precondition stops holding — this IS the "a tip disappears entirely once
// the thing it teaches is done" behavior, with no separate code path.
// ---------------------------------------------------------------------------

export function detectTipTransactions(totalRows: number): DailyTipCandidate | null {
  return totalRows >= 10 ? { topic: 'tipTransactions', detail: { count: totalRows } } : null;
}

export function detectTipImport(documentsCount: number): DailyTipCandidate | null {
  return documentsCount >= 3 ? { topic: 'tipImport', detail: {} } : null;
}

export function detectTipLoads(settlementsCount: number, loadsCount: number): DailyTipCandidate | null {
  return settlementsCount >= 2 && loadsCount < settlementsCount ? { topic: 'tipLoads', detail: {} } : null;
}

export function detectTipSettlements(settlementsCount: number, settlementsMissingMilesCount: number): DailyTipCandidate | null {
  if (settlementsMissingMilesCount > 0) return { topic: 'tipSettlements', detail: { count: settlementsMissingMilesCount } };
  if (settlementsCount > 0 && settlementsCount < 3) return { topic: 'tipSettlements', detail: {} };
  return null;
}

export function detectTipReimbursements(settlementsCount: number, reimbursementsCount: number): DailyTipCandidate | null {
  return settlementsCount >= 5 && reimbursementsCount === 0 ? { topic: 'tipReimbursements', detail: {} } : null;
}

export function detectTipOtherIncome(settlementsCount: number, miscIncomeCount: number): DailyTipCandidate | null {
  return settlementsCount >= 3 && miscIncomeCount === 0 ? { topic: 'tipOtherIncome', detail: {} } : null;
}

export function detectTipFuel(fuelPctOfRevenue: number | null): DailyTipCandidate | null {
  if (fuelPctOfRevenue == null) return null;
  return { topic: 'tipFuel', detail: { pct: Math.round(fuelPctOfRevenue * 1000) / 10 } };
}

export function detectTipMaintenance(dueSoonOrOverdueCount: number, maintenanceRecordsCount: number): DailyTipCandidate | null {
  if (dueSoonOrOverdueCount > 0) return { topic: 'tipMaintenance', detail: { count: dueSoonOrOverdueCount } };
  return maintenanceRecordsCount === 0 ? { topic: 'tipMaintenance', detail: {} } : null;
}

export function detectTipTolls(tollsCount: number, settlementsCount: number): DailyTipCandidate | null {
  return tollsCount === 0 && settlementsCount >= 3 ? { topic: 'tipTolls', detail: {} } : null;
}

export function detectTipDeductions(needsReviewCount: number): DailyTipCandidate | null {
  return needsReviewCount > 0 ? { topic: 'tipDeductions', detail: { count: needsReviewCount } } : null;
}

export function detectTipAssetRegister(equipmentCount: number, trucksWithPurchasePriceCount: number): DailyTipCandidate | null {
  return equipmentCount === 0 && trucksWithPurchasePriceCount === 0 ? { topic: 'tipAssetRegister', detail: {} } : null;
}

export function detectTipAccountantPackage(weeksOfHistory: number, quarterlyDeadlineDaysUntil: number | null): DailyTipCandidate | null {
  if (quarterlyDeadlineDaysUntil != null && quarterlyDeadlineDaysUntil >= 0 && quarterlyDeadlineDaysUntil <= 14) {
    return { topic: 'tipAccountantPackage', detail: { days: quarterlyDeadlineDaysUntil } };
  }
  return weeksOfHistory >= 4 ? { topic: 'tipAccountantPackage', detail: {} } : null;
}

export function detectTipTaxEstimator(hasTaxConfig: boolean, weeklyReserve: number | null, quarterlyDaysUntil: number | null): DailyTipCandidate | null {
  if (!hasTaxConfig) return null;
  const detail: Record<string, number> = {};
  if (weeklyReserve != null && weeklyReserve > 0) detail.reserve = Math.round(weeklyReserve);
  if (quarterlyDaysUntil != null && quarterlyDaysUntil >= 0) detail.days = quarterlyDaysUntil;
  return { topic: 'tipTaxEstimator', detail };
}

export function detectTipDocumentsRenewals(complianceItemsCount: number): DailyTipCandidate | null {
  return complianceItemsCount === 0 ? { topic: 'tipDocumentsRenewals', detail: {} } : null;
}

export function detectTipDocuments(documentsCount: number): DailyTipCandidate | null {
  return documentsCount >= 5 ? { topic: 'tipDocuments', detail: { count: documentsCount } } : null;
}

export function detectTipCategoryLearning(learningRulesCount: number): DailyTipCandidate | null {
  return learningRulesCount >= 1 ? { topic: 'tipCategoryLearning', detail: { count: learningRulesCount } } : null;
}

export function detectTipTruckCostBasis(trucksWithoutCostBasisCount: number): DailyTipCandidate | null {
  return trucksWithoutCostBasisCount > 0 ? { topic: 'tipTruckCostBasis', detail: { count: trucksWithoutCostBasisCount } } : null;
}

export function detectTipTruckDepreciation(trucksWithoutDepreciationCount: number, previewTotal: number | null): DailyTipCandidate | null {
  if (trucksWithoutDepreciationCount === 0) return null;
  const detail: Record<string, number> = { count: trucksWithoutDepreciationCount };
  if (previewTotal != null && previewTotal > 0) detail.previewTotal = Math.round(previewTotal);
  return { topic: 'tipTruckDepreciation', detail };
}

export function detectTipTruckAddTrailer(trucksCount: number, anyTruckHasTrailer: boolean): DailyTipCandidate | null {
  return trucksCount >= 1 && !anyTruckHasTrailer ? { topic: 'tipTruckAddTrailer', detail: {} } : null;
}

export function detectTipTruckComparison(trucksCount: number): DailyTipCandidate | null {
  return trucksCount >= 2 ? { topic: 'tipTruckComparison', detail: {} } : null;
}

export function detectTipEquipment(equipmentCount: number, accountAgeDays: number): DailyTipCandidate | null {
  return equipmentCount === 0 && accountAgeDays >= 14 ? { topic: 'tipEquipment', detail: {} } : null;
}

export function detectTipDrivers(driversCount: number, driverPaymentsCount: number): DailyTipCandidate | null {
  return driversCount === 0 || (driversCount > 0 && driverPaymentsCount === 0) ? { topic: 'tipDrivers', detail: {} } : null;
}

// REMOVE BUSINESS BALANCE TRACKING (owner decision 2026-08-27) — this
// used to also gate on businessBalance > 0; that column is now
// permanently frozen (nothing writes it anymore), so it was dropped
// entirely rather than left as a stale, increasingly-meaningless trigger
// — initialCapital alone (real contributions on file) is still a live,
// correctly-computed signal worth nudging on.
export function detectTipCapitalAccount(initialCapital: number, taxFreeRemaining: number | null): DailyTipCandidate | null {
  if (initialCapital <= 0) return null;
  const detail: Record<string, number> = {};
  if (taxFreeRemaining != null && taxFreeRemaining > 0) detail.remaining = Math.round(taxFreeRemaining);
  return { topic: 'tipCapitalAccount', detail };
}

export function detectTipOperatingPnl(weeksOfHistory: number): DailyTipCandidate | null {
  return weeksOfHistory >= 4 ? { topic: 'tipOperatingPnl', detail: {} } : null;
}

export function detectTipTruckHealth(activeTruckMaintenanceRecordsCount: number): DailyTipCandidate | null {
  return activeTruckMaintenanceRecordsCount === 0 ? { topic: 'tipTruckHealth', detail: {} } : null;
}

export function detectTipCashFlow(distinctSettlementWeeks: number): DailyTipCandidate | null {
  return distinctSettlementWeeks >= 3 ? { topic: 'tipCashFlow', detail: {} } : null;
}

export function detectTipScorecard(settlementsWithMilesCount: number): DailyTipCandidate | null {
  return settlementsWithMilesCount >= 1 ? { topic: 'tipScorecard', detail: {} } : null;
}

export function detectTipLoans(loansCount: number): DailyTipCandidate | null {
  return loansCount >= 1 ? { topic: 'tipLoans', detail: {} } : null;
}

export function detectTipProfitAnalysis(weeksOfHistory: number): DailyTipCandidate | null {
  return weeksOfHistory >= 8 ? { topic: 'tipProfitAnalysis', detail: {} } : null;
}

export function detectTipAiCoachFull(accountAgeDays: number): DailyTipCandidate | null {
  return accountAgeDays >= 7 ? { topic: 'tipAiCoachFull', detail: {} } : null;
}

export function detectTipDeadheadBenchmark(deadheadPct: number | null): DailyTipCandidate | null {
  if (deadheadPct == null) return null;
  return { topic: 'tipDeadheadBenchmark', detail: { pct: Math.round(deadheadPct * 1000) / 10 } };
}

export function detectTipPerDiemVsMeals(perDiemDaysYtd: number): DailyTipCandidate | null {
  return perDiemDaysYtd > 0 ? { topic: 'tipPerDiemVsMeals', detail: { days: perDiemDaysYtd } } : null;
}

export function detectTipRepairVsCapitalImprovement(accountAgeDays: number): DailyTipCandidate | null {
  return accountAgeDays >= 14 ? { topic: 'tipRepairVsCapitalImprovement', detail: {} } : null;
}

export function detectTipEscrowRefundable(escrowDeductionsCount: number): DailyTipCandidate | null {
  return escrowDeductionsCount > 0 ? { topic: 'tipEscrowRefundable', detail: {} } : null;
}

export function detectTipAdvanceRepayments(advanceRepaymentDeductionsCount: number): DailyTipCandidate | null {
  return advanceRepaymentDeductionsCount > 0 ? { topic: 'tipAdvanceRepayments', detail: {} } : null;
}

export function detectTipQuarterlyDeadlines(quarterlyDaysUntil: number | null): DailyTipCandidate | null {
  if (quarterlyDaysUntil == null || quarterlyDaysUntil < 0 || quarterlyDaysUntil > 14) return null;
  return { topic: 'tipQuarterlyDeadlines', detail: { days: quarterlyDaysUntil } };
}

export function detectTipSettings(accountAgeDays: number): DailyTipCandidate | null {
  return accountAgeDays >= 21 ? { topic: 'tipSettings', detail: {} } : null;
}

// Every field is OPTIONAL, "the caller doesn't know yet" (skip that
// detector), same convention as missingDataNudges.ts's own aggregator —
// never a false positive from a field the caller simply didn't pass.
export type DailyTipBuilderInput = {
  totalRows?: number;
  documentsCount?: number;
  settlementsCount?: number;
  loadsCount?: number;
  settlementsMissingMilesCount?: number;
  reimbursementsCount?: number;
  miscIncomeCount?: number;
  fuelPctOfRevenue?: number | null;
  dueSoonOrOverdueMaintenanceCount?: number;
  maintenanceRecordsCount?: number;
  tollsCount?: number;
  needsReviewCount?: number;
  equipmentCount?: number;
  trucksWithPurchasePriceCount?: number;
  weeksOfHistory?: number;
  quarterlyDeadlineDaysUntil?: number | null;
  accountAgeDays?: number;
  hasTaxConfig?: boolean;
  weeklyTaxReserve?: number | null;
  complianceItemsCount?: number;
  learningRulesCount?: number;
  trucksWithoutCostBasisCount?: number;
  trucksWithoutDepreciationCount?: number;
  depreciationPreviewTotal?: number | null;
  trucksCount?: number;
  anyTruckHasTrailer?: boolean;
  driversCount?: number;
  driverPaymentsCount?: number;
  initialCapital?: number;
  taxFreeRemaining?: number | null;
  activeTruckMaintenanceRecordsCount?: number;
  distinctSettlementWeeks?: number;
  settlementsWithMilesCount?: number;
  loansCount?: number;
  deadheadPct?: number | null;
  perDiemDaysYtd?: number;
  escrowDeductionsCount?: number;
  advanceRepaymentDeductionsCount?: number;
};

export function buildDailyTipCandidates(input: DailyTipBuilderInput): DailyTipCandidate[] {
  const candidates: (DailyTipCandidate | null)[] = [];
  if (input.totalRows !== undefined) candidates.push(detectTipTransactions(input.totalRows));
  if (input.documentsCount !== undefined) {
    candidates.push(detectTipImport(input.documentsCount));
    candidates.push(detectTipDocuments(input.documentsCount));
  }
  if (input.settlementsCount !== undefined && input.loadsCount !== undefined) candidates.push(detectTipLoads(input.settlementsCount, input.loadsCount));
  if (input.settlementsCount !== undefined && input.settlementsMissingMilesCount !== undefined)
    candidates.push(detectTipSettlements(input.settlementsCount, input.settlementsMissingMilesCount));
  if (input.settlementsCount !== undefined && input.reimbursementsCount !== undefined)
    candidates.push(detectTipReimbursements(input.settlementsCount, input.reimbursementsCount));
  if (input.settlementsCount !== undefined && input.miscIncomeCount !== undefined)
    candidates.push(detectTipOtherIncome(input.settlementsCount, input.miscIncomeCount));
  if (input.fuelPctOfRevenue !== undefined) candidates.push(detectTipFuel(input.fuelPctOfRevenue));
  if (input.dueSoonOrOverdueMaintenanceCount !== undefined && input.maintenanceRecordsCount !== undefined)
    candidates.push(detectTipMaintenance(input.dueSoonOrOverdueMaintenanceCount, input.maintenanceRecordsCount));
  if (input.tollsCount !== undefined && input.settlementsCount !== undefined) candidates.push(detectTipTolls(input.tollsCount, input.settlementsCount));
  if (input.needsReviewCount !== undefined) candidates.push(detectTipDeductions(input.needsReviewCount));
  if (input.equipmentCount !== undefined && input.trucksWithPurchasePriceCount !== undefined)
    candidates.push(detectTipAssetRegister(input.equipmentCount, input.trucksWithPurchasePriceCount));
  if (input.weeksOfHistory !== undefined)
    candidates.push(detectTipAccountantPackage(input.weeksOfHistory, input.quarterlyDeadlineDaysUntil ?? null));
  if (input.hasTaxConfig !== undefined)
    candidates.push(detectTipTaxEstimator(input.hasTaxConfig, input.weeklyTaxReserve ?? null, input.quarterlyDeadlineDaysUntil ?? null));
  if (input.complianceItemsCount !== undefined) candidates.push(detectTipDocumentsRenewals(input.complianceItemsCount));
  if (input.learningRulesCount !== undefined) candidates.push(detectTipCategoryLearning(input.learningRulesCount));
  if (input.trucksWithoutCostBasisCount !== undefined) candidates.push(detectTipTruckCostBasis(input.trucksWithoutCostBasisCount));
  if (input.trucksWithoutDepreciationCount !== undefined)
    candidates.push(detectTipTruckDepreciation(input.trucksWithoutDepreciationCount, input.depreciationPreviewTotal ?? null));
  if (input.trucksCount !== undefined && input.anyTruckHasTrailer !== undefined)
    candidates.push(detectTipTruckAddTrailer(input.trucksCount, input.anyTruckHasTrailer));
  if (input.trucksCount !== undefined) candidates.push(detectTipTruckComparison(input.trucksCount));
  if (input.equipmentCount !== undefined && input.accountAgeDays !== undefined) candidates.push(detectTipEquipment(input.equipmentCount, input.accountAgeDays));
  if (input.driversCount !== undefined && input.driverPaymentsCount !== undefined)
    candidates.push(detectTipDrivers(input.driversCount, input.driverPaymentsCount));
  if (input.initialCapital !== undefined)
    candidates.push(detectTipCapitalAccount(input.initialCapital, input.taxFreeRemaining ?? null));
  if (input.weeksOfHistory !== undefined) candidates.push(detectTipOperatingPnl(input.weeksOfHistory));
  if (input.activeTruckMaintenanceRecordsCount !== undefined) candidates.push(detectTipTruckHealth(input.activeTruckMaintenanceRecordsCount));
  if (input.distinctSettlementWeeks !== undefined) candidates.push(detectTipCashFlow(input.distinctSettlementWeeks));
  if (input.settlementsWithMilesCount !== undefined) candidates.push(detectTipScorecard(input.settlementsWithMilesCount));
  if (input.loansCount !== undefined) candidates.push(detectTipLoans(input.loansCount));
  if (input.weeksOfHistory !== undefined) candidates.push(detectTipProfitAnalysis(input.weeksOfHistory));
  if (input.accountAgeDays !== undefined) candidates.push(detectTipAiCoachFull(input.accountAgeDays));
  if (input.deadheadPct !== undefined) candidates.push(detectTipDeadheadBenchmark(input.deadheadPct));
  if (input.perDiemDaysYtd !== undefined) candidates.push(detectTipPerDiemVsMeals(input.perDiemDaysYtd));
  if (input.accountAgeDays !== undefined) candidates.push(detectTipRepairVsCapitalImprovement(input.accountAgeDays));
  if (input.escrowDeductionsCount !== undefined) candidates.push(detectTipEscrowRefundable(input.escrowDeductionsCount));
  if (input.advanceRepaymentDeductionsCount !== undefined) candidates.push(detectTipAdvanceRepayments(input.advanceRepaymentDeductionsCount));
  if (input.quarterlyDeadlineDaysUntil !== undefined) candidates.push(detectTipQuarterlyDeadlines(input.quarterlyDeadlineDaysUntil));
  if (input.accountAgeDays !== undefined) candidates.push(detectTipSettings(input.accountAgeDays));
  return candidates.filter((c): c is DailyTipCandidate => c !== null);
}

// SCREEN COVERAGE MAP (owner decision, Part 2 Step 1's own explicit
// requirement — "a test FAILS when a new screen enters the nav registry
// without either a tip or an explicit 'intentionally none' entry") — one
// entry per nav-registry href. `src/alerts/__tests__/dailyTips.test.ts`
// asserts every href in navRegistry.ts's RAW_NAV_GROUPS appears here.
// Trucks routes to tipTruckCostBasis as its PRIMARY topic — two more
// topics (tipTruckDepreciation, tipTruckAddTrailer) also live on that same
// screen and share its route, they just aren't this map's one-per-href
// value (the map is about registry COVERAGE, not an exhaustive topic
// list — see DAILY_TIP_ROUTE above for the full topic->route table).
export type DailyTipCoverageEntry = DailyTipTopic | 'intentionalNone';

export const DAILY_TIP_SCREEN_COVERAGE: Record<string, DailyTipCoverageEntry> = {
  '/(tabs)': 'intentionalNone', // Home — this is where tips render, a tip about itself would be circular
  '/(tabs)/transactions': 'tipTransactions',
  '/(tabs)/import': 'tipImport',
  '/(tabs)/more/loads': 'tipLoads',
  '/(tabs)/more/settlements': 'tipSettlements',
  '/(tabs)/more/reimbursements': 'tipReimbursements',
  '/(tabs)/more/other-income': 'tipOtherIncome',
  '/(tabs)/more/fuel': 'tipFuel',
  '/(tabs)/more/maintenance': 'tipMaintenance',
  '/(tabs)/more/tolls': 'tipTolls',
  '/(tabs)/deductions': 'tipDeductions',
  '/(tabs)/more/asset-register': 'tipAssetRegister',
  '/(tabs)/more/accountant-package': 'tipAccountantPackage',
  '/(tabs)/more/tax-estimator': 'tipTaxEstimator',
  '/(tabs)/more/compliance': 'tipDocumentsRenewals',
  '/(tabs)/more/documents': 'tipDocuments',
  '/(tabs)/more/category-learning': 'tipCategoryLearning',
  '/(tabs)/more/referral': 'intentionalNone', // milestone-triggered (src/referral/referralNudge.ts), not part of the daily rotation
  '/(tabs)/more/data-cleanup': 'intentionalNone', // one-time historical repair tool (docs/PENDING_SQL.md §70) — nothing to nudge about day to day
  '/(tabs)/more/trucks': 'tipTruckCostBasis',
  '/(tabs)/more/truck-comparison': 'tipTruckComparison',
  '/(tabs)/more/equipment': 'tipEquipment',
  '/(tabs)/more/drivers': 'tipDrivers',
  '/(tabs)/more/capital-account': 'tipCapitalAccount',
  '/(tabs)/more/operating-pnl': 'tipOperatingPnl',
  '/(tabs)/truck-health': 'tipTruckHealth',
  '/(tabs)/more/cash-flow': 'tipCashFlow',
  '/(tabs)/more/scorecard': 'tipScorecard',
  '/(tabs)/more/loans': 'tipLoans',
  '/(tabs)/more/credit-cards': 'intentionalNone', // feature-flagged off (FEATURE_FLAGS.bankCreditCards), not reachable in the live app
  '/(tabs)/more/bank-statements': 'intentionalNone', // feature-flagged off (FEATURE_FLAGS.bankCreditCards), not reachable in the live app
  '/(tabs)/more/profit-analysis': 'tipProfitAnalysis',
  '/(tabs)/more/ceo-mode': 'tipAiCoachFull',
  '/(tabs)/more/settings': 'tipSettings',
};

// ---------------------------------------------------------------------------
// ROTATION ENGINE
// ---------------------------------------------------------------------------

export const DAILY_TIP_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // "no topic repeats within a month"

function isEligible(topic: DailyTipTopic, state: NudgeState<DailyTipTopic>, now: Date): boolean {
  const entry = state[topic];
  if (entry?.silencedAt) return false;
  if (entry?.lastShownAt) {
    const lastShownMs = new Date(entry.lastShownAt).getTime();
    if (now.getTime() - lastShownMs < DAILY_TIP_COOLDOWN_MS) return false;
  }
  return true;
}

// DIAGNOSTICS (owner decision, device report: "daily tip never appears...
// this can never be invisible again") — one exhaustive, pure pass over
// EVERY topic in the system (not just the ones that happened to become
// candidates), reporting exactly why each one is or isn't currently
// eligible. Used by useDailyTip()'s own dev-only console logging and by
// Settings' dev-only diagnostic panel — both read from this SAME function
// so they can never disagree about the count/reasons shown.
export type DailyTipDiagnosticReason = 'precondition_not_met' | 'silenced' | 'cooldown' | 'eligible';
export type DailyTipDiagnosticEntry = { topic: DailyTipTopic; reason: DailyTipDiagnosticReason };

export function buildDailyTipDiagnostics(
  candidates: DailyTipCandidate[],
  state: NudgeState<DailyTipTopic>,
  now: Date = new Date()
): DailyTipDiagnosticEntry[] {
  const candidateTopics = new Set(candidates.map((c) => c.topic));
  const allTopics = Object.keys(DAILY_TIP_CATEGORY) as DailyTipTopic[];
  return allTopics.map((topic) => {
    if (!candidateTopics.has(topic)) return { topic, reason: 'precondition_not_met' };
    const entry = state[topic];
    if (entry?.silencedAt) return { topic, reason: 'silenced' };
    if (!isEligible(topic, state, now)) return { topic, reason: 'cooldown' };
    return { topic, reason: 'eligible' };
  });
}

// The categories of whichever topics were shown on the 2 most-recent
// distinct prior days (by lastShownAt), most-recent first — used to avoid
// a 3rd consecutive same-category day. Two SAME-DAY entries (shouldn't
// normally happen, only ever one tip/day) collapse to one.
function recentCategories(state: NudgeState<DailyTipTopic>): DailyTipCategory[] {
  const shown = (Object.entries(state) as [DailyTipTopic, NudgeStateEntry | undefined][])
    .filter(([, entry]) => entry?.lastShownAt)
    .sort((a, b) => new Date(b[1]!.lastShownAt!).getTime() - new Date(a[1]!.lastShownAt!).getTime());
  const days: string[] = [];
  const cats: DailyTipCategory[] = [];
  for (const [topic, entry] of shown) {
    const day = entry!.lastShownAt!.slice(0, 10);
    if (days.includes(day)) continue;
    days.push(day);
    cats.push(DAILY_TIP_CATEGORY[topic]);
    if (days.length >= 2) break;
  }
  return cats;
}

// BUG FIX (owner decision, device report: "daily tip never appears,"
// most important for a brand-new/EMPTY account): this used to unconditionally
// return null for the entire first 24 hours after signup ("never on day
// one"), regardless of how many real, evergreen getting-started candidates
// existed (tipMaintenance/tipAssetRegister/tipDocumentsRenewals/tipDrivers/
// tipTruckHealth all fire immediately for a truly empty account — see each
// one's own detector above, none of them require any account age at all).
// Since onboarding (ToS + tutorial + the setup wizard) already gates entry
// to Home behind several screens, there is no literal "mid-signup-flow"
// instant left to protect against by the time a user ever SEES this card —
// "day one" for this app already means "the user's first real session,"
// which is exactly when a getting-started tip is most valuable, not least.
// This is a deliberate reversal of the original "never on day one" design
// decision, per an explicit, later, overriding owner instruction — an
// empty/new account must see a tip on first launch, not 24 hours later.
// `accountCreatedAt` is kept as a parameter (unused in the body) rather
// than removed, so a future caller that still wants to pass it doesn't
// need a signature change, and so the historical intent stays visible in
// the type even though nothing gates on it anymore.

// Picks the ONE tip to show today, or null if nothing is eligible right
// now (e.g. every real, computable candidate's own precondition was
// satisfied already, or everything is still on cooldown/silenced).
export function selectDailyTip(
  candidates: DailyTipCandidate[],
  state: NudgeState<DailyTipTopic>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  accountCreatedAt: string | null,
  now: Date = new Date()
): DailyTipCandidate | null {
  const eligible = candidates.filter((c) => isEligible(c.topic, state, now));
  if (eligible.length === 0) return null;

  const last2Categories = recentCategories(state);
  const avoidCategory = last2Categories.length === 2 && last2Categories[0] === last2Categories[1] ? last2Categories[0] : null;
  const varied = avoidCategory ? eligible.filter((c) => DAILY_TIP_CATEGORY[c.topic] !== avoidCategory) : eligible;
  const pool = varied.length > 0 ? varied : eligible; // never block entirely if variety isn't possible

  function lastShownMs(topic: DailyTipTopic): number {
    const at = state[topic]?.lastShownAt;
    return at ? new Date(at).getTime() : -Infinity;
  }
  return pool.reduce((oldest, c) => (lastShownMs(c.topic) < lastShownMs(oldest.topic) ? c : oldest), pool[0]);
}

// STICKY ANCHOR (owner decision, bug fix — "flash and vanish"): a topic's
// own `isEligible()` check treats "shown within the last 30 days" as
// ineligible — which includes TODAY itself, the instant it's recorded.
// The original hook re-ran `selectDailyTip()` on every recompute
// (including once real data replaced still-loading default/zero values),
// which meant the moment today's pick got persisted, the VERY NEXT
// recompute excluded it (already "shown," per that same 30-day rule) and
// silently swapped in a different topic — or nothing, if none other was
// eligible. That's the flash: the card would render one tip for a
// frame, then a re-render (data settling in, or the just-completed
// record itself) would compute a DIFFERENT `selected` value.
//
// The fix: never re-derive "today's tip" from a live recomputation of
// `selectDailyTip()`. Once a topic has been recorded as shown TODAY (and
// not since dismissed), that recorded fact is authoritative — reconstruct
// it directly from persisted state, which is stable no matter how many
// times the surrounding data refetches or the component re-renders.
// `selectDailyTip()` itself is still exactly right for picking each NEW
// entry (the first one of the day, or one picked by "show me another") —
// this function is what makes an ALREADY-picked entry stick.
//
// Picks the EARLIEST-shown-today, non-silenced entry — "show me another"
// records each additional tip with a LATER same-day timestamp than the
// original, so a fresh render/reload always reconstructs the ORIGINAL
// daily pick, never whatever the user last manually browsed to (that
// browsing is session-only UI state, intentionally not itself sticky).
export function findTodaysAnchorTip(state: NudgeState<DailyTipTopic>, now: Date = new Date()): DailyTipTopic | null {
  const today = now.toISOString().slice(0, 10);
  let best: { topic: DailyTipTopic; at: number } | null = null;
  for (const [topic, entry] of Object.entries(state) as [DailyTipTopic, NudgeStateEntry | undefined][]) {
    if (!entry?.lastShownAt || entry.silencedAt) continue;
    if (entry.lastShownAt.slice(0, 10) !== today) continue;
    const at = new Date(entry.lastShownAt).getTime();
    if (!best || at < best.at) best = { topic, at };
  }
  return best?.topic ?? null;
}

// Cycles 0 -> 1 -> 2 -> 0 -> ... in order — every phrasing is used once
// before any repeats.
export function selectDailyTipVariant(topic: DailyTipTopic, state: NudgeState<DailyTipTopic>): number {
  const previous = state[topic]?.variantIndex;
  if (previous == null) return 0;
  return (previous + 1) % DAILY_TIP_VARIANT_COUNT;
}

export function recordDailyTipShown(
  state: NudgeState<DailyTipTopic>,
  topic: DailyTipTopic,
  variantIndex: number,
  now: Date = new Date()
): NudgeState<DailyTipTopic> {
  return { ...state, [topic]: { lastShownAt: now.toISOString(), silencedAt: state[topic]?.silencedAt ?? null, variantIndex } };
}

export function dismissDailyTip(state: NudgeState<DailyTipTopic>, topic: DailyTipTopic, now: Date = new Date()): NudgeState<DailyTipTopic> {
  return { ...state, [topic]: { lastShownAt: state[topic]?.lastShownAt ?? null, silencedAt: now.toISOString(), variantIndex: state[topic]?.variantIndex } };
}

// The i18n interpolation params for `dailyTips.${topic}.v${variant}` —
// centralized so a new real-number field added to a detector's detail
// only needs formatting logic written once, same unlockNudgeParams()
// convention. `count`/`days` are only included when actually present —
// i18next auto-applies plural-suffix resolution to any key called with a
// `count` param, even one that was never meant to pluralize.
export function dailyTipParams(c: DailyTipCandidate, money: (amount: number) => string, pct: (fraction: number) => string): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (typeof c.detail.count === 'number') params.count = c.detail.count;
  if (typeof c.detail.days === 'number') params.days = c.detail.days;
  if (typeof c.detail.pct === 'number') params.pct = pct(c.detail.pct / 100);
  if (typeof c.detail.reserve === 'number') params.reserve = money(c.detail.reserve);
  if (typeof c.detail.previewTotal === 'number') params.previewTotal = money(c.detail.previewTotal);
  if (typeof c.detail.remaining === 'number') params.remaining = money(c.detail.remaining);
  return params;
}

export function dailyTipText(
  c: DailyTipCandidate,
  variantIndex: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
  money: (amount: number) => string,
  pct: (fraction: number) => string
): string {
  return t(`dailyTips.${c.topic}.v${variantIndex}`, dailyTipParams(c, money, pct));
}
