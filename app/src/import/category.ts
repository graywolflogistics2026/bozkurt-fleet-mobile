// Verbatim ports from legacy/index.html — do not "clean up" the regexes,
// they encode months of real-receipt tuning (see CLAUDE.md: port battle-
// tuned logic verbatim). Category LABELS were renamed/expanded 2026-07-10
// (industry knowledge base, PRODUCT DECISION — docs/INDUSTRY_TAXONOMY.md is
// the single source of truth for this taxonomy; change it there first).

// Re-exported for backward compatibility — the 9-generic-value payment
// method logic (owner decision 2026-07-07, CLAUDE.md invariant #2) now
// lives in paymentMethods.ts alongside normalizePaymentMethod().
export { isPersonalPayment } from '@/src/import/paymentMethods';
import type { UserCategory, UserCategoryInsert } from '@/src/types/db';

// docs/INDUSTRY_TAXONOMY.md §B — the ONE shared category constant every
// screen/dropdown/guesser reads from (industry knowledge base, owner
// decision 2026-07-10, PRODUCT DECISION). Renamed from the smaller
// pre-2026-07-10 DED_CATEGORIES list — old category strings already saved
// on existing rows are untouched (free text, no DB migration; see
// docs/INDUSTRY_TAXONOMY.md's "old app categories fold in as" mapping).
// 'Other' stays last — manual-entry / low-confidence catch-all, never
// auto-assigned by guessCategory().
export const CANONICAL_CATEGORIES = [
  'Fuel & DEF',
  'Maintenance & Repairs',
  'Tires',
  'Truck/Trailer Payments',
  'Insurance—Truck',
  'Insurance—Health',
  'Permits, Licenses & Road Taxes',
  'Tolls & Scales',
  'Parking & Lodging',
  'ELD & Communications',
  'Software & Subscriptions',
  'Dispatch & Factoring Fees',
  'Professional Services',
  'Office & Admin',
  'Safety Gear & Workwear',
  'Truck Supplies & Equipment',
  'Tools & Equipment',
  'Electronics',
  'Comfort & Sleeper',
  'Contract Labor (1099)',
  'Wages & Payroll Taxes (W-2)',
  'Bank & Merchant Fees',
  'Advertising',
  'Training & Education',
  'Association Dues',
  'Lease & Rent',
  'Utilities & Subscriptions',
  'Misc',
  'Other',
] as const;

// docs/INDUSTRY_TAXONOMY.md §A chargeback_type enum → a display category
// for the settlement-withheld deduction row (app/src/import/mapExtraction.ts
// mapSettlement()). These rows are NEVER counted as tax deductions
// (CLAUDE.md invariant #1, net-pay model) — the category is purely
// informational/organizational for the Deductions screen's "Withheld from
// Settlement" section.
export const CHARGEBACK_CATEGORY_LABEL: Record<string, string> = {
  fuel_advance: 'Fuel & DEF',
  insurance_bobtail: 'Insurance—Truck',
  insurance_physical_damage: 'Insurance—Truck',
  insurance_occ_acc: 'Insurance—Truck',
  insurance_cargo: 'Insurance—Truck',
  insurance_workers_comp: 'Insurance—Truck',
  eld_communications: 'ELD & Communications',
  plates_permits: 'Permits, Licenses & Road Taxes',
  escrow_reserve: 'Misc',
  lease_purchase_payment: 'Truck/Trailer Payments',
  trailer_fee: 'Lease & Rent',
  cash_advance: 'Misc',
  loan_payment: 'Truck/Trailer Payments',
  drug_consortium: 'Professional Services',
  tolls_transponder: 'Tolls & Scales',
  admin_processing_fee: 'Bank & Merchant Fees',
  factoring_fee: 'Dispatch & Factoring Fees',
  dispatch_fee: 'Dispatch & Factoring Fees',
  other_chargeback: 'Misc',
};

// docs/PENDING_SQL.md §21 (custom categories, owner decision 2026-07-10,
// PRODUCT DECISION) — pure logic lives here (no React/Supabase deps, unit
// testable) rather than in app/src/data/userCategories.ts, which just
// re-exports these alongside the entityHooks-based CRUD hooks (same split
// as app/src/tax/driverPayroll.ts vs app/src/data/driverPayments.ts).
// Tax safety rail: a custom EXPENSE category must always resolve to a
// Schedule C bucket so it can never silently fall out of the P&L/tax
// estimate — also enforced by a DB check constraint, this is just the
// app-side default so the UI doesn't have to ask every time. Custom
// INCOME categories never carry a bucket — they roll straight into gross
// income.
export const DEFAULT_SCHEDULE_C_BUCKET = 'Misc';

export function applyScheduleCDefault(values: UserCategoryInsert): UserCategoryInsert {
  if (values.kind !== 'expense') return { ...values, schedule_c_bucket: null };
  return { ...values, schedule_c_bucket: values.schedule_c_bucket || DEFAULT_SCHEDULE_C_BUCKET };
}

