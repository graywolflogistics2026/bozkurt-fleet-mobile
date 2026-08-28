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
  // Fuel Additives (owner decision 2026-08-05, FULL PARITY pass) — anti-
  // gel, diesel treatment, cetane booster, injector cleaner (Howes, Power
  // Service, Hot Shot's, Lucas, Archoil, Stanadyne, Diesel 911). Distinct
  // from "Fuel & DEF", which is pump diesel + DEF only.
  'Fuel Additives',
  'Maintenance & Repairs',
  // Major Repairs & Overhauls (owner decision 2026-08-05) — a single
  // invoice over $2,500 rebuilding a major component (engine in-frame,
  // transmission, differential, cab, repaint). Flagged in the accountant
  // report as "may be a capital improvement, confirm with your CPA"
  // (Schedule C line 21*, same numeric line as Maintenance & Repairs,
  // footnoted separately) rather than silently lumped into routine repairs.
  'Major Repairs & Overhauls',
  // Truck Parts (owner decision 2026-08-05) — a CONSUMED part the owner
  // buys and installs himself (APU fan, alternator, starter, battery,
  // belts, hoses, air dryer cartridge, filters, mirrors, lights, sensors,
  // wheel seals, brake shoes, mud flaps, wiper blades, fifth-wheel parts,
  // oil/coolant/grease) — distinct from Tools & Equipment (a reusable TOOL
  // kept after the job: wrench, impact gun, jack, tool box, blower, grease
  // gun).
  'Truck Parts',
  'Tires',
  // Truck Wash & Detailing (owner decision 2026-08-05) — distinct from a
  // routine repair; guarded so "windshield washer fluid" never false-hits
  // (isTruckWash() below only matches "wash"/"detail" as their own words).
  'Truck Wash & Detailing',
  'Truck/Trailer Payments',
  'Insurance—Truck',
  'Insurance—Health',
  'Permits, Licenses & Road Taxes',
  'Tolls & Scales',
  'Parking & Lodging',
  'ELD & Communications',
  'Software & Subscriptions',
  'Dispatch & Factoring Fees',
  // Renamed from 'Professional Services' (owner decision 2026-08-05) —
  // Schedule C Line 17's official wording ("Legal and professional
  // services"). Old rows saved under either 'Professional Services' or the
  // even-older 'Legal & Accounting Fees' are re-classified by the one-time
  // rename migration (docs/PENDING_SQL.md §40), not left to drift.
  'Legal & Professional Services',
  'Office & Admin',
  'Safety Gear & Workwear',
  'Truck Supplies & Equipment',
  'Tools & Equipment',
  'Electronics',
  'Comfort & Sleeper',
  // Warranty & Service Contracts / Lumper Fees (owner decision 2026-08-05)
  // — both were previously falling into 'Misc' with zero accountant-usable
  // detail; see classifySettlementLine() below for the settlement-specific
  // wiring ("EXTEND WR PURCH" / "ADV FOR OUTSIDE LUMPER").
  'Warranty & Service Contracts',
  'Lumper Fees',
  'Contract Labor (1099)',
  'Wages & Payroll Taxes (W-2)',
  'Bank & Merchant Fees',
  'Advertising',
  'Training & Education',
  'Association Dues',
  'Lease & Rent',
  'Utilities & Subscriptions',
  // Meals & advance repayments (owner decision 2026-07-17, mirrors web
  // v2026.07.17-D) — both NON-deductible by default (NON_DEDUCTIBLE_CATEGORIES
  // below): per diem already covers meals (never double-book them as a
  // separate deduction), and an advance repayment is loan principal, not a
  // new expense. Still real, pickable categories (a standalone/imported row
  // can land here even when it isn't settlement-withheld), just excluded
  // from tax deductible totals by default — the user can flip that per row.
  'Meals (per diem covered)',
  'Advance Repayment',
  // Escrow & deposits (owner decision 2026-08-02, verified against a real
  // statement's "PERFORMNCE BOND" OCR-damaged line) — a performance bond,
  // escrow reserve, tire fund, emergency fund, or maintenance reserve the
  // carrier HOLDS on the driver's behalf (money that's typically returned
  // later) is a REFUNDABLE DEPOSIT, not a business expense — same
  // non-deductible treatment as Meals/Advance Repayment above, for the
  // same reason: it never actually left the business as a cost.
  'Escrow & Deposits',
  'Misc',
  'Other',
] as const;

