// supabase/functions/ai-import/index.ts
//
// Deno Edge Function — receipts/statements/settlements → structured JSON via
// the Anthropic API. ANTHROPIC_API_KEY lives only in this function's
// environment secrets; the mobile app never holds it (CLAUDE.md).
//
// POST body: { fileBase64: string, mediaType: string, docHint?: string, locale?: string }
// Auth: Supabase JWT in the Authorization header (required).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DAILY_IMPORT_LIMIT = 30;
const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_MAX_TOKENS = 8000;

// ============================================================================
// Extraction prompt — ported VERBATIM from legacy/index.html's handleFile()
// (the `const prompt=\`Parse this document...\`` string, ~line 2411). This
// encodes months of tuning: docType schemas, the qty×unit-price self-check,
// vendor-name extraction rules, Zelle/Venmo personal-payment detection, and
// the OTR sleeper-cab 100%-deductible rule. Do NOT edit this string directly
// — any change must go through the explicit, commented patches below it, the
// same way the earlier fuel-state addition was handled.
// ============================================================================
const LEGACY_EXTRACTION_PROMPT =
  `Parse this document for Graywolf Logistics LLC (Ali Bozkurt, Prime Inc. owner-operator, Unit 830157). Return ONLY raw JSON starting with { ending with }. No markdown.\n\ndocType: settlement|fuel|maintenance|amazon|store|toll|loan|other\n\nFor settlement: {"docType":"settlement","date":"YYYY-MM-DD","vendor":"","totalAmount":0,"taxDeductible":true,"bizPct":100,"summary":"","settlement":{"weekEnding":"","carrier":"","unit":"","grossRevenue":0,"reimbursements":0,"totalDeductions":0,"netPay":0,"totalMiles":0,"loadedMiles":0,"revenueItems":[{"desc":"","order":"","amount":0}],"reimbursementItems":[{"desc":"","ref":"","amount":0}],"loads":[{"order":"","from":"","to":"","loadedMiles":0,"emptyMiles":0,"revenue":0,"rate":0,"shipper":""}],"tractorFuel":[{"date":"","location":"","gallons":0,"amount":0,"discount":0}],"reeferFuel":[{"date":"","location":"","gallons":0,"amount":0,"discount":0}],"deductions":[{"code":"","desc":"","balance":0,"amount":0,"category":"Software & Subscriptions|Legal & Accounting Fees|Insurance|Licensing & Permits|Fixed|Variable|Other"}],"maintenance":[{"invoice":"","unit":"","desc":"","odometer":0,"serviceType":"oil|fuel|valve|dpf|def|coolext|coolant|trans|tires|brakes|general|other","parts":0,"labor":0,"total":0,"covered":0}],"tolls":{"ezpass":{"total":0,"items":[]},"drivewyze":{"total":0,"items":[]}},"loans":[{"name":"","balance":0,"payment":0,"frequency":"","nextDue":""}],"assets":{"tractor":{"unit":"","year":"","make":"","model":"","vin":"","license":"","odometer":0},"apu":{"unit":"","make":"","model":"","vin":"","hours":0,"rental":0}},"operating":{"ytdRevenue":0,"ytdExpenses":0,"ytdNet":0,"weeksInService":0}}}\n\nFor fuel: {"docType":"fuel","date":"","vendor":"","totalAmount":0,"taxDeductible":true,"summary":"","fuel":{"type":"tractor","station":"","location":"","gallons":0,"pricePerGallon":0,"gross":0,"discount":0,"net":0}}\n\nFor maintenance: {"docType":"maintenance","date":"","vendor":"","totalAmount":0,"taxDeductible":true,"summary":"","maintenance":{"invoice":"","shop":"","unit":"","description":"","odometer":0,"serviceType":"oil|fuel|valve|dpf|def|coolext|coolant|trans|tires|brakes|general|other","parts":0,"labor":0,"total":0,"warrantyCredit":0,"netCost":0}}\n\n
For amazon/walmart/homedepot/harborfright/store receipts use docType "amazon" (this is just an internal category name covering ALL store purchases, not literally Amazon):
{"docType":"amazon","date":"","vendor":"","totalAmount":0,"taxDeductible":true,"bizPct":100,"summary":"","purchase":{"orderNumber":"","items":[{"name":"","qty":1,"price":0}],"subtotal":0,"tax":0,"total":0,"paymentMethod":"BofA Business"}}
IMPORTANT: "vendor" MUST be the ACTUAL store/company name read from the document (logo, header, footer, or website URL shown) — e.g. "Home Depot", "Walmart", "AutoZone", "Amazon.com". Never default to "Amazon" unless the receipt genuinely is from Amazon. If a photo is blurry and the name truly cannot be read, set vendor to "Unknown Store" rather than guessing a specific brand.
CRITICAL QUANTITY & TOTALS RULES: "price" is the PER-UNIT price; "qty" is the quantity ordered. Look CAREFULLY for quantity indicators — on Amazon order pages the quantity often appears as a small number next to/below the product image, or as "Qty: N". Extract "tax" (sales tax) into purchase.tax. purchase.total and totalAmount MUST equal the invoice GRAND TOTAL (including tax and shipping). SELF-CHECK before answering: sum(price×qty for all items) + tax + shipping must equal the grand total — if it does not, re-read the document and fix qty or price.

For Zelle/Venmo/Cash App/PayPal payment confirmation screenshots (peer-to-peer payment sent from a PERSONAL account, e.g. "Your payment is sent", a "To:" recipient name, a "Message" field describing what was bought) — ALSO use docType "amazon" with the same schema. Map fields: vendor = the recipient's name (the "To" field), purchase.items[0].name = the "Message" field content (what was purchased) or "Private party purchase" if no message, purchase.total/totalAmount = the "Amount" field, date = the transaction date shown. Set purchase.paymentMethod to whichever app was used: "Zelle Personal", "Venmo Personal", "Cash App Personal", or "PayPal Personal" — this signals the purchase was paid from personal (not business) funds. bizPct should still be 100 if the item is a legitimate business expense (tools, electronics, truck supplies etc per the rule below).

IMPORTANT - Ali Bozkurt is OTR truck driver, sleeper cab is his home+office. ALL items 100% deductible: tools, TV, PlayStation, cooking appliances, electronics, bedding. Only groceries/medicine are personal.\n\nIn settlement deductions: any line item related to bookkeeping, accounting, tax prep, Abacus, or a registered agent/legal filing fee MUST be tagged \"Legal & Accounting Fees\"; any ELD, e-log, GPS, maps, load-board, or software service fee MUST be tagged \"Software & Subscriptions\" (not left blank or generic) so it can be tracked consistently across weekly settlements.

`;