// Merges CANONICAL_CATEGORIES with the user's own active custom categories
// for a given kind — the ONE place every category picker should read its
// option list from (deduction edit, manual add, import preview —
// PROMPTS.md Session 9a), rather than hand-rolling the merge per screen.
// CANONICAL_CATEGORIES is expense-oriented (there is no canonical income
// category list yet — income is currently just settlement gross/net, not
// categorized), so 'income' only ever returns the user's own custom income
// categories.
export function mergeCategoryOptions(kind: 'income' | 'expense', customCategories: UserCategory[]): string[] {
  const activeNames = customCategories.filter((c) => c.active && c.kind === kind).map((c) => c.name);
  if (kind !== 'expense') return activeNames;
  const canonical: readonly string[] = CANONICAL_CATEGORIES;
  return [...CANONICAL_CATEGORIES, ...activeNames.filter((name) => !canonical.includes(name))];
}

const STORE_CATS: Record<string, string | null> = {
  amazon: null,
  walmart: 'Misc',
  'home depot': 'Truck Supplies & Equipment',
  lowes: 'Truck Supplies & Equipment',
  'harbor freight': 'Tools & Equipment',
  autozone: 'Tools & Equipment',
  oreilly: 'Tools & Equipment',
  napa: 'Tools & Equipment',
};

// legacy/index.html:2474 guessCategory() — expanded 2026-07-10 (industry
// knowledge base) with brand hints (docs/INDUSTRY_TAXONOMY.md §C) and new
// canonical categories, ahead of the original legacy branches so an
// unambiguous brand name (e.g. "Comdata", "OOIDA") is never swallowed by a
// more generic later check.
export function guessCategory(name: string | undefined, store: string | undefined): string {
  const n = (name ?? '').toLowerCase();
  const s = (store ?? '').toLowerCase();
  const combined = n + ' ' + s;

  if (/comdata|efs\b|fuelman|fuel card|def\b|diesel exhaust fluid/.test(combined)) return 'Fuel & DEF';
  if (/prepass|pre-pass|ezpass|e-zpass|drivewyze|cat scale|weigh station/.test(combined)) return 'Tolls & Scales';
  if (/\booida\b|owner-?operator independent drivers|association due|union due|membership due/.test(combined))
    return 'Association Dues';
  if (/\bgusto\b|\badp\b|paychex|payroll service/.test(combined)) return 'Wages & Payroll Taxes (W-2)';
  if (/\btriumph\b|\brts\b|otr solutions|factoring (company|fee|advance)|dispatch fee|dispatch service/.test(combined))
    return 'Dispatch & Factoring Fees';
  if (
    /legal|attorney|lawyer|llc filing|llc formation|registered agent|secretary of state|accountant|accounting|bookkeep|abacus|tax prep|cpa\b|drug (and alcohol )?consortium|drug testing consortium/.test(
      combined
    )
  )
    return 'Professional Services';
  if (/motive|keeptruckin|samsara|eld\b|omnitracs|peoplenet|qualcomm|e-?log device/.test(combined))
    return 'ELD & Communications';
  if (
    /anthropic|claude|openai|chatgpt|api credit|github|google workspace|gsuite|dropbox|icloud|microsoft 365|office 365|subscription|saas|software license|trucker path|garmin|rand mcnally|hammer.?maps?|maps? (subscription|purchase|app)|gps (app|subscription)|dat load|truckstop\.com|load board/.test(
      combined
    )
  )
    return 'Software & Subscriptions';
  if (/health insurance|medical insurance|dental insurance|vision insurance|health premium/.test(combined))
    return 'Insurance—Health';
  if (/insurance|premium|policy|bobtail|occ.?acc|cargo insurance|workers.?comp/.test(combined)) return 'Insurance—Truck';
  if (
    /permit|license|licensing|dot number|mc number|ifta|irp|ucr\b|hvut|form 2290|boc-?3|cdl\b|dot physical|kyu\b|ny-?hut|nm-?wdt|weight.?mile tax/.test(
      combined
    )
  )
    return 'Permits, Licenses & Road Taxes';
  if (/\btire\b|tires|\btyre\b|recap|retread/.test(combined)) return 'Tires';
  if (/truck payment|trailer payment|equipment loan|installment payment|lease.?purchase/.test(combined))
    return 'Truck/Trailer Payments';
  if (/hotel|motel|lodging|overnight parking|truck stop parking|\bparking\b/.test(combined)) return 'Parking & Lodging';
  if (/office suppl|printer|paper|stapler|postage|shipping label|po box/.test(combined)) return 'Office & Admin';
  if (/bank fee|wire fee|merchant fee|processing fee|overdraft|nsf fee|card fee/.test(combined)) return 'Bank & Merchant Fees';
  if (/advertis|marketing|vehicle wrap|sign lettering|business card/.test(combined)) return 'Advertising';
  if (/training|\bcourse\b|certification|cdl school|continuing education/.test(combined)) return 'Training & Education';
  if (/1099 contractor|independent contractor payment/.test(combined)) return 'Contract Labor (1099)';
  if (
    /drill|saw|wrench|socket|screwdriver|hammer|plier|ratchet|impact|blower|milwaukee|dewalt|ryobi|makita|bosch|craftsman|combo kit|power tool|torque|grease|jack|lift|air compressor|generator|m18|m12|fuel kit/.test(
      n
    )
  )
    return 'Tools & Equipment';
  if (
    /fridge|cooler|refrigerator|microwave|coffee|keurig|fan|heater|curtain|pillow|blanket|mattress|bunk|seat cover|bedding|tv|television|playstation|xbox|nintendo|gaming|console|game|ps4|ps5|roku|firestick|air fryer|instant pot|rice cooker|hot plate|electric kettle|toaster|cooking|cookware|pot|pan|skillet|organizer|storage/.test(
      n
    )
  )
    return 'Comfort & Sleeper';
  if (
    /camera|cam|dash|gps|inverter|charger|outlet|tablet|phone mount|bluetooth|speaker|power bank|usb|surge|battery|laptop|computer|ipad|kindle|headphone|earphone|wifi|hotspot|monitor/.test(
      n
    )
  )
    return 'Electronics';
  if (
    /fire ext|reflector|triangle|vest|glove|safety|first aid|lock|chain|strap|bungee|tie down|tarp|net|rope|hook|cone/.test(
      n
    )
  )
    return 'Truck Supplies & Equipment';
  if (/light|led|flashlight|lamp|work light|hi-?vis|steel toe|work boots|coveralls|workwear/.test(n))
    return 'Safety Gear & Workwear';
  if (/home depot|harbor freight|autozone|oreilly|napa|lowes/.test(s)) return 'Tools & Equipment';
  if (STORE_CATS[s]) return STORE_CATS[s] as string;
  return 'Misc';
}