// docs/PENDING_SQL.md §33 (meals & advance repayments, owner decision
// 2026-07-17) — categories that default a deduction row's tax_deductible to
// false at save time. SMART DEFAULT, NOT A LOCK: the user can still flip
// tax_deductible per row regardless of category, and that edit is never
// re-overridden by a migration or a re-import of the same document.
export const NON_DEDUCTIBLE_CATEGORIES: readonly string[] = ['Meals (per diem covered)', 'Advance Repayment', 'Escrow & Deposits'];

// EQUIPMENT AUTO-POPULATE FROM IMPORTS (owner decision, SIMPLIFICATION
// PASS) — the ONE source of truth for "which categories represent a
// durable, trackable ASSET rather than a plain one-time expense line."
// Reuses CANONICAL_CATEGORIES' own existing strings verbatim — never a
// second, re-typed category list. Deliberately narrow:
// - 'Tools & Equipment' / 'Truck Supplies & Equipment' / 'Electronics' /
//   'Comfort & Sleeper' / 'Safety Gear & Workwear' — a reusable, durable
//   item kept after purchase (a tool, a dash cam, a mattress, a jacket) —
//   exactly the class of thing Equipment (the asset register) already
//   exists to track.
// - 'Truck Parts' is deliberately EXCLUDED — its own category comment in
//   CANONICAL_CATEGORIES above already draws this exact line: a CONSUMED
//   part (alternator, belts, filters) installed and gone, not a standing
//   asset to track.
// - 'Major Repairs & Overhauls' and 'Warranty & Service Contracts' are
//   excluded too — a repair/service isn't itself a tracked physical item,
//   even though it's a big-dollar line.
export const EQUIPMENT_TYPE_CATEGORIES: readonly string[] = [
  'Tools & Equipment',
  'Truck Supplies & Equipment',
  'Electronics',
  'Comfort & Sleeper',
  'Safety Gear & Workwear',
];

export function isEquipmentTypeCategory(category: string | null | undefined): boolean {
  return !!category && EQUIPMENT_TYPE_CATEGORIES.includes(category);
}

export function defaultTaxDeductible(category: string | null | undefined): boolean {
  return !NON_DEDUCTIBLE_CATEGORIES.includes(category ?? '');
}

// Restaurant/food-purchase detection (owner decision 2026-07-17) — truck-stop
// restaurants, carrier point-of-sale meals, cafes, diners, and a "grill" that
// IS a restaurant (e.g. "Bob's Bar & Grill", "Waffle House"). CAUTION: a
// truck GRILLE (the tractor's front-end part/assembly) is EQUIPMENT, not a
// meal — this regex deliberately never matches a bare "grill"/"grille" on
// its own, only within an unambiguous restaurant phrase, so a line like
// "Freightliner Cascadia grille assembly" is never misclassified.
const RESTAURANT_RE =
  /\brestaurant\b|\bcafe\b|\bcaf[eé]\b|\bdiner\b|pizzeria|steakhouse|\bbuffet\b|bar\s*&\s*grill|\bgrill\s*(house|room|shack)\b|\bbbq\b|barbeque|\btaco bell\b|\bsubway\b|\bmcdonald'?s?\b|burger king|wendy'?s|chili'?s|cracker barrel|waffle house|denny'?s|\bihop\b|popeyes|\bkfc\b|pizza hut|domino'?s|papa john'?s|starbucks|dunkin|food truck|drive-?thru|fast food|\bcatering\b|\beatery\b|\bbistro\b/i;

export function isRestaurantPurchase(text: string | undefined): boolean {
  return RESTAURANT_RE.test(text ?? '');
}

// Escrow/deposit detection (owner decision 2026-08-02, verified against a
// real statement with a "PERFORMNCE BOND" line — OCR/scan artifacts drop
// letters from these words often enough that a strict spelling match would
// miss real rows). This is the CLIENT-SIDE fallback: mapSettlement() checks
// this FIRST, same priority as isRestaurantPurchase(), so a deduction lands
// in "Escrow & Deposits" even when the AI didn't set chargebackType
// "escrow_reserve" (an older/legacy-imported row, or a model miss) — the
// AI's own chargebackType classification (ai-import's prompt) is the
// primary signal; this regex is the safety net, not a replacement for it.
// `bond` alone is deliberately NOT matched (too many false positives —
// "surety bond," a person's name, etc.) — only in combination with
// "performance"/"perform" (allowing dropped letters) or as part of an
// unambiguous escrow/reserve/fund phrase. Deliberately does NOT match a
// bare "security deposit" — that's an existing, DIFFERENT ai-import
// non-deductible-trap concept (a deposit the DRIVER paid, flagged
// "PERSONAL — REVIEW:" unless forfeited), not a carrier-held escrow.
const ESCROW_RE = /perform\w*\s*bond|escrow|maint\w*\s*rese?rv\w*|tire\s*f(u|n)nd|emergency\s*f(u|n)nd/i;