// ---- Approved addition (a), owner decision 2026-07-03: fuel purchases also
// extract US state (2-letter code) for IFTA — adds "state" to the fuel
// schema and the docType enum is otherwise untouched by this patch. ----
const FUEL_SCHEMA_BEFORE =
  `For fuel: {"docType":"fuel","date":"","vendor":"","totalAmount":0,"taxDeductible":true,"summary":"","fuel":{"type":"tractor","station":"","location":"","gallons":0,"pricePerGallon":0,"gross":0,"discount":0,"net":0}}`;
const FUEL_SCHEMA_AFTER =
  `For fuel: {"docType":"fuel","date":"","vendor":"","totalAmount":0,"taxDeductible":true,"summary":"","fuel":{"type":"tractor","station":"","location":"","state":"","gallons":0,"pricePerGallon":0,"gross":0,"discount":0,"net":0}}`;

// ---- Approved addition (b), owner decision 2026-07-03: new docType "w2"
// (household tax design) — adds "w2" to the docType enum. ----
const DOCTYPE_ENUM_BEFORE = `docType: settlement|fuel|maintenance|amazon|store|toll|loan|other`;
// Universal AI capture (owner decision 2026-07-10, PRODUCT DECISION) added
// 6 more docTypes on top of the existing w2 addition (see
// APPROVED_ADDITIONS_SUFFIX below for each one's schema).
const DOCTYPE_ENUM_AFTER =
  `docType: settlement|fuel|maintenance|amazon|store|toll|loan|w2|driver_payment|insurance|lease_rent|factoring_statement|government_or_misc_income|utility_subscription|other`;