// legacy/index.html:2497 getCatNote() — updated 2026-07-10 for renamed
// categories (industry knowledge base).
export function getCatNote(category: string): string {
  const notes: Record<string, string> = {
    'Tools & Equipment': 'Truck maintenance/repair tool',
    Electronics: 'Electronic device — truck cab',
    'Comfort & Sleeper': 'Sleeper cab equipment — OTR driver',
    'Truck Supplies & Equipment': 'Truck operating supply — business expense',
    'Safety Gear & Workwear': 'Safety equipment — truck operations',
    Maintenance: 'Truck repair/maintenance expense',
    Misc: 'Business supply — OTR operations',
  };
  return notes[category] ?? 'Business expense — OTR truck driver';
}

// legacy/index.html:1636 detectMaintType()
export function detectMaintType(desc: string | undefined): string {
  const d = (desc ?? '').toLowerCase();
  if (/fuel filter/.test(d)) return 'fuel';
  if (/oil change|oil filter|engine oil|lube service/.test(d)) return 'oil';
  if (/valve lash|valve adjust/.test(d)) return 'valve';
  if (/dpf|diesel particulate|regen/.test(d)) return 'dpf';
  if (/def filter|diesel exhaust fluid filter/.test(d)) return 'def';
  if (/coolant extender|extended life coolant/.test(d)) return 'coolext';
  if (/coolant (flush|replace)|replace coolant|full coolant/.test(d)) return 'coolant';
  if (/transmission|clutch|trans fluid|trans service/.test(d)) return 'trans';
  if (/differential|diff oil|diff fluid|rear end oil|rear axle oil/.test(d)) return 'diff';
  if (/engine air filter|tractor air filter/.test(d)) return 'airfilter';
  if (/air dryer cartridge/.test(d)) return 'airdryer';
  if (/chassis lube|chassis lubrication|grease chassis|lube chassis/.test(d)) return 'chassis';
  if (/apu service|tripac service|thermo king service|apu oil/.test(d)) return 'apu';
  if (/tire|tyre/.test(d)) return 'tires';
  if (/brake/.test(d)) return 'brakes';
  return 'general';
}

// detectMaintType() returns legacy's OWN category vocabulary. The Postgres
// maintenance_intervals.category values (docs/SCHEMA.sql) are seeded with
// 'coolant_ext', not legacy's 'coolext' — the truck_health view joins
// maintenance_records.service_type to maintenance_intervals.category by
// exact string match, so inserting the unmapped 'coolext' would silently
// stop Truck Health from ever picking up a coolant-extender service logged
// through this import flow. 'tires'/'brakes' have no matching interval
// category at all (not seeded — legacy doesn't track them as a health
// category either), so they pass through unchanged and simply aren't
// tracked by Truck Health, which is correct, not a bug.
export function toDbServiceType(legacyType: string): string {
  if (legacyType === 'coolext') return 'coolant_ext';
  return legacyType;
}