export function isEscrowDeposit(text: string | undefined): boolean {
  return ESCROW_RE.test(text ?? '');
}

// Insurance chargeback detection (owner decision 2026-08-04, Cash Flow
// auto-fill fix — device report: a real carrier settlement withholds
// FOUR separate weekly insurance charges under abbreviated codes:
// "BT/DH INS" (bobtail/deadhead), "PHY DAM" (physical damage), "OCCUP
// ACC" (occupational accident), and "CARGO"/"WORKERS COMP". The AI's own
// chargebackType classification (insurance_bobtail/
// insurance_physical_damage/insurance_occ_acc/insurance_cargo/
// insurance_workers_comp, all mapping to 'Insurance—Truck' via
// CHARGEBACK_CATEGORY_LABEL below) is the primary signal — this is the
// CLIENT-SIDE fallback for when chargebackType was missed (an older/
// legacy-imported row, or a model miss that left the settlement schema's
// own generic "Insurance" category string, which does NOT match either
// canonical 'Insurance—Truck'/'Insurance—Health' value), same priority
// as isEscrowDeposit()/isRestaurantPurchase() above. Bare "insurance"/
// "premium"/"policy" are included too (mirrors guessCategory()'s own
// insurance regex for standalone, non-settlement purchases) since a
// carrier statement's insurance line is rarely ambiguous with anything
// else. Bare "cargo" is deliberately included despite being a generic
// word — in the settlement-withheld-deduction context this function is
// used in, there is no other common "cargo" chargeback type, so a line
// coded just "CARGO" is, in practice, always the cargo insurance premium.
const INSURANCE_CHARGEBACK_RE =
  /\bbt\W?dh\s*ins\b|\bphy\.?\s*dam(age)?\b|physical\s*damage|\bocc(up)?\.?\s*acc(ident)?\b|occupational\s*accident|\bworkers.?\s*comp(ensation)?\b|\bbobtail\b|\bcargo\b|\binsurance\b|\bpremium\b|\bpolicy\b/i;

export function isInsuranceChargeback(text: string | undefined): boolean {
  return INSURANCE_CHARGEBACK_RE.test(text ?? '');
}

// ---------------------------------------------------------------------------
// FULL PARITY pass (owner decision 2026-08-05) — new discrimination rules,
// §A.3/A.4. Every regex below is deliberately word-boundary-guarded against
// the specific false-hit cases the spec called out ("windshield washer
// fluid" is not a wash, a truck "grille" is not a restaurant grill — already
// handled by RESTAURANT_RE above — and "Inner tube" is not an inn).
// ---------------------------------------------------------------------------

// Fuel additives (anti-gel, diesel treatment, cetane booster, injector
// cleaner) — brand names plus generic wording. Deliberately does NOT match
// bare "fuel" (that stays Fuel & DEF for pump diesel/DEF purchases).
const FUEL_ADDITIVE_RE =
  /\banti-?gel\b|diesel treatment|cetane (booster|plus)|injector cleaner|\bhowes\b|power service|hot shot'?s( secret)?|\blucas\b.*(oil|fuel|treatment)|\barchoil\b|stanadyne|diesel 911|fuel additive|fuel stabilizer/i;

export function isFuelAdditive(text: string | undefined): boolean {
  return FUEL_ADDITIVE_RE.test(text ?? '');
}

// Consumed truck PARTS the owner installs himself — distinct from a
// reusable TOOL (Tools & Equipment's own regex, guessCategory() below).
const TRUCK_PART_RE =
  /\bapu fan\b|\balternator\b|\bstarter\b|\bbattery\b|\bbatteries\b|\bbelt\b|\bbelts\b|\bhose\b|\bhoses\b|air dryer cartridge|\bfilter\b|\bmirror\b|headlight|taillight|marker light|\bsensor\b|wheel seal|brake shoe|brake pad|mud flap|wiper blade|fifth-?wheel (part|plate|jaw)|\bgasket\b|\bu-?joint\b|\bwheel bearing\b/i;

export function isTruckPart(text: string | undefined): boolean {
  return TRUCK_PART_RE.test(text ?? '');
}

// Truck wash & detailing — \bwash\b (word-boundary) never matches "washer"
// ("windshield washer fluid" stays whatever its own category resolves to,
// never Truck Wash & Detailing).
const TRUCK_WASH_RE = /truck ?wash\b|\bwash\b|\bdetail(ing)?\b|pressure wash|blaster wash/i;