// ---- Approved addition (d), owner decision 2026-07-07 (web app
// v2026.07.07-H): settlement loads gain pickupDate/deliveryDate — feeds
// the exact per-diem day-range calc (app/src/tax/perDiem.ts), replacing
// the 7-days-per-settlement-week stopgap. ----
const LOADS_SCHEMA_BEFORE =
  `"loads":[{"order":"","from":"","to":"","loadedMiles":0,"emptyMiles":0,"revenue":0,"rate":0,"shipper":""}]`;
const LOADS_SCHEMA_AFTER =
  `"loads":[{"order":"","from":"","to":"","loadedMiles":0,"emptyMiles":0,"revenue":0,"rate":0,"shipper":"","pickupDate":"","deliveryDate":""}]`;

// ---- Approved addition (owner decision 2026-07-07): purchase items gain
// warrantyYears/warrantyFor, and paymentMethod's example defaults to the
// new 9-generic-value scheme instead of the retired "BofA Business". ----
const PURCHASE_SCHEMA_BEFORE =
  `"purchase":{"orderNumber":"","items":[{"name":"","qty":1,"price":0}],"subtotal":0,"tax":0,"total":0,"paymentMethod":"BofA Business"}}`;
const PURCHASE_SCHEMA_AFTER =
  `"purchase":{"orderNumber":"","items":[{"name":"","qty":1,"price":0,"warrantyYears":0,"warrantyFor":""}],"subtotal":0,"tax":0,"total":0,"paymentMethod":"Business Credit Card"}}`;

// ---- Approved addition (owner decision 2026-07-09, PRODUCT DECISION —
// this is a clean product for OTHER users, not just the original owner):
// the identity line and the OTR-deductibility rule named a specific person,
// company, and truck unit. Both must be generic — they apply the same way
// to every user's own documents/trucks, not one owner's identity. ----
const IDENTITY_LINE_BEFORE =
  `Parse this document for Graywolf Logistics LLC (Ali Bozkurt, Prime Inc. owner-operator, Unit 830157). Return ONLY raw JSON starting with { ending with }. No markdown.`;
const IDENTITY_LINE_AFTER =
  `Parse this document for an owner-operator trucking business. Return ONLY raw JSON starting with { ending with }. No markdown.`;

const OTR_RULE_BEFORE =
  `IMPORTANT - Ali Bozkurt is OTR truck driver, sleeper cab is his home+office. ALL items 100% deductible: tools, TV, PlayStation, cooking appliances, electronics, bedding. Only groceries/medicine are personal.`;
const OTR_RULE_AFTER =
  `IMPORTANT - the user is an OTR truck driver whose sleeper cab is their home+office. ALL items 100% deductible: tools, TV, PlayStation, cooking appliances, electronics, bedding. Only groceries/medicine are personal.`;

// ---- Approved addition (owner decision 2026-07-09, PRODUCT DECISION —
// multi-truck fleet + drivers + payroll auto-routing): settlement gains
// driverName alongside the existing "unit" field (the truck's unit
// number — already extracted since the Session 6 fleet-scalability work,
// no rename needed). Carrier settlements print both; the mobile app
// matches unit → trucks.unit_number and driverName → drivers.name to
// auto-tag the settlement and all its rows (app/src/import/truckMatch.ts,
// app/src/import/driverMatch.ts). ----
const SETTLEMENT_SCHEMA_BEFORE =
  `"settlement":{"weekEnding":"","carrier":"","unit":"","grossRevenue":0,`;
const SETTLEMENT_SCHEMA_AFTER =
  `"settlement":{"weekEnding":"","carrier":"","unit":"","driverName":"","grossRevenue":0,`;

// ---- Approved addition (universal AI capture, owner decision 2026-07-10,
// PRODUCT DECISION): every docType's top-level object gains a
// "confidence":"high"|"low" field, right after taxDeductible. Patched into
// the base prompt's 4 embedded schemas (settlement/fuel/maintenance/amazon)
// so the model's own example JSON is self-consistent with the instruction
// in APPROVED_ADDITIONS_SUFFIX below — these BEFORE strings target only
// the outer docType/date/vendor/totalAmount/taxDeductible prefix, which no
// other patch above touches (they all patch nested sub-object keys), so
// patch order doesn't matter here. ----
const CONFIDENCE_SETTLEMENT_BEFORE =
  `{"docType":"settlement","date":"YYYY-MM-DD","vendor":"","totalAmount":0,"taxDeductible":true,"bizPct":100,"summary":""`;
const CONFIDENCE_SETTLEMENT_AFTER =
  `{"docType":"settlement","date":"YYYY-MM-DD","vendor":"","totalAmount":0,"taxDeductible":true,"confidence":"high","bizPct":100,"summary":""`;
const CONFIDENCE_FUEL_BEFORE =
  `{"docType":"fuel","date":"","vendor":"","totalAmount":0,"taxDeductible":true,"summary":""`;
const CONFIDENCE_FUEL_AFTER =
  `{"docType":"fuel","date":"","vendor":"","totalAmount":0,"taxDeductible":true,"confidence":"high","summary":""`;
const CONFIDENCE_MAINTENANCE_BEFORE =
  `{"docType":"maintenance","date":"","vendor":"","totalAmount":0,"taxDeductible":true,"summary":""`;
const CONFIDENCE_MAINTENANCE_AFTER =
  `{"docType":"maintenance","date":"","vendor":"","totalAmount":0,"taxDeductible":true,"confidence":"high","summary":""`;
const CONFIDENCE_AMAZON_BEFORE =
  `{"docType":"amazon","date":"","vendor":"","totalAmount":0,"taxDeductible":true,"bizPct":100,"summary":""`;
const CONFIDENCE_AMAZON_AFTER =
  `{"docType":"amazon","date":"","vendor":"","totalAmount":0,"taxDeductible":true,"confidence":"high","bizPct":100,"summary":""`;

// ---- Approved addition (industry knowledge base, owner decision
// 2026-07-10, PRODUCT DECISION — docs/INDUSTRY_TAXONOMY.md is the single
// source of truth): each settlement income/chargeback LINE gets classified
// with incomeType/chargebackType (see the classification instructions in
// APPROVED_ADDITIONS_SUFFIX below for the enums). ----
const REVENUE_ITEMS_BEFORE = `"revenueItems":[{"desc":"","order":"","amount":0}]`;
const REVENUE_ITEMS_AFTER = `"revenueItems":[{"desc":"","order":"","amount":0,"incomeType":""}]`;
const SETTLEMENT_DEDUCTIONS_BEFORE =
  `"deductions":[{"code":"","desc":"","balance":0,"amount":0,"category":"Software & Subscriptions|Legal & Accounting Fees|Insurance|Licensing & Permits|Fixed|Variable|Other"}]`;
const SETTLEMENT_DEDUCTIONS_AFTER =
  `"deductions":[{"code":"","desc":"","balance":0,"amount":0,"category":"Software & Subscriptions|Legal & Accounting Fees|Insurance|Licensing & Permits|Fixed|Variable|Other","chargebackType":""}]`;