export function isTruckWash(text: string | undefined): boolean {
  return TRUCK_WASH_RE.test(text ?? '');
}

// Warranty & service contracts — generic, spelled-out wording only. Prime's
// own abbreviated "EXTEND WR PURCH" code text lives in carrier_code_maps
// (docs/CARRIER_CODES.md), NOT here — see the CARRIER ISOLATION note below
// classifySettlementLine().
const WARRANTY_SERVICE_RE = /extended warranty|service contract|warranty (plan|purchase|contract)/i;

export function isWarrantyService(text: string | undefined): boolean {
  return WARRANTY_SERVICE_RE.test(text ?? '');
}

// Lumper fees — bare "lumper" is carrier-neutral and, checked first (see
// classifySettlementLine()'s ORDER MATTERS comment), already catches an
// ADVANCE-shaped line like "ADV FOR OUTSIDE LUMPER" for any carrier before
// the generic Advance Repayment rule gets a chance to swallow it — no
// carrier-specific "ADV...OUTSIDE LUMPER" fragment is needed here.
const LUMPER_FEE_RE = /\blumper\b/i;

export function isLumperFee(text: string | undefined): boolean {
  return LUMPER_FEE_RE.test(text ?? '');
}

// A generic/plain ADVANCE line (no more specific match above) is loan
// principal being repaid, not a new expense — same non-deductible
// treatment as the existing chargebackType 'advance_repayment'.
const GENERIC_ADVANCE_RE = /\badvance\b|\badv\b/i;

export function isGenericAdvance(text: string | undefined): boolean {
  return GENERIC_ADVANCE_RE.test(text ?? '');
}

// Major repair/overhaul — only relevant above the $2,500 single-invoice
// threshold from the spec; a cheap "engine tune-up" line must never trip
// this even if it loosely matches "engine".
const MAJOR_REPAIR_RE =
  /engine (in-?frame|rebuild|overhaul|replacement)|transmission (rebuild|overhaul|replacement)|differential (rebuild|overhaul)|\bcab\b\s*(replace(ment)?|swap)|\brepaint\b|frame (repair|straighten(ing)?)/i;

export function isMajorRepairOverhaul(text: string | undefined, amount: number): boolean {
  return amount > 2500 && MAJOR_REPAIR_RE.test(text ?? '');
}

// FULL PARITY follow-up (owner decision 2026-08-05, spec item C.2) — a
// truck/trailer PURCHASE occasionally gets logged as a plain deduction
// row instead of via `trucks.purchase_price`/`equipment.purchase_price`
// (CLAUDE.md invariant #25) — e.g. a down payment paid separately from
// the asset record, or a user who hasn't filled in the asset's own
// purchase fields yet. calcCanonicalCpm() (src/stats/cpm.ts) excludes any
// deduction matching this from the per-mile CPM figure — a five-figure
// one-time purchase divided across one week's miles would spike CPM to
// something meaningless — while the row still counts normally toward
// P&L/tax (this only affects CPM's own per-mile math, nothing else).
const VEHICLE_PURCHASE_RE =
  /down\s*payment|truck\s*purchase|tractor\s*purchase|trailer\s*purchase|vehicle\s*purchase|purchase\s*price|purchased\s*(a\s*)?(truck|tractor|trailer)/i;

export function isVehiclePurchaseOneOff(text: string | undefined): boolean {
  return VEHICLE_PURCHASE_RE.test(text ?? '');
}

// Lodging — extended for inn/lodge/Airbnb/truck-parking reservations.
// \binn\b requires "inn" as its OWN word, so "Inner tube" (where "Inner"
// is a single token) never matches.
const LODGING_RE =
  /\bhotel\b|\bmotel\b|\blodging\b|\blodge\b|\binn\b|air\s*bnb|overnight parking|truck.?stop parking|truck parking (reservation|spot|space)|\bparking\b/i;

export function isLodging(text: string | undefined): boolean {
  return LODGING_RE.test(text ?? '');
}