const APPROVED_ADDITIONS_SUFFIX = `
APPROVED ADDITION (fuel/IFTA, owner decision 2026-07-03): for docType "fuel", also extract the US state as a 2-letter code (e.g. "TX", "OK") into fuel.state, read from the station's address on the receipt. If the state genuinely cannot be determined, leave fuel.state as "".

APPROVED ADDITION (w2, owner decision 2026-07-03 — household tax design): for a W-2 tax form, use docType "w2" (not "other"): {"docType":"w2","date":"","vendor":"","totalAmount":0,"taxDeductible":false,"confidence":"high","summary":"","w2":{"employer":"","employeeName":"","taxYear":0,"box1Wages":0,"box2FederalWithheld":0}}. vendor = the employer's name. date = the tax year's Dec 31 (e.g. "2026-12-31") if no other date appears on the form. totalAmount = box1Wages. taxDeductible is always false for a W-2 — it is income, not a business expense.

APPROVED ADDITION (item naming rules, owner decision 2026-07-07): every purchase item name must be accountant-readable — brand + product + model when the receipt shows them (e.g. "Milwaukee M18 Fuel 1/2in Impact Wrench", not "Impact Wrench" or "Item 1"). A fee/service/add-on line (shipping, protection plan, installation, gift wrap, warranty, "Add-on services", etc.) must state its purpose, and if it clearly covers one specific item on the same receipt, name that item in parentheses: "Extended warranty (for Milwaukee M18 Drill)". Never invent a vague generic name ("Misc item", "Product", "Item"). If an item's name genuinely cannot be determined from the document, set it to "NEEDS REVIEW: " followed by the verbatim text for that line from the receipt (e.g. "NEEDS REVIEW: SKU-88213-B").

APPROVED ADDITION (warranty extraction, owner decision 2026-07-07): a purchase item may carry warrantyYears (a number, halves allowed, e.g. 2.5 for a 2.5-year warranty) when the receipt states a warranty/protection-plan length for that item, and warrantyFor (the name of the item it covers) when the warranty is its own separate line rather than bundled into the item's own price. Omit both (or leave 0/"") when no warranty is stated.

APPROVED ADDITION (payment method classification, owner decision 2026-07-07): purchase.paymentMethod MUST be exactly one of these 9 values: "Business Checking", "Business Credit Card", "Personal Checking", "Personal Credit Card", "Cash", "Venmo", "Cash App", "Zelle Personal", "Zelle Business" — never a bank-brand string like "BofA Business". A card payment with no further signal defaults to "Business Credit Card". Venmo and Cash App payments are always personal funds — use "Venmo"/"Cash App" (there is no business variant for either). Zelle defaults to "Zelle Personal" unless the receipt clearly shows a business account/name as the payer, in which case use "Zelle Business".

APPROVED ADDITION (loads pickup/delivery dates, owner decision 2026-07-07 — feeds exact per-diem day-counting): for docType "settlement", each entry in settlement.loads should also include pickupDate and deliveryDate (both "YYYY-MM-DD") when the settlement/rate confirmation shows them. Leave them "" if genuinely not shown on the document — do not guess.

APPROVED ADDITION (payroll auto-routing, owner decision 2026-07-09): for docType "settlement", settlement.unit is the tractor/truck unit number and settlement.driverName is the driver's full name as printed on the settlement — most carrier settlements show both near the top or in a header/summary section. Extract both whenever shown; leave either "" if genuinely not present rather than guessing. Do not confuse driverName with the carrier name (settlement.carrier) — the carrier is the trucking company the settlement is issued by/through, the driver is the individual who ran the loads.

APPROVED ADDITION (carrier-agnostic settlement extraction, owner decision 2026-07-10 — universal AI capture): the settlement schema is carrier-agnostic — do NOT assume any single carrier's layout, field names, section order, or terminology. Extract the generic fields (carrier name, week ending, gross revenue, deductions, net pay, miles, loads, driver name, unit number) from WHATEVER settlement format is shown, from ANY carrier. The assets/operating/tolls/loans sub-sections are optional — leave them at their zero/empty defaults when a particular carrier's settlement doesn't include that section, rather than inventing data to fill them.

APPROVED ADDITION (confidence flag, owner decision 2026-07-10 — universal AI capture): every response's top-level object must include "confidence":"high"|"low" (already reflected in the settlement/fuel/maintenance/amazon schemas above — also include it for w2 and every docType below). Set "low" whenever any key field (amount, date, vendor/carrier name, category) is blurry, ambiguous, or a guess rather than clearly read from the document. The app highlights low-confidence documents for the user to review and confirm before saving — it will NOT silently trust a guess.

APPROVED ADDITION (new docTypes, owner decision 2026-07-10 — universal AI capture, "EVERY business income & expense document must be capturable"): six more docTypes, extracted into the shapes below instead of being forced into "amazon"/"store"/"other" when the document is clearly one of these:

- driver_payment — a receipt/confirmation of a payment TO one of the owner's OWN drivers (a payroll check stub, or a Zelle/Venmo/Cash App/PayPal confirmation where the recipient is a driver, not a store): {"docType":"driver_payment","date":"","vendor":"","totalAmount":0,"taxDeductible":true,"confidence":"high","summary":"","driverPayment":{"driverName":"","amount":0,"method":"","notes":""}}. driverName = the recipient's name. method = how it was paid (e.g. "Zelle", "Check", "Cash").

- insurance, lease_rent, factoring_statement, government_or_misc_income, and utility_subscription all share ONE shape — set financialDoc.kind to match the docType exactly: {"docType":"insurance","date":"","vendor":"","totalAmount":0,"taxDeductible":true,"confidence":"high","summary":"","financialDoc":{"kind":"insurance","description":"","amount":0,"reference":"","period":""}}
  - insurance: policy/premium statements. reference = policy number.
  - lease_rent: truck/trailer lease, parking, or office rent. reference = the leased asset or property name/address. description should say which (e.g. "Trailer lease — Unit 4471").
  - factoring_statement: a factoring company's statement. reference = the invoice number(s) factored, comma-separated. amount = the fee/discount CHARGED by the factor (not the gross invoice amount, which is already counted as settlement/load revenue elsewhere).
  - government_or_misc_income: detention pay, layover pay, FEMA/disaster relief payments, referral bonuses, or any other incidental business INCOME that did not come through a settlement. taxDeductible MUST be false for this one — it is income, not an expense. description should name the source (e.g. "Detention pay — Load #4471").
  - utility_subscription: a recurring utility or subscription bill for the business (phone, ELD service, etc — not already covered by docType "amazon"/"store"). period = the billing period shown (e.g. "March 2026").

APPROVED ADDITION (unknown financial documents, owner decision 2026-07-10 — universal AI capture, NEVER silently dropped): if a document is clearly some kind of business financial record but does not fit settlement/fuel/maintenance/amazon/store/toll/loan/w2/driver_payment/insurance/lease_rent/factoring_statement/government_or_misc_income/utility_subscription, use docType "other" with this shape: {"docType":"other","date":"","vendor":"","totalAmount":0,"taxDeductible":true,"confidence":"low","summary":"","suggestedCategory":""}. suggestedCategory is your best guess at what kind of expense/income this is, in plain English (e.g. "Parking fee", "Trailer rental", "Unclear — possibly a bank fee"). confidence is ALWAYS "low" for docType "other" — the app always requires the user to confirm the category and amount before saving, it never saves an "other" document silently.

APPROVED ADDITION (industry knowledge base, owner decision 2026-07-10 — docs/INDUSTRY_TAXONOMY.md is the single source of truth, keep this section in sync with it): for docType "settlement", classify EVERY revenueItems line with incomeType and EVERY deductions (chargeback) line with chargebackType — never leave a settlement line unclassified when it clearly fits one of these:
incomeType: linehaul | fuel_surcharge | accessorial (detention/layover/stop pay/tarp pay/hand-unload/extra stop/hazmat premium) | reimbursement (carrier paying back tolls/scales/washout/lumper/permits the driver already paid) | bonus (safety/referral/sign-on/fuel-efficiency) | trailer_rent | ifta_refund | other_income
chargebackType: fuel_advance | insurance_bobtail | insurance_physical_damage | insurance_occ_acc | insurance_cargo | insurance_workers_comp | eld_communications | plates_permits (often amortized weekly, e.g. an 18-week plate payback) | escrow_reserve | lease_purchase_payment | trailer_fee | cash_advance | loan_payment | drug_consortium | tolls_transponder | admin_processing_fee | factoring_fee | dispatch_fee | other_chargeback
Reimbursement vs income: a reimbursement (income_type "reimbursement") offsets the expense it repays; an IFTA refund (income_type "ifta_refund") is real income, not an expense offset — never confuse the two. This classification is informational only — it NEVER changes the net-pay math (gross/deductions/netPay stay exactly as extracted); withheld chargebacks are never re-counted as a tax deduction.

APPROVED ADDITION (category hints, owner decision 2026-07-10 — full list in docs/INDUSTRY_TAXONOMY.md, keep in sync): for purchase/store/other documents, brand names are strong category signals — DAT/Truckstop.com/load board → Software & Subscriptions; Comdata/EFS → Fuel & DEF; PrePass/EZPass/Drivewyze/CAT Scale → Tolls & Scales; OOIDA → Association Dues; Gusto/ADP/Paychex → Wages & Payroll Taxes (W-2); Triumph/RTS/"factoring" → Dispatch & Factoring Fees; Motive/KeepTruckin/Samsara/Omnitracs/PeopleNet → ELD & Communications.

APPROVED ADDITION (non-deductible traps, owner decision 2026-07-10 — flag, never silently deduct): if an item/line is clearly one of these common trucking-tax mistakes, prefix its description/summary with "PERSONAL — REVIEW: " instead of treating it as a normal 100%-deductible business expense: a standard-mileage-rate claim (never valid for a semi-truck — actual-expense method only), everyday/regular clothing (not OTR-specific safety gear or workwear), commuting (ordinary home-to-work travel), a security deposit (not an expense unless forfeited), or the PRINCIPAL portion of a loan payment (only the interest portion of a truck/trailer loan payment is deductible — note the split if the document shows one).
`;

// AI in user's language (owner decision 2026-07-10, PRODUCT DECISION —
// personalization & onboarding package, item 4): matches app/src/i18n's
// SUPPORTED_LOCALES. 'en' needs no instruction (the base prompt is already
// English) — every other locale gets an explicit language-name instruction
// since models follow "respond in Spanish" far more reliably than a bare
// locale code like "es".
const LOCALE_LANGUAGE_NAME: Record<string, string> = {
  es: "Spanish",
  ru: "Russian",
  ar: "Arabic",
  tr: "Turkish",
  hi: "Hindi",
  uk: "Ukrainian",
};

function buildExtractionPrompt(docHint?: string, locale?: string): string {
  let prompt = LEGACY_EXTRACTION_PROMPT
    .replace(FUEL_SCHEMA_BEFORE, FUEL_SCHEMA_AFTER)
    .replace(DOCTYPE_ENUM_BEFORE, DOCTYPE_ENUM_AFTER)
    .replace(LOADS_SCHEMA_BEFORE, LOADS_SCHEMA_AFTER)
    .replace(PURCHASE_SCHEMA_BEFORE, PURCHASE_SCHEMA_AFTER)
    .replace(IDENTITY_LINE_BEFORE, IDENTITY_LINE_AFTER)
    .replace(OTR_RULE_BEFORE, OTR_RULE_AFTER)
    .replace(SETTLEMENT_SCHEMA_BEFORE, SETTLEMENT_SCHEMA_AFTER)
    .replace(CONFIDENCE_SETTLEMENT_BEFORE, CONFIDENCE_SETTLEMENT_AFTER)
    .replace(CONFIDENCE_FUEL_BEFORE, CONFIDENCE_FUEL_AFTER)
    .replace(CONFIDENCE_MAINTENANCE_BEFORE, CONFIDENCE_MAINTENANCE_AFTER)
    .replace(CONFIDENCE_AMAZON_BEFORE, CONFIDENCE_AMAZON_AFTER)
    .replace(REVENUE_ITEMS_BEFORE, REVENUE_ITEMS_AFTER)
    .replace(SETTLEMENT_DEDUCTIONS_BEFORE, SETTLEMENT_DEDUCTIONS_AFTER);
  prompt += APPROVED_ADDITIONS_SUFFIX;
  if (docHint) {
    prompt += `\nThe user has hinted this document is likely a "${docHint}" — verify against the actual content, but use this as a tiebreaker only if the content is genuinely ambiguous.\n`;
  }
  const languageName = locale ? LOCALE_LANGUAGE_NAME[locale] : undefined;
  if (languageName) {
    prompt += `\nAPPROVED ADDITION (AI in user's language, owner decision 2026-07-10): write every free-text field (summary, and any description you compose yourself) in ${languageName} — the user's chosen app language. Standard financial/trucking terms may stay in English when there's no natural equivalent (e.g. "per diem", "ELD", "IFTA"). This does NOT apply to enum-like fields (docType, category, chargebackType, incomeType, serviceType, paymentMethod) or to text you copy verbatim from the document itself (vendor names, item names, addresses) — only to text you are generating/summarizing in your own words.\n`;
  }
  return prompt;
}