// UNIFIED CLASSIFICATION PATH (owner decision) — classifySettlementLine()
// and guessCategory() used to each hand-roll their OWN separate regex for
// several categories they BOTH recognize (Tolls & Scales, Bank & Merchant
// Fees, Permits/Road Tax, ELD & Communications, Legal & Professional
// Services) — the exact class of bug that let ELD/IRP silently diverge
// between the two (one recognized them, the other didn't) and could
// recur for any of the others without warning. Each shared category now
// has exactly ONE exported detector function — the UNION of whatever
// terms either function previously recognized on its own, so neither
// function loses coverage the other one already had — and BOTH
// classifySettlementLine() and guessCategory() call the SAME function.
// A category genuinely specific to ONE context (e.g. "Company Store," a
// settlement-only concept with no guessCategory() equivalent at all) is
// deliberately left as its own local rule — this unification is about
// eliminating DIVERGENCE for a shared concept, not about forcing every
// category into both functions regardless of context.
//
// Accounting/CPA/legal — deliberately NOT fully unified, and this is a
// documented exception rather than a leftover divergence: guessCategory()
// (imported documents — a standalone invoice can legitimately be titled
// "ABC Accounting Services") keeps the bare words "accountant"/
// "accounting" in its own regex, but classifySettlementLine() CANNOT
// share that — Prime Inc's own carrier-specific chargeback code is the
// literal text "ACCOUNTING SERV" (docs/CARRIER_CODES.md), and a bare
// "accounting" substring match would swallow that carrier-specific code
// straight back into the generic classifier, exactly the CARRIER
// ISOLATION violation this file's own hard invariant forbids (see the
// note below classifySettlementLine()) — confirmed by this file's own
// test suite, which failed the instant "accounting" was unified in.
// Every OTHER shared category below (Permits, ELD, Tolls & Scales, Bank
// & Merchant Fees) has no such carrier-code collision and IS fully
// unified into one shared function.
const LEGAL_PROFESSIONAL_RE =
  /trust service|\bbookkeep|legal|attorney|lawyer|llc filing|llc formation|registered agent|secretary of state|accountant|accounting|abacus|tax prep|\bcpa\b|drug (and alcohol )?consortium|drug testing consortium/i;

export function isLegalOrProfessionalServices(text: string | undefined): boolean {
  return LEGAL_PROFESSIONAL_RE.test(text ?? '');
}

// The settlement-line-safe subset of the above — every term EXCEPT
// "accountant"/"accounting" (the Prime carrier-code collision explained
// above). Used ONLY by classifySettlementLine(); guessCategory() keeps
// using the fuller isLegalOrProfessionalServices() since it never sees a
// carrier's own chargeback line text.
const LEGAL_PROFESSIONAL_SETTLEMENT_SAFE_RE =
  /trust service|\bbookkeep|legal|attorney|lawyer|llc filing|llc formation|registered agent|secretary of state|abacus|tax prep|\bcpa\b|drug (and alcohol )?consortium|drug testing consortium/i;

export function isLegalOrProfessionalServicesSettlementSafe(text: string | undefined): boolean {
  return LEGAL_PROFESSIONAL_SETTLEMENT_SAFE_RE.test(text ?? '');
}

// Permits, Licenses & Road Taxes — the union of classifySettlementLine()'s
// own terms (fed hwy tax/license/permit/irp/ifta/hvut/2290/ucr) and
// guessCategory()'s (dot number/mc number/boc-3/cdl/dot physical/kyu/
// ny-hut/nm-wdt/weight-mile tax) — a real carrier settlement almost never
// prints the literal word "permit" for an IRP/plate-registration line,
// "IRP" itself is the common abbreviation, and a standalone imported
// document could equally reference any of the DOT-registration terms
// guessCategory() already recognized.
const PERMITS_ROAD_TAX_RE =
  /fed\.?\s*h?wy\.?\s*tax|federal highway (use )?tax|\blicens\w*\b|\bpermits?\b|\birp\b|\bifta\b|\bhvut\b|form\s*2290|\b2290\b|\bucr\b|dot number|mc number|boc-?3|\bcdl\b|dot physical|\bkyu\b|ny-?hut|nm-?wdt|weight.?mile tax/i;

export function isPermitsOrRoadTax(text: string | undefined): boolean {
  return PERMITS_ROAD_TAX_RE.test(text ?? '');
}

// ELD & Communications — the union of classifySettlementLine()'s own
// terms (Qualcomm/Geotab rental, navigation charge, a bare "ELD",
// "communications charge", "elog") and guessCategory()'s much larger
// vendor-brand list (Motive, KeepTruckin, Samsara, Omnitracs, PeopleNet,
// Garmin, Rand McNally, a load board, DAT, Truckstop.com, ...) — a
// settlement withholding for this vendor's own subscription fee is just
// as real a possibility as a standalone document naming the same brand.
const ELD_COMMUNICATIONS_RE =
  /qual\w*\s*rental|geo\w*\s*rental|navigation charge|\beld\b|communications?\s*charge|\belog\b|motive|keeptruckin|samsara|omnitracs|peoplenet|qualcomm|e-?log device|trucker path|garmin|rand mcnally|hammer.?maps?|maps? (subscription|purchase|app)|gps (app|subscription|unit|device)|dat load|truckstop\.com|load board/i;