// ============================================================================
// Structured error helper — every failure path returns { error: { type, message } }
// so the app can render something specific instead of a generic failure toast.
// ============================================================================
type ErrorType =
  | "unauthenticated"
  | "bad_request"
  | "rate_limited"
  | "anthropic_error"
  | "model_refusal"
  | "parse_failed";

function errorResponse(type: ErrorType, message: string, status: number, extra?: Record<string, unknown>) {
  return new Response(
    JSON.stringify({ error: { type, message, ...extra } }),
    { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return errorResponse("bad_request", "Only POST is supported.", 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return errorResponse("unauthenticated", "Missing Authorization header.", 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return errorResponse("unauthenticated", "Invalid or expired session.", 401);
  }
  const userId = userData.user.id;

  let body: { fileBase64?: string; mediaType?: string; docHint?: string; locale?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("bad_request", "Request body must be valid JSON.", 400);
  }

  const { fileBase64, mediaType, docHint, locale } = body;
  if (!fileBase64 || !mediaType) {
    return errorResponse("bad_request", "fileBase64 and mediaType are required.", 400);
  }

  // Per-user rate limit: 30 imports/day, counted from documents rows already
  // saved today. RLS on `documents` already scopes this to the caller's own
  // rows since we're using their JWT, not a service-role client.
  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);
  const { count, error: countError } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("imported_at", startOfDayUtc.toISOString());
  if (countError) {
    return errorResponse("anthropic_error", "Could not check today's import count.", 500);
  }
  if ((count ?? 0) >= DAILY_IMPORT_LIMIT) {
    return errorResponse(
      "rate_limited",
      `Daily import limit reached (${DAILY_IMPORT_LIMIT}/day). Try again tomorrow.`,
      429,
    );
  }

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    return errorResponse("anthropic_error", "Server misconfigured: ANTHROPIC_API_KEY not set.", 500);
  }

  const isImage = mediaType.startsWith("image/");
  const contentBlock = isImage
    ? { type: "image", source: { type: "base64", media_type: mediaType, data: fileBase64 } }
    : { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBase64 } };

  const prompt = buildExtractionPrompt(docHint, locale);

  let anthropicResp: Response;
  try {
    anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        messages: [{ role: "user", content: [contentBlock, { type: "text", text: prompt }] }],
      }),
    });
  } catch (err) {
    return errorResponse("anthropic_error", `Network error calling Anthropic: ${(err as Error).message}`, 502);
  }

  if (!anthropicResp.ok) {
    const bodyText = await anthropicResp.text().catch(() => "");
    return errorResponse(
      "anthropic_error",
      `Anthropic API returned HTTP ${anthropicResp.status}.`,
      502,
      { detail: bodyText.slice(0, 500) },
    );
  }

  const data = await anthropicResp.json();
  if (data.error) {
    return errorResponse("anthropic_error", data.error.message ?? "Unknown Anthropic error.", 502);
  }
  if (data.stop_reason === "refusal") {
    return errorResponse("model_refusal", "The model declined to process this document.", 422);
  }

  const raw = (data.content ?? []).map((c: { text?: string }) => c.text ?? "").join("");

  let parsed: unknown = null;
  for (const attempt of [
    (t: string) => JSON.parse(t),
    (t: string) => JSON.parse(t.replace(/```json|```/g, "").trim()),
    (t: string) => {
      const m = t.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("no json found");
      return JSON.parse(m[0]);
    },
  ]) {
    try {
      parsed = attempt(raw);
      break;
    } catch {
      // try the next strategy
    }
  }

  if (!parsed) {
    return errorResponse(
      "parse_failed",
      "Could not parse a JSON extraction from the model's response.",
      422,
      { raw: raw.slice(0, 2000) },
    );
  }

  return new Response(JSON.stringify({ data: parsed }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