export function isEldOrCommunications(text: string | undefined): boolean {
  return ELD_COMMUNICATIONS_RE.test(text ?? '');
}

// Tolls & Scales — classifySettlementLine() already had the wider, more
// general form (a bare `\bscale\b` matches "cat scale" too); guessCategory()
// had ONLY the narrower "cat scale" phrase and no bare "scale" match — a
// settlement line coded just "SCALE" would have matched one function and
// silently not the other.
const TOLLS_SCALES_RE = /prepass|pre-pass|drivewyze|\bscale\b|weigh station|ezpass|e-zpass/i;

export function isTollsOrScales(text: string | undefined): boolean {
  return TOLLS_SCALES_RE.test(text ?? '');
}

// Bank & Merchant Fees — guessCategory() already had the superset
// (classifySettlementLine() was missing "overdraft"/"nsf fee").
const BANK_MERCHANT_FEE_RE = /bank fee|wire fee|merchant fee|processing fee|overdraft|nsf fee|card fee/i;

export function isBankOrMerchantFee(text: string | undefined): boolean {
  return BANK_MERCHANT_FEE_RE.test(text ?? '');
}

// ---------------------------------------------------------------------------
// SETTLEMENT-LINE CLASSIFIER (docs/INDUSTRY_TAXONOMY.md §A extension, owner
// decision 2026-08-05, FULL PARITY pass) — a real carrier statement's
// unmapped chargeback codes/descriptions were landing in "Misc" with zero
// accountant-usable detail (an $18k Misc pile on one real account). This is
// the ONE place `mapExtraction.ts`'s mapSettlement() reads a settlement
// deduction line's category from — replaces the previous inline ternary
// chain (isRestaurantPurchase -> isEscrowDeposit -> isInsuranceChargeback)
// with a single ordered rule list that ALSO covers the new codes below.
//
// ORDER MATTERS — checked top to bottom, first match wins:
//   1. A LUMPER-shaped advance ("ADV FOR OUTSIDE LUMPER") stays deductible
//      Lumper Fees — checked BEFORE the generic advance rule so the bare
//      word "ADV" doesn't swallow it.
//   2. A plain/generic ADVANCE line is Advance Repayment (non-deductible
//      loan principal) — this wins over the warranty rule below: the
//      ORIGINAL "EXTEND WR PURCH" line (the actual warranty purchase) is a
//      real deductible expense, but a LATER "ADVANCE" line repaying it in
//      installments is not a new expense.
// Every other rule after that is a specific settlement chargeback code;
// isRestaurantPurchase (Meals) stays last since its net is the widest.
//
// CARRIER ISOLATION (owner decision, CARRIER-SCOPED PAYROLL/SETTLEMENT
// CODES hard invariant, CLAUDE.md) — every regex below is checked and kept
// GENERIC on purpose: it matches wording/concepts any carrier's own
// statement could plausibly use in its own words (a spelled-out phrase, a
// widely-known third-party vendor/program brand name — Qualcomm, Geotab,
// PrePass, Drivewyze, EZPass — or a literal IRS tax name), never one
// carrier's own internal abbreviated CODE TEXT. A carrier-specific code
// fragment (Prime Inc's own "EXTEND WR PURCH" / "ACCOUNTING SERV" /
// "EZ FAST LN" (its own transponder program name) / "WIRE CHARGE" /
// "FUEL CARD CHARGE" / "TRIP XPRESS" / "STATEMENT PREPARATION" /
// "PRIME POINT-OF-SALE" / "IMAGE TRIPS") belongs ONLY in that carrier's own
// `carrier_code_maps` row (docs/CARRIER_CODES.md, docs/PENDING_SQL.md §53),
// resolved by `applyCarrierCodeCategories()` (app/src/import/carrierCodes.ts)
// BEFORE this generic classifier ever runs — never applied globally here.
// `isPermitsOrRoadTax`/`isEldOrCommunications`/`COMPANY_STORE_RE` deliberately
// keep their abbreviated forms ("FED HWY TAX", "QUAL RENTAL"/"GEO RENTAL",
// "COMPANY STORE") — these name a real universal IRS tax, real third-party
// ELD/telematics vendor brands, and a common industry-wide concept
// respectively, not one carrier's own invented terminology; any carrier's
// statement could plausibly print exactly this text.
// ---------------------------------------------------------------------------
// UNIFIED CLASSIFICATION PATH (owner decision, see the shared isXxx()
// detector functions above) — this function used to hand-roll its own
// separate regex for Permits/ELD/Tolls/Bank-Merchant/Legal that could
// silently diverge from guessCategory()'s own version of the same concept
// (this is exactly how ELD/IRP recognition drifted apart the first time).
// Every one of those five now calls the SAME shared function guessCategory()
// calls below, so this class of divergence cannot recur for any of them.
const COMPANY_STORE_RE = /company store/i;

export function classifySettlementLine(desc: string | undefined): string | null {
  const text = desc ?? '';
  if (isLumperFee(text)) return 'Lumper Fees';
  if (isGenericAdvance(text)) return 'Advance Repayment';
  if (isEscrowDeposit(text)) return 'Escrow & Deposits';
  if (isWarrantyService(text)) return 'Warranty & Service Contracts';
  if (isLegalOrProfessionalServicesSettlementSafe(text)) return 'Legal & Professional Services';
  if (isInsuranceChargeback(text)) return 'Insurance—Truck';
  if (isPermitsOrRoadTax(text)) return 'Permits, Licenses & Road Taxes';
  if (isEldOrCommunications(text)) return 'ELD & Communications';
  if (isTollsOrScales(text)) return 'Tolls & Scales';
  if (COMPANY_STORE_RE.test(text)) return 'Truck Supplies & Equipment';
  if (isBankOrMerchantFee(text)) return 'Bank & Merchant Fees';
  if (isRestaurantPurchase(text)) return 'Meals (per diem covered)';
  return null;
}

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
  escrow_reserve: 'Escrow & Deposits',
  lease_purchase_payment: 'Truck/Trailer Payments',
  trailer_fee: 'Lease & Rent',
  cash_advance: 'Misc',
  loan_payment: 'Truck/Trailer Payments',
  drug_consortium: 'Legal & Professional Services',
  tolls_transponder: 'Tolls & Scales',
  admin_processing_fee: 'Bank & Merchant Fees',
  factoring_fee: 'Dispatch & Factoring Fees',
  dispatch_fee: 'Dispatch & Factoring Fees',
  advance_repayment: 'Advance Repayment',
  other_chargeback: 'Misc',
};

// Schedule C LINE reference (owner decision 2026-08-05, FULL PARITY pass,
// Accountant Package item A.5) — shown next to every category subtotal so
// the accountant can see where a bucket lands on the actual form. This is
// INFORMATIONAL ONLY (CLAUDE.md invariant #8 — "Estimates only, not tax
// advice") — a best-effort standard mapping, not a filing determination.
// 'Insurance—Health'/'Meals (per diem covered)'/'Advance Repayment'/
// 'Escrow & Deposits' map to null: health premiums are an above-the-line
// Form 1040 adjustment (not a Schedule C line at all), and the other three
// are excluded from Schedule C entirely (never real business expenses).
// Major Repairs & Overhauls shares line 21 with Maintenance & Repairs but
// carries its own '21*' footnoted value ("may be a capital improvement —
// confirm with your CPA") rather than silently blending into routine
// repairs.
export const SCHEDULE_C_LINE: Record<string, string | null> = {
  'Fuel & DEF': '22',
  'Fuel Additives': '22',
  'Maintenance & Repairs': '21',
  'Major Repairs & Overhauls': '21*',
  'Truck Parts': '21',
  Tires: '21',
  'Truck Wash & Detailing': '21',
  'Truck/Trailer Payments': '20a',
  'Insurance—Truck': '15',
  'Insurance—Health': null,
  'Permits, Licenses & Road Taxes': '23',
  'Tolls & Scales': '27a',
  'Parking & Lodging': '24a',
  'ELD & Communications': '25',
  'Software & Subscriptions': '25',
  'Dispatch & Factoring Fees': '10',
  'Legal & Professional Services': '17',
  'Office & Admin': '18',
  'Safety Gear & Workwear': '22',
  'Truck Supplies & Equipment': '22',
  'Tools & Equipment': '22',
  Electronics: '22',
  'Comfort & Sleeper': '22',
  'Warranty & Service Contracts': '27a',
  'Lumper Fees': '27a',
  'Contract Labor (1099)': '11',
  'Wages & Payroll Taxes (W-2)': '26',
  'Bank & Merchant Fees': '27a',
  Advertising: '8',
  'Training & Education': '27a',
  'Association Dues': '27a',
  'Lease & Rent': '20b',
  'Utilities & Subscriptions': '25',
  'Meals (per diem covered)': null,
  'Advance Repayment': null,
  'Escrow & Deposits': null,
  Misc: '27a',
  Other: '27a',
};

export function scheduleCLineFor(category: string): string | null {
  if (category in SCHEDULE_C_LINE) return SCHEDULE_C_LINE[category];
  return '27a';
}

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

  if (isRestaurantPurchase(combined)) return 'Meals (per diem covered)';
  if (isFuelAdditive(combined)) return 'Fuel Additives';
  if (/comdata|efs\b|fuelman|fuel card|def\b|diesel exhaust fluid/.test(combined)) return 'Fuel & DEF';
  if (isWarrantyService(combined)) return 'Warranty & Service Contracts';
  if (isLumperFee(combined)) return 'Lumper Fees';
  if (isTruckWash(combined)) return 'Truck Wash & Detailing';
  if (isTollsOrScales(combined)) return 'Tolls & Scales';
  if (/\booida\b|owner-?operator independent drivers|association due|union due|membership due/.test(combined))
    return 'Association Dues';
  if (/\bgusto\b|\badp\b|paychex|payroll service/.test(combined)) return 'Wages & Payroll Taxes (W-2)';
  if (/\btriumph\b|\brts\b|otr solutions|factoring (company|fee|advance)|dispatch fee|dispatch service/.test(combined))
    return 'Dispatch & Factoring Fees';
  if (isLegalOrProfessionalServices(combined)) return 'Legal & Professional Services';
  // ELD/GPS/load board (owner decision 2026-08-05, FULL PARITY pass — moved
  // off Software & Subscriptions per the spec's explicit "ELD/GPS/load
  // board = ELD & Communications" grouping).
  if (isEldOrCommunications(combined)) return 'ELD & Communications';
  if (
    /anthropic|claude|openai|chatgpt|api credit|github|google workspace|gsuite|dropbox|icloud|microsoft 365|office 365|subscription|saas|software license/.test(
      combined
    )
  )
    return 'Software & Subscriptions';
  if (/health insurance|medical insurance|dental insurance|vision insurance|health premium/.test(combined))
    return 'Insurance—Health';
  if (isInsuranceChargeback(combined)) return 'Insurance—Truck';
  if (isPermitsOrRoadTax(combined)) return 'Permits, Licenses & Road Taxes';
  // Major Repairs & Overhauls needs the dollar amount (>$2,500 threshold,
  // isMajorRepairOverhaul() above) which this function's signature doesn't
  // carry — applied instead at the call site that has both a description
  // AND an amount (mapExtraction.ts's mapPurchase()/mapMaintenance()),
  // overriding this function's plain 'Maintenance & Repairs'/'Truck Parts'
  // guess when the threshold is met.
  // SHOP INVOICE with labor = Maintenance & Repairs (checked before the
  // Truck Parts/Tools splits below, so a shop's combined parts+labor
  // invoice doesn't get misread as a single consumed part).
  if (/shop invoice|repair invoice|\bmechanic\b|repair shop|repair labor|labor (charge|cost|fee)/i.test(combined))
    return 'Maintenance & Repairs';
  if (isTruckPart(combined)) return 'Truck Parts';
  if (/\btire\b|tires|\btyre\b|recap|retread/.test(combined)) return 'Tires';
  if (/truck payment|trailer payment|equipment loan|installment payment|lease.?purchase/.test(combined))
    return 'Truck/Trailer Payments';
  if (isLodging(combined)) return 'Parking & Lodging';
  if (/office suppl|printer|paper|stapler|postage|shipping label|po box/.test(combined)) return 'Office & Admin';
  if (isBankOrMerchantFee(combined)) return 'Bank & Merchant Fees';
  if (/advertis|marketing|vehicle wrap|sign lettering|business card/.test(combined)) return 'Advertising';
  if (/training|\bcourse\b|certification|cdl school|continuing education/.test(combined)) return 'Training & Education';
  if (/1099 contractor|independent contractor payment/.test(combined)) return 'Contract Labor (1099)';
  if (
    /drill|saw|wrench|socket|screwdriver|hammer|plier|ratchet|impact|blower|milwaukee|dewalt|ryobi|makita|bosch|craftsman|combo kit|power tool|torque|grease gun|\bjack\b|\blift\b|air compressor|generator|m18|m12|fuel kit/.test(
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
    'Truck Parts': 'Truck repair part — installed by owner',
    'Fuel Additives': 'Fuel treatment/additive — truck operations',
    'Truck Wash & Detailing': 'Truck wash/detailing — business expense',
    'Warranty & Service Contracts': 'Extended warranty/service contract',
    'Lumper Fees': 'Lumper fee — load unloading/loading labor',
    'Major Repairs & Overhauls': 'Major component overhaul — confirm capitalization with your CPA',
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
