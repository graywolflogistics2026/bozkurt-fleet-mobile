// supabase/functions/ai-import/index.ts
//
// Deno Edge Function — receipts/statements/settlements → structured JSON via
// the Anthropic API. ANTHROPIC_API_KEY lives only in this function's
// environment secrets; the mobile app never holds it (CLAUDE.md).
//
// POST body: { fileBase64: string, mediaType: string, docHint?: string, locale?: string, customCategories?: string[], learningRules?: { keyword: string, category: string }[], carrierCodeMaps?: { carrier: string, code: string, subCode: string | null, label: string, description: string | null }[], orderIndex?: number, pageOrder?: number[], priorPageExtractions?: { page: number, extraction: unknown }[], priorMissingPages?: number[] }
// learningRules (owner decision 2026-08-05, FULL PARITY follow-up item
// G, app/src/import/categoryLearning.ts) — the user's own learned
// keyword->category corrections, appended to the prompt as plain-text
// "USER CORRECTIONS" hints. PROMPT-CONTEXT ONLY: never used to fine-tune
// or retrain the model — the same one-shot-per-request behavior as every
// other prompt input here.
// orderIndex/pageOrder/priorPageExtractions/priorMissingPages (owner
// decision 2026-08-03, renamed/extended 2026-08-24 SPEED PASS) are set by
// the CLIENT on every call after the first one for a long multi-page PDF
// — see the TIMEOUT/PAGE-BUDGET comment below for the full reasoning. A
// response may include `nextOrderIndex` + `pageOrder` +
// `rawPageExtractions` + `rawMissingPages`, meaning: call again with
// those four values to keep going. `orderIndex` is a position INTO
// `pageOrder` (SMART PAGE TRIAGE's financially-meaningful-first
// ordering), not a raw page number — `pageOrder` is computed once (the
// first time a document enters the continuation path) and echoed back by
// the client on every later round so the server never needs to
// re-triage the same document twice.
// Auth: Supabase JWT in the Authorization header (required).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import {
  buildChunkPromptAddendum,
  mergeAllPages,
  runWithConcurrencyLimit,
  triagePageOrder,
  type ChunkExtraction,
  type PageByteSize,
  type PageOutcome,
  type PageRange,
} from "./chunking.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DAILY_IMPORT_LIMIT = 30;
const ANTHROPIC_MODEL = "claude-sonnet-4-6";
// RAISED (owner decision 2026-08-02, "settlement imports failing
// frequently" audit): a busy multi-page carrier settlement's extraction
// — many loads + tolls + withheld deductions, all as structured JSON —
// can genuinely need more than 8000 output tokens; a truncated response
// fails every one of this function's own JSON.parse() fallback attempts
// and surfaces as a generic "parse_failed" with no indication that the
// real cause was hitting this ceiling, not a genuinely malformed
// response. 16000 is a conservative near-doubling for any current Claude
// Sonnet-class model's output limit — monitor Anthropic API responses
// after deploy for a 400 validation error on this parameter, which would
// mean the actual model in use supports less than this value. Chunking
// (below) also means each INDIVIDUAL call now covers fewer pages, so
// 16000 is comfortably more headroom per call than before, not less.
const ANTHROPIC_MAX_TOKENS = 16000;

// TIMEOUT/PAGE-BUDGET, ROUND 5 — MEASURED EVIDENCE (owner decision
// 2026-08-03). Real per-page Anthropic call durations from Supabase's
// own `ai-import` function logs (the round-4 `console.log` per attempt):
//   23866ms, status 200        — one page, succeeded
//   40003ms, TIMED OUT         — one page, killed at round 3's 40s cap
//   39121ms, status 200        — one page, barely made it under 40s
// Conclusion (owner's own diagnosis, confirmed by these numbers): this
// was a BUDGET problem, not an architecture problem. A single page can
// legitimately need up to (and apparently sometimes just past) 40
// seconds — our own 40s AbortController was killing legitimate, still-
// working calls. THAT is why round 3's device test showed "Imported
// pages 1-1 of 11": page 2 didn't fail because of a real error, it
// failed because WE gave up on it too early, and round 3's design then
// stopped the entire continuation at that first failure.
//
// Three changes, precisely targeted at this evidence:
//  1. PAGE_TIMEOUT_MS raised 40s -> 110s (per-page, first attempt) —
//     comfortable margin over the ~40s worst case actually observed,
//     while still leaving real headroom under Supabase's VERIFIED 150s
//     wall-clock ceiling for one invocation
//     (https://supabase.com/docs/guides/functions/limits — the "400s"
//     figure is for `EdgeRuntime.waitUntil()` background work, which
//     this function never uses).
//  2. PAGES_PER_BATCH reduced 3 -> 2 — fewer pages attempted per
//     invocation keeps the common-case invocation short, and combined
//     with the dynamic per-invocation time-budget tracking below (NOT
//     just a fixed page count), the SAME code stays safe even if a page
//     takes far longer than the 24-40s typically measured.
//  3. A single-page timeout is NO LONGER FATAL to the whole document.
//     `runPageWithRetry()` gives a page ONE extra attempt at a shorter
//     PAGE_RETRY_TIMEOUT_MS budget; if that ALSO fails, the page is
//     recorded MISSING (chunking.ts's `mergeAllPages`, gap-tolerant —
//     replaces round 3's stop-at-first-failure `mergeSequentialPageResults`)
//     and the loop moves on to every remaining page regardless — "the
//     loop must always attempt every page" (owner decision). A
//     genuinely incomplete result (any missing page) still can't be
//     saved: the settlement reconciliation hard guard
//     (settlementReconciliation.ts) independently catches the resulting
//     mismatched totals and blocks Save, same as before.
//
// DYNAMIC TIME-BUDGET TRACKING (why a fixed "2 pages always fits" isn't
// safe on its own): the measured evidence shows single-page duration is
// NOT constant (23.9s to >40s within the same document) — a fixed
// assumption that 2 pages always completes in some bounded time is
// exactly the same class of guess that caused this bug. Instead,
// `remainingInvocationBudgetMs()` tracks real elapsed wall-clock time
// since THIS invocation started and every page attempt's own timeout is
// capped at `min(PAGE_TIMEOUT_MS, remaining budget - safety margin)` —
// if there isn't enough budget left to safely attempt (or retry)
// another page, the loop stops THERE (not mid-attempt) and hands off to
// a fresh invocation via `nextOrderIndex`, which gets its own full 150s
// budget. This guarantees the platform's hard ceiling is never at risk
// regardless of how slow any individual page turns out to be — "more
// round trips is fine — they are cheap" (owner decision).
const IMAGE_TIMEOUT_MS = 90_000;
const SINGLE_CALL_TIMEOUT_MS = 120_000;
const PAGE_TIMEOUT_MS = 110_000;
// Shorter than PAGE_TIMEOUT_MS on purpose — this is a page's SECOND,
// last-chance attempt after already timing out once; burning another
// full 110s risks the platform's own 150s ceiling more than it's worth,
// especially within a batch that still has a 2nd page to get to.
const PAGE_RETRY_TIMEOUT_MS = 30_000;
const PAGES_PER_BATCH = 2;

// CONTROLLED CONCURRENCY (owner decision 2026-08-24, SPEED PASS — device
// report: a strictly-sequential, one-page-at-a-time continuation made an
// 11-page settlement take 3-5 minutes wall-clock). An EARLIER attempt at
// speeding this up fired a whole batch via uncontrolled `Promise.all` and
// caused real Anthropic rate-limit/contention failures — which is
// precisely why processing went fully sequential in the first place (see
// this file's own "ROUND 5 — MEASURED EVIDENCE" comment above). This is
// the middle ground: at most `BATCH_CONCURRENCY` pages run at once
// (chunking.ts's `runWithConcurrencyLimit`), never the whole batch at
// once and never strictly one at a time. PAGES_PER_BATCH is deliberately
// left at 2 this pass (not increased) — with concurrency also 2, this
// means each invocation's (up to) 2 pages fire TOGETHER as one wave
// instead of sequentially, which is the direct fix for the reported
// slowness without adding the multi-wave-per-invocation complexity a
// larger batch size would need. Configurable server-side via the
// AI_IMPORT_BATCH_CONCURRENCY environment variable (falls back to the
// default below on anything missing/invalid) so this can be tuned without
// a code change/redeploy if real-world timing suggests a different value.
const DEFAULT_BATCH_CONCURRENCY = 2;
function readBatchConcurrency(): number {
  const raw = Deno.env.get("AI_IMPORT_BATCH_CONCURRENCY");
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BATCH_CONCURRENCY;
}
const BATCH_CONCURRENCY = readBatchConcurrency();
// Below this much remaining invocation budget, don't even start another
// page attempt (first try OR retry) — hand off to a fresh invocation
// instead, which gets a full new 150s budget. Sized so a page that DOES
// get attempted always has at least a fighting chance to complete before
// the platform would kill the whole invocation regardless of our own
// AbortController.
const MIN_USEFUL_BUDGET_MS = 20_000;
// 5s safety margin under Supabase's VERIFIED 150s ceiling for this
// invocation's own non-Anthropic overhead (auth, the daily-import-count
// query, pdf-lib parsing/splitting, JSON merging, response
// serialization) on top of whatever Anthropic call time was used.
const HARD_INVOCATION_BUDGET_MS = 145_000;
// Defensive ceiling only — real settlements are nowhere near this long;
// stops a pathological/corrupt PDF (that still passed the 10MB size
// guard) from driving an unbounded number of client-side continuation
// round-trips.
const MAX_TOTAL_PAGES = 60;

// Retry ONLY for a genuine TRANSIENT failure (a real network-level throw,
// or a 5xx/529-overloaded response from Anthropic) — never for a 4xx
// (bad request/auth/billing, which retrying can't fix) and, as of this
// pass, never for a timeout/AbortError either (see callAnthropicMessages
// below — that used to retry too, silently doubling the wait).
const MAX_ANTHROPIC_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 800;

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
// 6 more docTypes on top of the existing w2 addition; AI feature package
// (owner decision 2026-07-10 — compliance tracker) added 5 more on top of
// that (see APPROVED_ADDITIONS_SUFFIX below for each one's schema).
const DOCTYPE_ENUM_AFTER =
  `docType: settlement|fuel|maintenance|amazon|store|toll|loan|w2|driver_payment|insurance|lease_rent|factoring_statement|government_or_misc_income|utility_subscription|medical_card|inspection_report|registration_cab_card|irs_2290_schedule1|insurance_policy|loan_agreement|other`;

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

// ---- Approved addition (date anchor, owner decision 2026-07-30,
// DEFINITIVE FIX — owner's own field diagnosis): settlement gains
// printDate, the unambiguous header "DATE:" print date (see
// APPROVED_ADDITIONS_SUFFIX below for the full extraction/resolution
// instruction). Chained after the driverName patch above — BEFORE here
// targets that patch's own AFTER text. ----
const PRINTDATE_SCHEMA_BEFORE = SETTLEMENT_SCHEMA_AFTER;
const PRINTDATE_SCHEMA_AFTER =
  `"settlement":{"weekEnding":"","printDate":"","carrier":"","unit":"","driverName":"","grossRevenue":0,`;

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
// CRITICAL BUG FIX (owner decision 2026-08-05, FULL PARITY pass): this
// schema's category enum was a SHORTER, STALE list — 7 legacy values that
// don't even match app/src/import/category.ts's CANONICAL_CATEGORIES,
// meaning the AI could (and did) return a category string the app's own
// picker doesn't recognize. CATEGORY_ENUM_STRING below is generated from
// the SAME canonical list the app uses (kept in sync manually — this Deno
// function can't import a TS module from app/, same constraint as every
// other "keep in sync" comment in this file — see docs/INDUSTRY_TAXONOMY.md
// §B, the single source of truth, whenever either list changes).
const CATEGORY_ENUM_STRING =
  "Fuel & DEF|Fuel Additives|Maintenance & Repairs|Major Repairs & Overhauls|Truck Parts|Tires|Truck Wash & Detailing|Truck/Trailer Payments|Insurance—Truck|Insurance—Health|Permits, Licenses & Road Taxes|Tolls & Scales|Parking & Lodging|ELD & Communications|Software & Subscriptions|Dispatch & Factoring Fees|Legal & Professional Services|Office & Admin|Safety Gear & Workwear|Truck Supplies & Equipment|Tools & Equipment|Electronics|Comfort & Sleeper|Warranty & Service Contracts|Lumper Fees|Contract Labor (1099)|Wages & Payroll Taxes (W-2)|Bank & Merchant Fees|Advertising|Training & Education|Association Dues|Lease & Rent|Utilities & Subscriptions|Meals (per diem covered)|Advance Repayment|Escrow & Deposits|Misc|Other";
const SETTLEMENT_DEDUCTIONS_BEFORE =
  `"deductions":[{"code":"","desc":"","balance":0,"amount":0,"category":"Software & Subscriptions|Legal & Accounting Fees|Insurance|Licensing & Permits|Fixed|Variable|Other"}]`;
const SETTLEMENT_DEDUCTIONS_AFTER =
  `"deductions":[{"code":"","desc":"","balance":0,"amount":0,"category":"${CATEGORY_ENUM_STRING}","chargebackType":""}]`;

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
chargebackType: fuel_advance | insurance_bobtail | insurance_physical_damage | insurance_occ_acc | insurance_cargo | insurance_workers_comp | eld_communications | plates_permits (often amortized weekly, e.g. an 18-week plate payback) | escrow_reserve | lease_purchase_payment | trailer_fee | cash_advance | loan_payment | advance_repayment (a repayment of a PRIOR advance already given — e.g. an extended-warranty or company-store credit — this is loan principal being paid back, distinct from cash_advance which is a NEW advance being deducted back the same week it was given) | drug_consortium | tolls_transponder | admin_processing_fee | factoring_fee | dispatch_fee | other_chargeback
Reimbursement vs income: a reimbursement (income_type "reimbursement") offsets the expense it repays; an IFTA refund (income_type "ifta_refund") is real income, not an expense offset — never confuse the two. This classification is informational only — it NEVER changes the net-pay math (gross/deductions/netPay stay exactly as extracted); withheld chargebacks are never re-counted as a tax deduction.

APPROVED ADDITION (category hints, owner decision 2026-07-10 — full list in docs/INDUSTRY_TAXONOMY.md, keep in sync): for purchase/store/other documents, brand names are strong category signals — DAT/Truckstop.com/load board → Software & Subscriptions; Comdata/EFS → Fuel & DEF; PrePass/EZPass/Drivewyze/CAT Scale → Tolls & Scales; OOIDA → Association Dues; Gusto/ADP/Paychex → Wages & Payroll Taxes (W-2); Triumph/RTS/"factoring" → Dispatch & Factoring Fees; Motive/KeepTruckin/Samsara/Omnitracs/PeopleNet → ELD & Communications.

APPROVED ADDITION (non-deductible traps, owner decision 2026-07-10 — flag, never silently deduct): if an item/line is clearly one of these common trucking-tax mistakes, prefix its description/summary with "PERSONAL — REVIEW: " instead of treating it as a normal 100%-deductible business expense: a standard-mileage-rate claim (never valid for a semi-truck — actual-expense method only), everyday/regular clothing (not OTR-specific safety gear or workwear), commuting (ordinary home-to-work travel), a security deposit (not an expense unless forfeited), or the PRINCIPAL portion of a loan payment (only the interest portion of a truck/trailer loan payment is deductible — note the split if the document shows one).

APPROVED ADDITION (compliance tracker, owner decision 2026-07-10 — AI feature package): five more docTypes, all sharing ONE shape — set compliance.type to match the docType exactly: {"docType":"medical_card","date":"","vendor":"","totalAmount":0,"taxDeductible":false,"confidence":"high","summary":"","compliance":{"type":"medical_card","label":"","dueDate":"","issueDate":""}}. taxDeductible is always false for all five — these are compliance/regulatory documents, not expenses (an insurance_policy document here is the POLICY ITSELF for tracking its renewal date — a separate insurance BILL/statement still uses docType "insurance" above, routed as a normal expense). dueDate ("YYYY-MM-DD") is the single most important field — the date the card/inspection/registration/filing/policy EXPIRES or is next DUE; issueDate is the date it was issued/effective, when shown. NEVER guess dueDate — if the document genuinely doesn't show an expiration/due/renewal date, leave dueDate "" rather than inventing one; the document still gets archived, it just won't create a trackable compliance item.
- medical_card: a DOT medical examiner's certificate. dueDate = the certificate's expiration date.
- inspection_report: an annual DOT vehicle inspection report/sticker. dueDate = next inspection due date (often exactly 12 months after the inspection date shown).
- registration_cab_card: an IRP (International Registration Plan) cab card or vehicle registration. dueDate = the registration's expiration date.
- irs_2290_schedule1: a stamped IRS Form 2290 Schedule 1 (proof of Heavy Vehicle Use Tax payment). dueDate = the NEXT year's HVUT due date if determinable from the tax period shown (HVUT is annually due August 31 for the July-June tax period), otherwise leave "" rather than guessing.
- insurance_policy: a commercial trucking insurance policy declarations page. dueDate = the policy's renewal/expiration date. label should name the coverage type if shown (e.g. "Physical Damage Insurance", "Cargo Insurance").
label is a short human-readable name for the specific item (e.g. "Medical Card — John Smith", "Unit 4471 Annual Inspection") — when the document doesn't make a more specific label obvious, leave label "" and the app supplies a sensible default per type.

APPROVED ADDITION (meals & advance repayments, owner decision 2026-07-17 — net-pay model, never double-book): a settlement deduction (chargeback) line, a store/receipt line item, or an entire store/receipt document that is clearly a RESTAURANT/food purchase — a truck-stop restaurant charge, a carrier point-of-sale meal, a cafe, a diner, or a "grill" that IS a restaurant (e.g. "Bob's Bar & Grill", "Waffle House", "Pilot Travel Center Restaurant") — must be categorized "Meals (per diem covered)". For a store/receipt document that is ENTIRELY a restaurant receipt (not a grocery/retail store that merely sells food), set the document's taxDeductible to false — per diem already covers meals, so it must never be double-booked as a separate deduction. CAUTION: a truck GRILLE (the tractor's front-end part/assembly, e.g. "Freightliner Cascadia grille", "chrome grille insert") is EQUIPMENT, not a meal — only classify as "Meals (per diem covered)" when the context is unambiguously a restaurant/food purchase, never merely because the word "grill"/"grille" appears. For a settlement deduction line that is a plain repayment of a prior advance (chargebackType "advance_repayment" above — e.g. a weekly payment recovering an extended-warranty or company-store advance), set its category to "Advance Repayment" — this is loan principal, never a new deductible expense. EXCEPTION: if the "advance" line is actually the settlement's mechanism for paying an outside service on the driver's behalf (e.g. an outside lumper fee) and there is a MATCHING reimbursement/income line for the same amount elsewhere in the settlement, do NOT use chargebackType "advance_repayment" — classify the deduction with its normal category (or leave chargebackType unset) and the matching income line as incomeType "reimbursement" instead, since that is a real business expense being washed through the settlement, not a loan repayment.

APPROVED ADDITION (asset purchase & financing, owner decision 2026-07-30, PRODUCT DECISION): for a truck/trailer/equipment LOAN or FINANCING AGREEMENT (a note, retail installment contract, or lender statement showing the terms of a purchase loan — NOT a routine payment receipt, which is docType "loan" above), use docType "loan_agreement": {"docType":"loan_agreement","date":"","vendor":"","totalAmount":0,"taxDeductible":false,"confidence":"high","summary":"","loanAgreement":{"lender":"","amount":0,"apr":0,"payment":0,"frequency":"","nextDue":"","assetType":"truck","assetName":""}}. lender = the financing company/bank name (also use as vendor). amount = the original loan/financed amount (also use as totalAmount). apr = the interest rate as a plain number (e.g. 7.5 for 7.5%), 0 if not shown. payment = the recurring payment amount. frequency = how often it's due (e.g. "monthly", "weekly"). nextDue = the next payment due date if shown, else "". assetType is your best read of what's being financed — "truck" (a tractor), "trailer", "equipment" (anything else physical — a generator, reefer unit, etc.), or "other" if genuinely unclear. assetName = the unit number, VIN, or equipment name/description shown on the document, whatever identifies WHICH asset this is (e.g. "Unit 4471", "2024 Great Dane Reefer Trailer") — leave "" if the document doesn't identify a specific asset. taxDeductible is always false at the document level — only the loan's INTEREST is ever deductible (handled by the existing loan-payment deduction logic, never this document itself).

APPROVED ADDITION (weekly miles only, owner decision 2026-08-02, CRITICAL BUG FIX — verified against a real statement that printed 0 loaded miles this week alongside a large "LTD MILES"/lifetime figure): settlement.totalMiles MUST be THIS SETTLEMENT WEEK's own miles only — the figure shown next to this week's revenue/loads section, NOT any lifetime-to-date, quarter-to-date, or year-to-date odometer/mileage total the statement also prints elsewhere (commonly labeled "LTD MILES", "MILES QTD", "YTD MILES", "Odometer", or similar cumulative labels). These cumulative figures are always much larger than one week's driving and must NEVER be substituted for totalMiles. If the document shows loads for the week, totalMiles should be consistent with (ideally the sum of) those loads' own loaded_miles + empty_miles — if the week's loads list is empty (a "home week," no freight moved), totalMiles is 0, never a nonzero lifetime figure. When genuinely unsure which printed number is this week's own total, prefer summing the individual loads' mileage over any single "TOTAL MILES" label that could be ambiguous.

APPROVED ADDITION (escrow & deposits, owner decision 2026-08-02, PRODUCT DECISION — verified against a real statement with a "PERFORMNCE BOND" OCR-damaged line): a settlement deduction line that is a REFUNDABLE DEPOSIT the carrier holds on the driver's behalf — a performance bond, escrow reserve, tire fund, emergency fund, or maintenance reserve (including OCR-damaged/misspelled variants of these words, e.g. "PERFORMNCE BOND", "ESCROW RESRV", "TIRE FND") — is NOT a business expense; it is money temporarily held by the carrier that is typically returned later. Set its chargebackType to "escrow_reserve" (already in the chargebackType enum below) so the app books it as a non-deductible "Escrow & Deposits" category rather than a real cost. Do not confuse this with a one-time cash_advance (money given to the driver, deducted back the same or a later week) or advance_repayment (repaying a PRIOR advance/purchase credit, e.g. an extended warranty) — an escrow/bond/reserve/fund deduction is a DEPOSIT the carrier is holding, conceptually different from either of those.

APPROVED ADDITION (settlement-line classifier + new categories, owner decision 2026-08-05, FULL PARITY pass — a real device statement's unmapped chargeback codes were landing in "Misc" with zero accountant-usable detail): the category enum above now includes six new categories — classify a settlement deduction/purchase item into these when it fits, using GENERIC, carrier-neutral wording/concepts only (any carrier may abbreviate differently — match by MEANING, not exact spelling): "Fuel Additives" (anti-gel, diesel treatment, cetane booster, injector cleaner — Howes/Power Service/Hot Shot's/Lucas/Archoil/Stanadyne/Diesel 911 — never bare pump fuel, which stays "Fuel & DEF"), "Truck Parts" (a CONSUMED part the owner installs himself — alternator, starter, battery, belts, hoses, filters, mirrors, lights, sensors, wheel seals, brake shoes, mud flaps, wiper blades — distinct from "Tools & Equipment", a reusable TOOL kept after the job: wrench, impact gun, jack, tool box, blower, grease gun), "Major Repairs & Overhauls" (a single invoice OVER $2,500 rebuilding a major component — engine in-frame, transmission, differential, cab, repaint — note in your summary that this may be a capital improvement the user's CPA should review), "Truck Wash & Detailing", "Warranty & Service Contracts" (an extended warranty/service-contract PURCHASE), and "Lumper Fees" (a lumper/unloading fee — including an ADVANCE-shaped settlement line that names an outside lumper, which stays deductible Lumper Fees even though it contains the word "ADV": this is different from a plain "ADVANCE"/"ADV" line with no lumper wording, which is chargebackType "advance_repayment" / category "Advance Repayment", non-deductible loan-principal repayment). CARRIER ISOLATION: a settlement chargeback CODE is one specific carrier's own internal abbreviation (e.g. one carrier's own "EXTEND WR PURCH" or "EZ FAST LN") and means nothing outside that carrier's own statements — never apply a code meaning you've seen from one carrier's document to any other carrier's document. If this document's carrier is confirmed against one of the named carrier code blocks appended below, use ONLY that carrier's own code meanings for its codes; otherwise (an unrecognized or unconfirmed carrier) classify every line using the generic, carrier-neutral concepts above and your own general knowledge, never a specific code you recall from a different carrier. A SHOP INVOICE that includes LABOR (not just parts) -> "Maintenance & Repairs". Split a receipt that mixes consumed PARTS and reusable TOOLS into separate line items with their own correct category each — never lump them into one line under a single guessed category.
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

function buildExtractionPrompt(
  docHint?: string,
  locale?: string,
  customCategories?: string[],
  learningRules?: { keyword: string; category: string }[],
  carrierCodeMaps?: { carrier: string; code: string; subCode: string | null; label: string; description: string | null }[]
): string {
  let prompt = LEGACY_EXTRACTION_PROMPT
    .replace(FUEL_SCHEMA_BEFORE, FUEL_SCHEMA_AFTER)
    .replace(DOCTYPE_ENUM_BEFORE, DOCTYPE_ENUM_AFTER)
    .replace(LOADS_SCHEMA_BEFORE, LOADS_SCHEMA_AFTER)
    .replace(PURCHASE_SCHEMA_BEFORE, PURCHASE_SCHEMA_AFTER)
    .replace(IDENTITY_LINE_BEFORE, IDENTITY_LINE_AFTER)
    .replace(OTR_RULE_BEFORE, OTR_RULE_AFTER)
    .replace(SETTLEMENT_SCHEMA_BEFORE, SETTLEMENT_SCHEMA_AFTER)
    .replace(PRINTDATE_SCHEMA_BEFORE, PRINTDATE_SCHEMA_AFTER)
    .replace(CONFIDENCE_SETTLEMENT_BEFORE, CONFIDENCE_SETTLEMENT_AFTER)
    .replace(CONFIDENCE_FUEL_BEFORE, CONFIDENCE_FUEL_AFTER)
    .replace(CONFIDENCE_MAINTENANCE_BEFORE, CONFIDENCE_MAINTENANCE_AFTER)
    .replace(CONFIDENCE_AMAZON_BEFORE, CONFIDENCE_AMAZON_AFTER)
    .replace(REVENUE_ITEMS_BEFORE, REVENUE_ITEMS_AFTER)
    .replace(SETTLEMENT_DEDUCTIONS_BEFORE, SETTLEMENT_DEDUCTIONS_AFTER);
  prompt += APPROVED_ADDITIONS_SUFFIX;
  // DATE HARDENING round 2 (owner decision 2026-07-30): round 1 only
  // caught OBVIOUSLY implausible dates. A carrier-header year/day swap
  // (26/07/24 misread as DD/MM/YY comes out 2024-07-26) can land INSIDE
  // that plausible window on its own — 2024 isn't an absurd year — so it
  // slipped through. Injecting today's actual date + an explicit
  // cross-check instruction is the first line of defense; the client
  // also runs a second, deterministic pass (src/import/dateGuard.ts) that
  // actively prefers whichever reading is closer to "a real recent
  // document" when the two disagree by more than a swap's worth.
  const todayIso = new Date().toISOString().slice(0, 10);
  prompt += `\nAPPROVED ADDITION (date hardening round 2, owner decision 2026-07-30): today's date is ${todayIso}. Statement dates are almost always within the last ~13 months of today. Carrier headers commonly print dates as YY/MM/DD (26/07/24 = 2026-07-24) while other fields on the same document print M/D/YY (7/16/26) — CROSS-CHECK every extracted date against every OTHER date in the same document; they must agree on the year and cluster near the statement date. If one reading of an ambiguous date places the document more than 13 months in the past while an alternative reading lands near today, choose the near-today reading.\n`;
  // DATE HARDENING round 3 (owner decision 2026-07-30, CRITICAL BUG FIX):
  // round 2's "prefer the near-today reading" instruction was written to
  // resolve an AMBIGUOUS reading of a date that IS printed on the
  // document (a year/day-order swap) — but nothing stopped the model from
  // over-applying that same "near-today" preference to INVENT a
  // weekEnding when the document's real week-ending text couldn't be
  // found at all, which made every settlement land on ~today and
  // incorrectly collide with the "same week" replace logic
  // (aiImportSave.ts findExistingSettlement()). This addition is
  // deliberately explicit and settlement-specific so the two rules can
  // never be conflated again.
  prompt += `\nAPPROVED ADDITION (date hardening round 3 — settlement week ending must never be guessed, owner decision 2026-07-30, CRITICAL BUG FIX): settlement.weekEnding must be read directly from the document's own "week ending" / "settlement date" / "pay period ending" text (or computed from a clearly-printed pay-period date range shown on the same document) — NEVER inferred, defaulted, or approximated from today's date (${todayIso}) or from any other unrelated date on the document. The "prefer the near-today reading" instruction above applies ONLY when choosing between two possible READINGS of a date that IS printed on the document (e.g. resolving a year/day-order ambiguity) — it is never license to invent a week-ending date that is not printed on the document at all. If the week-ending date genuinely cannot be found anywhere on the document, leave settlement.weekEnding as "" and do not guess — the app will require the user to enter it before saving.\n`;
  // DATE HARDENING round 4 (owner decision 2026-07-30, DEFINITIVE FIX —
  // owner's own field diagnosis): carrier statements print TWO dates in
  // the header — an unambiguous print date ("DATE:", commonly M/D/YY,
  // impossible to misread since a day value >12 rules out the alternate
  // month/day order) printed ~1 day BEFORE the settlement week, and the
  // ambiguous "SETTLEMENTS DATE:" (commonly YY/MM/DD) which IS
  // weekEnding. Anchoring weekEnding's digit-order resolution to the
  // unambiguous print date is strictly more reliable than round 2's
  // "closest to today" heuristic, since only one reading can ever land in
  // the tight post-print-date window a real settlement week must fall in.
  prompt += `\nAPPROVED ADDITION (date hardening round 4 — settlement date anchor, owner decision 2026-07-30, DEFINITIVE FIX): carrier settlement statements print TWO dates in their header — an unambiguous "DATE:" print date (commonly M/D/YY — this order is certain because a day value over 12 rules out reading it any other way) printed about 1 day BEFORE the settlement week, and the "SETTLEMENTS DATE:" (commonly YY/MM/DD) which IS the week-ending date but whose digit order is ambiguous. Extract the print date into settlement.printDate (YYYY-MM-DD) whenever the "DATE:" header line is shown. Then resolve settlement.weekEnding by choosing whichever reading of the SETTLEMENTS DATE — read literally as printed, OR with its year and day digits swapped — falls within the 7-day window starting at printDate (printDate through printDate+7 days). Example: printDate 2026-07-16, SETTLEMENTS DATE printed "26/07/17" -> weekEnding "2026-07-17" (the alternate reading "2017-07-26" falls outside the window and must be rejected). If neither reading falls in that window, or the print date cannot be determined, leave weekEnding "" rather than guessing — never fall back to today's date (round 3 above already forbids that).\n`;
  if (docHint) {
    prompt += `\nThe user has hinted this document is likely a "${docHint}" — verify against the actual content, but use this as a tiebreaker only if the content is genuinely ambiguous.\n`;
  }
  const languageName = locale ? LOCALE_LANGUAGE_NAME[locale] : undefined;
  if (languageName) {
    prompt += `\nAPPROVED ADDITION (AI in user's language, owner decision 2026-07-10): write every free-text field (summary, and any description you compose yourself) in ${languageName} — the user's chosen app language. Standard financial/trucking terms may stay in English when there's no natural equivalent (e.g. "per diem", "ELD", "IFTA"). This does NOT apply to enum-like fields (docType, category, chargebackType, incomeType, serviceType, paymentMethod) or to text you copy verbatim from the document itself (vendor names, item names, addresses) — only to text you are generating/summarizing in your own words.\n`;
  }
  if (customCategories && customCategories.length > 0) {
    prompt += `\nAPPROVED ADDITION (custom categories, owner decision 2026-07-10): this user has also defined their own categories beyond the standard list above: ${customCategories.join(", ")}. When categorizing a purchase item (guessCategory-equivalent) or an unrecognized document's suggestedCategory (docType "other"), suggest one of THESE if it fits better than a standard category — never invent a new custom category name yourself, only pick from this exact list or fall back to a standard category.\n`;
  }
  // CATEGORY LEARNING LAYER (owner decision 2026-08-05, FULL PARITY
  // follow-up item G) — plain prompt-context hints only, applied the SAME
  // way every session: this is NOT a fine-tuning/training signal, just
  // extra context appended to this one request's prompt, exactly like
  // docHint/customCategories above.
  if (learningRules && learningRules.length > 0) {
    const hints = learningRules.map((r) => `"${r.keyword}" -> ${r.category}`).join("; ");
    prompt += `\nUSER CORRECTIONS (this user has manually corrected these categorizations before — prefer these when a description matches, but this is a hint, not an override of clear evidence on the document itself): ${hints}\n`;
  }
  // CARRIER-SCOPED PAYROLL/SETTLEMENT CODES (owner decision, critical
  // isolation rule — see CLAUDE.md's own dated entry for the full
  // invariant). The carrier itself isn't known until AFTER extraction (this
  // function makes a SINGLE Anthropic call per document, never a two-pass
  // "detect carrier first" flow), so every SEEDED carrier's own code map is
  // included here, each one wrapped in an explicit "ONLY IF you can confirm
  // THIS carrier from the document's own letterhead" instruction — the
  // model is never told to guess or apply a code map speculatively. The
  // REAL enforcement is a deterministic, carrier-scoped step the client
  // applies AFTER extraction using the settlement's own actually-extracted
  // carrier text (app/src/import/carrierCodes.ts's findCarrierCodeMatch()),
  // which is what actually GUARANTEES isolation regardless of what the
  // model does with this hint.
  if (carrierCodeMaps && carrierCodeMaps.length > 0) {
    const byCarrier = new Map<string, typeof carrierCodeMaps>();
    for (const c of carrierCodeMaps) {
      if (!byCarrier.has(c.carrier)) byCarrier.set(c.carrier, []);
      byCarrier.get(c.carrier)!.push(c);
    }
    const blocks = Array.from(byCarrier.entries()).map(([carrier, entries]) => {
      const lines = entries
        .map((e) => `${e.code}${e.subCode ? `/${e.subCode}` : ""} = ${e.label}${e.description ? ` (${e.description})` : ""}`)
        .join("; ");
      return `If — and ONLY if — this document's own letterhead/header confirms the carrier is "${carrier}", these settlement line codes mean: ${lines}. If the carrier is anything else, ignore this list entirely.`;
    });
    prompt += `\nAPPROVED ADDITION (carrier-scoped settlement codes, never applied across carriers): ${blocks.join(" ")}\n`;
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
  | "parse_failed"
  // Owner decision 2026-08-02 ("settlement imports failing frequently"
  // audit): the model's response hit ANTHROPIC_MAX_TOKENS and was cut off
  // mid-JSON — a genuinely different, actionable failure from a malformed
  // response (parse_failed), which the client should message distinctly
  // ("try splitting this into fewer pages" rather than "try a clearer
  // photo").
  | "truncated"
  // Same audit: the Anthropic call itself timed out (ANTHROPIC_TIMEOUT_MS)
  // even after the one retry — distinct from a plain network error so the
  // client can say "this took too long" rather than "could not connect."
  | "timeout"
  // USAGE LIMITS BY FLEET SIZE + CREDIT PACKS (owner decision 2026-08-24,
  // FIVE ADDITIONS pass, PART 5) — the monthly ai-import allowance (60 per
  // active truck, docs/PENDING_SQL.md's ai_usage_config) plus any owner-
  // granted credit packs are both exhausted. Returned BEFORE any Anthropic
  // call is made (checked only on isFirstCall — an in-progress multi-page
  // continuation is never cut off mid-document).
  | "usage_limit_reached";

// Owner decision 2026-08-02 ("settlement imports failing frequently"
// audit): the Anthropic call now runs through this helper instead of a
// single inline fetch — a client-controlled timeout (ANTHROPIC_TIMEOUT_MS,
// via AbortController) replaces relying on whatever the platform's own
// execution ceiling happens to be, and ONE retry fires for genuinely
// transient failures (a network-level throw, or a 5xx/overloaded response
// from Anthropic) — never for a 4xx, which retrying can't fix. Returns
// either the successful Response, or a terminal {errorType, message} the
// caller turns into a structured error response.
// `timeoutMs`/`maxAttempts` are now CALLER-supplied (owner decision
// 2026-08-02, chunking pass) instead of fixed global constants — the
// three call paths (plain image, small-PDF first attempt, per-chunk
// call) each need a different budget; see the constants block above for
// the full reasoning and worst-case math.
async function callAnthropicMessages(
  anthropicKey: string,
  contentBlock: Record<string, unknown>,
  prompt: string,
  timeoutMs: number,
  maxAttempts: number,
): Promise<{ resp: Response } | { errorType: "timeout" | "anthropic_error"; message: string }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = performance.now();
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
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
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      // MEASURED TIMING (owner decision 2026-08-03, item 6 of the "still
      // failing" bug report): there is no way to make a real Anthropic
      // API call from a dev sandbox to measure actual latency — this logs
      // the REAL elapsed ms for every call so the next genuine device
      // import shows the true per-call budget in `supabase functions logs
      // ai-import`, rather than a guessed number.
      console.log(`[ai-import] anthropic call attempt ${attempt}/${maxAttempts}: ${Math.round(performance.now() - startedAt)}ms, status ${resp.status}`);
      // Retry once on a transient 5xx (including 529 "overloaded") —
      // never on a 4xx (bad request/auth/billing/Anthropic's own rate
      // limit), which a retry cannot fix.
      if (!resp.ok && resp.status >= 500 && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
        continue;
      }
      return { resp };
    } catch (err) {
      clearTimeout(timeoutId);
      const isAbort = err instanceof Error && err.name === "AbortError";
      console.log(`[ai-import] anthropic call attempt ${attempt}/${maxAttempts}: ${Math.round(performance.now() - startedAt)}ms, ${isAbort ? "TIMED OUT" : "threw"}`);
      // BUG FIX (owner decision 2026-08-03): a timeout used to fall
      // through to the same retry branch as a genuine network error,
      // silently DOUBLING the worst-case wait (fire another full-length
      // attempt after already waiting the full timeout once). A timeout
      // now fails fast, no retry — only a real network-level throw gets
      // the transient-failure retry.
      if (isAbort) {
        return {
          errorType: "timeout",
          message: `The AI service took too long to respond (over ${Math.round(timeoutMs / 1000)}s) — try again, or split a multi-page document into fewer pages.`,
        };
      }
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
        continue;
      }
      return { errorType: "anthropic_error", message: `Network error calling Anthropic: ${(err as Error).message}` };
    }
  }
  // Unreachable given maxAttempts >= 1, but keeps TS satisfied.
  return { errorType: "anthropic_error", message: "Unknown error calling Anthropic." };
}

// JSON EXTRACTION, ONE PASS (owner decision 2026-08-02, chunking pass):
// factors the "call Anthropic, then interpret its response" logic
// (previously inline in the Deno.serve handler) into a reusable function
// so it can be called ONCE for a plain image/small-PDF, or MULTIPLE TIMES
// IN PARALLEL — once per page-chunk — without duplicating the
// stop_reason/JSON-parse-fallback logic. Returns either the parsed
// extraction object, or a structured error the caller turns into an HTTP
// response (or, for a single chunk, into "this one chunk failed").
type ExtractOneResult =
  | { extraction: unknown }
  | { errorType: ErrorType; message: string; extra?: Record<string, unknown> };

async function extractOnePass(
  anthropicKey: string,
  contentBlock: Record<string, unknown>,
  prompt: string,
  timeoutMs: number,
  maxAttempts: number,
): Promise<ExtractOneResult> {
  const callResult = await callAnthropicMessages(anthropicKey, contentBlock, prompt, timeoutMs, maxAttempts);
  if ("errorType" in callResult) return callResult;
  const anthropicResp = callResult.resp;

  if (!anthropicResp.ok) {
    const bodyText = await anthropicResp.text().catch(() => "");
    return {
      errorType: "anthropic_error",
      message: `Anthropic API returned HTTP ${anthropicResp.status}.`,
      extra: { detail: bodyText.slice(0, 500) },
    };
  }

  const data = await anthropicResp.json();
  if (data.error) {
    return { errorType: "anthropic_error", message: data.error.message ?? "Unknown Anthropic error." };
  }
  if (data.stop_reason === "refusal") {
    return { errorType: "model_refusal", message: "The model declined to process this document." };
  }
  // Owner decision 2026-08-02 ("settlement imports failing frequently"
  // audit): a response cut off by ANTHROPIC_MAX_TOKENS is a genuinely
  // different, actionable case from a malformed response — every one of
  // the JSON.parse() fallback attempts below would fail on truncated JSON
  // and land in the generic "parse_failed" bucket with no hint that the
  // real cause was hitting the token ceiling, not a garbled response.
  if (data.stop_reason === "max_tokens") {
    return {
      errorType: "truncated",
      message: "This document was too complex for the AI to fully process in one pass (the response was cut off). Try splitting a multi-page settlement into smaller batches, or a clearer/smaller scan.",
    };
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
    return {
      errorType: "parse_failed",
      message: "Could not parse a JSON extraction from the model's response.",
      extra: { raw: raw.slice(0, 2000) },
    };
  }

  return { extraction: parsed };
}

// PDF PAGE COUNT + SPLITTING (owner decision 2026-08-02, chunking pass) —
// the Deno-only half of chunking (chunking.ts holds the pure, Deno-free
// half: page-range arithmetic and JSON merging). base64<->bytes uses the
// Web-standard atob/btoa (both available as Deno globals) — bytesToBase64
// chunks the String.fromCharCode(...) spread in 0x8000-byte batches to
// avoid a call-stack overflow on a large PDF's byte array.
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Returns null (never throws) when the PDF can't be parsed for a page
// count — the caller falls back to the plain, non-chunked path in that
// case, exactly as if this feature didn't exist. Chunking is purely
// additive; it must never become a NEW way for an otherwise-fine import
// to fail.
async function getPdfPageCount(fileBase64: string): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(base64ToBytes(fileBase64), { ignoreEncryption: true });
    return doc.getPageCount();
  } catch {
    return null;
  }
}

async function splitPdfIntoChunks(fileBase64: string, ranges: PageRange[]): Promise<string[]> {
  const srcDoc = await PDFDocument.load(base64ToBytes(fileBase64), { ignoreEncryption: true });
  const chunks: string[] = [];
  for (const range of ranges) {
    const chunkDoc = await PDFDocument.create();
    const indices: number[] = [];
    for (let p = range.start; p <= range.end; p++) indices.push(p - 1); // pdf-lib is 0-indexed
    const copiedPages = await chunkDoc.copyPages(srcDoc, indices);
    copiedPages.forEach((page) => chunkDoc.addPage(page));
    chunks.push(bytesToBase64(await chunkDoc.save()));
  }
  return chunks;
}

// ONE PAGE, WITH ONE NON-FATAL RETRY (owner decision 2026-08-03, round 5
// — MEASURED EVIDENCE fix). A timeout is NOT immediately fatal to this
// page: one extra attempt is made at a shorter PAGE_RETRY_TIMEOUT_MS
// budget before giving up. A non-timeout failure (4xx/parse-failure/
// refusal) is never retried — that's not what a retry can fix — and
// marks the page missing immediately. `remainingBudgetMs` is a live
// callback (not a snapshot) so this always sees the CURRENT invocation
// budget, including whatever the first attempt itself just consumed —
// under CONTROLLED CONCURRENCY (SPEED PASS, owner decision 2026-08-24)
// this is now called for up to BATCH_CONCURRENCY pages at once, so the
// budget it reads may reflect a SIBLING page's own in-flight consumption
// too, not just this page's — that's fine, it's still a real, live
// remaining-budget number either way, just shared across the wave.
// INSTRUMENTATION (SPEED PASS item 5): every attempt logs its own page
// number, payload byte size (SHRINK THE PAYLOAD's one measurable,
// already-real reduction — a single-page PDF excludes every other page's
// fonts/images/objects via pdf-lib's copyPages(), unlike sending the
// whole original file), duration, and outcome status, so a real device
// import's exact timing is visible in `supabase functions logs ai-import`
// without guessing. `cachedPageBase64` (optional): SMART PAGE TRIAGE
// already had to split every page once up front to measure its size for
// ordering — reusing those bytes here (instead of re-splitting the same
// page a second time) is a small, real, free efficiency win for whichever
// pages happen to be processed in the SAME invocation that computed
// triage; a page processed in a LATER invocation (after hand-off) has no
// cached bytes available and is split fresh, same as before.
async function runPageWithRetry(
  anthropicKey: string,
  fileBase64: string,
  totalPages: number,
  page: number,
  basePrompt: string,
  remainingBudgetMs: () => number,
  cachedPageBase64?: string,
): Promise<PageOutcome> {
  const range: PageRange = { start: page, end: page };
  const chunkPrompt = basePrompt + buildChunkPromptAddendum(range, totalPages);

  async function attempt(timeoutMs: number): Promise<ExtractOneResult> {
    const chunkB64 = cachedPageBase64 ?? (await splitPdfIntoChunks(fileBase64, [range]))[0];
    const contentBlock = { type: "document", source: { type: "base64", media_type: "application/pdf", data: chunkB64 } };
    const attemptStartedAt = performance.now();
    const outcome = await extractOnePass(anthropicKey, contentBlock, chunkPrompt, timeoutMs, MAX_ANTHROPIC_ATTEMPTS);
    const durationMs = Math.round(performance.now() - attemptStartedAt);
    const status = "errorType" in outcome ? outcome.errorType : "success";
    console.log(`[ai-import] INSTRUMENT page=${page} bytes=${chunkB64.length} durationMs=${durationMs} status=${status}`);
    return outcome;
  }

  const firstBudget = remainingBudgetMs();
  if (firstBudget < MIN_USEFUL_BUDGET_MS) {
    console.log(`[ai-import] page ${page}: skipping this invocation — only ${Math.round(firstBudget)}ms of budget left`);
    return { page, missing: true };
  }
  const firstTimeout = Math.min(PAGE_TIMEOUT_MS, firstBudget - 5_000);
  console.log(`[ai-import] page ${page}: attempt 1, timeout=${firstTimeout}ms (budget remaining ${Math.round(firstBudget)}ms)`);
  const first = await attempt(firstTimeout);
  if (!("errorType" in first)) {
    console.log(`[ai-import] page ${page}: succeeded on attempt 1`);
    return { page, extraction: first.extraction as ChunkExtraction };
  }
  if (first.errorType !== "timeout") {
    console.log(`[ai-import] page ${page}: failed with "${first.errorType}" (not retryable) — marking missing`);
    return { page, missing: true };
  }

  const retryBudget = remainingBudgetMs();
  if (retryBudget < MIN_USEFUL_BUDGET_MS) {
    console.log(`[ai-import] page ${page}: timed out, no budget left for the retry (${Math.round(retryBudget)}ms) — marking missing`);
    return { page, missing: true };
  }
  const retryTimeout = Math.min(PAGE_RETRY_TIMEOUT_MS, retryBudget - 5_000);
  console.log(`[ai-import] page ${page}: attempt 1 timed out — retrying once, timeout=${retryTimeout}ms`);
  const retry = await attempt(retryTimeout);
  if (!("errorType" in retry)) {
    console.log(`[ai-import] page ${page}: succeeded on retry`);
    return { page, extraction: retry.extraction as ChunkExtraction };
  }
  console.log(`[ai-import] page ${page}: retry also failed ("${retry.errorType}") — marking missing, moving on to the next page`);
  return { page, missing: true };
}

type PageBatchResult = { outcomes: PageOutcome[]; attemptedCount: number };

// CONTROLLED CONCURRENCY, ONE INVOCATION'S WORTH OF PAGES (owner decision
// 2026-08-24, SPEED PASS — see this file's own CONTROLLED CONCURRENCY
// comment near the top for the full "not all at once, not one at a time"
// reasoning). Processes up to `batchSize` pages FROM `pageOrder` (SMART
// PAGE TRIAGE's financially-meaningful-first ordering — NOT necessarily
// raw ascending page numbers), starting at index `startIndex`, with at
// most `concurrency` running at once (chunking.ts's
// `runWithConcurrencyLimit`) — but UNLIKE the old fully-sequential
// design, a page that fails (even after its own retry) still does NOT
// stop the wave: "the loop must always attempt every page" (owner
// decision, unchanged). Bails out BEFORE starting the wave at all
// (attempting nothing) whenever `remainingBudgetMs()` is already too low,
// handing every page in this batch off to a fresh invocation instead —
// the SAME dynamic time-budget hand-off guarantee as before, just checked
// once per WAVE instead of once per PAGE (with PAGES_PER_BATCH=2 and
// BATCH_CONCURRENCY=2 there is normally only ever one wave per
// invocation, so this is not a meaningfully weaker guarantee in practice
// today). Every chunk pdf-lib produces really is cropped to just that one
// page (confirmed by reading splitPdfIntoChunks — this was never sending
// the whole document per call, in any pass).
async function extractPagesForInvocation(
  anthropicKey: string,
  fileBase64: string,
  totalPages: number,
  pageOrder: number[],
  startIndex: number,
  batchSize: number,
  concurrency: number,
  basePrompt: string,
  remainingBudgetMs: () => number,
  pageBytesCache: Map<number, string>,
): Promise<PageBatchResult> {
  const endIndex = Math.min(startIndex + batchSize, pageOrder.length);
  const pagesToAttempt = pageOrder.slice(startIndex, endIndex);
  if (pagesToAttempt.length === 0) return { outcomes: [], attemptedCount: 0 };

  if (remainingBudgetMs() < MIN_USEFUL_BUDGET_MS) {
    console.log(`[ai-import] stopping this invocation before pages [${pagesToAttempt.join(",")}] — insufficient budget remaining, handing off`);
    return { outcomes: [], attemptedCount: 0 };
  }

  const waveStartedAt = performance.now();
  const outcomes = await runWithConcurrencyLimit(pagesToAttempt, concurrency, (page) =>
    runPageWithRetry(anthropicKey, fileBase64, totalPages, page, basePrompt, remainingBudgetMs, pageBytesCache.get(page))
  );
  console.log(
    `[ai-import] INSTRUMENT wave pages=[${pagesToAttempt.join(",")}] concurrency=${concurrency} waveDurationMs=${Math.round(performance.now() - waveStartedAt)} budgetRemainingMs=${Math.round(remainingBudgetMs())}`
  );

  return { outcomes, attemptedCount: pagesToAttempt.length };
}

function errorResponse(type: ErrorType, message: string, status: number, extra?: Record<string, unknown>) {
  return new Response(
    JSON.stringify({ error: { type, message, ...extra } }),
    { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
  );
}

// USAGE LIMITS BY FLEET SIZE + CREDIT PACKS (owner decision 2026-08-24,
// FIVE ADDITIONS pass, PART 5) — mirrors app/src/usage/aiUsage.ts's pure
// TS logic inline (Deno can't import app/src code, same "each Edge
// Function is self-contained" convention as delete-account/reset-data's
// own duplicated deleteStorageFolder()). This is the ONE, authoritative,
// server-side enforcement point — counters are computed by counting real
// `ai_usage_log` rows, never trusted from anything the client sends.
const DEFAULT_IMPORTS_PER_TRUCK_PER_MONTH = 60;

function monthStartUtcIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

// Returns null (allowed) or a user-facing message when both the monthly
// allowance AND every owner-granted credit pack are exhausted. Reads
// `ai_usage_config` (server-adjustable ceiling, admin-only writes),
// `trucks` (active truck count — mirrors this account's own active-truck
// context), `ai_usage_log` (this month's real completed-call count), and
// `ai_credit_purchases` (any remaining owner-granted credits) — all via
// the CALLER's own JWT-scoped client, safe because every one of these
// tables' RLS policy already scopes reads to `user_id = auth.uid()`.
async function checkAiImportUsageAllowed(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<
  | { allowed: true; consumesCredit: boolean }
  | { allowed: false; message: string; used: number; allowance: number }
> {
  const [{ data: config }, { count: activeTruckCount }, { count: usedThisMonth }, { data: creditRows }] = await Promise.all([
    supabase.from("ai_usage_config").select("imports_per_truck_per_month, account_ceiling").maybeSingle(),
    supabase.from("trucks").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("is_active", true),
    supabase
      .from("ai_usage_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("call_type", "ai_import")
      .eq("success", true)
      .gte("created_at", monthStartUtcIso()),
    supabase.from("ai_credit_purchases").select("credits_remaining, expires_at").eq("user_id", userId).gt("credits_remaining", 0),
  ]);

  const perTruck = config?.imports_per_truck_per_month ?? DEFAULT_IMPORTS_PER_TRUCK_PER_MONTH;
  const ceiling = config?.account_ceiling ?? null;
  const rawAllowance = Math.max(1, activeTruckCount ?? 1) * perTruck;
  const allowance = ceiling != null ? Math.min(rawAllowance, ceiling) : rawAllowance;
  const used = usedThisMonth ?? 0;

  if (used < allowance) return { allowed: true, consumesCredit: false };

  const now = new Date();
  const availableCredits = (creditRows ?? [])
    .filter((r) => !r.expires_at || new Date(r.expires_at as string) > now)
    .reduce((sum, r) => sum + Number(r.credits_remaining ?? 0), 0);
  if (availableCredits > 0) return { allowed: true, consumesCredit: true };

  return {
    allowed: false,
    used,
    allowance,
    message: `You've used this month's AI imports (${used} of ${allowance}). You can still add entries manually, and everything else keeps working — your allowance resets on the 1st.`,
  };
}

// Re-checked fresh at the TERMINAL response point (rather than trusting a
// flag threaded from an earlier, separate Edge Function invocation — a
// multi-page document's rounds are independent HTTP requests, so nothing
// computed in round 1 survives in memory to round 3) — decides ONLY which
// accounting bucket (allowance vs. credits) this now-complete call counts
// against; the actual pass/fail gate already ran on the fresh request.
async function consumeOneCreditIfOverAllowance(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<void> {
  const [{ data: config }, { count: activeTruckCount }, { count: usedThisMonth }] = await Promise.all([
    supabase.from("ai_usage_config").select("imports_per_truck_per_month, account_ceiling").maybeSingle(),
    supabase.from("trucks").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("is_active", true),
    supabase
      .from("ai_usage_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("call_type", "ai_import")
      .eq("success", true)
      .gte("created_at", monthStartUtcIso()),
  ]);
  const perTruck = config?.imports_per_truck_per_month ?? DEFAULT_IMPORTS_PER_TRUCK_PER_MONTH;
  const ceiling = config?.account_ceiling ?? null;
  const rawAllowance = Math.max(1, activeTruckCount ?? 1) * perTruck;
  const allowance = ceiling != null ? Math.min(rawAllowance, ceiling) : rawAllowance;
  // This call's own just-logged success row is already counted in
  // usedThisMonth by the time this runs (logAiUsage() is awaited first at
  // every call site) — so "at or past allowance" here correctly means
  // THIS call was the one that used (or is past) the last allowance slot.
  const wasOverAllowance = (usedThisMonth ?? 0) > allowance;
  if (!wasOverAllowance) return;

  const { data: rows } = await supabase
    .from("ai_credit_purchases")
    .select("id, credits_remaining, expires_at")
    .eq("user_id", userId)
    .gt("credits_remaining", 0);
  if (!rows || rows.length === 0) return;
  const now = new Date();
  const usable = rows.filter((r) => !r.expires_at || new Date(r.expires_at as string) > now);
  if (usable.length === 0) return;
  usable.sort((a, b) => {
    if (!a.expires_at && !b.expires_at) return 0;
    if (!a.expires_at) return 1;
    if (!b.expires_at) return -1;
    return new Date(a.expires_at as string).getTime() - new Date(b.expires_at as string).getTime();
  });
  const chosen = usable[0];
  await supabase.from("ai_credit_purchases").update({ credits_remaining: (chosen.credits_remaining as number) - 1 }).eq("id", chosen.id);
}

// COST CONTROL — LOGGING (owner decision 2026-08-24, FIVE ADDITIONS pass,
// PART 4 item 1) — every ai-import call, success or failure, so cost per
// user is queryable (docs/ADMIN_RUNBOOK.md's own recipe). Best-effort: a
// logging failure must never fail the actual import response — it's
// wrapped in try/catch and only ever logged to the function's own console.
async function logAiUsage(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  success: boolean,
  failureReason: string | null,
): Promise<void> {
  try {
    const { error } = await supabase.from("ai_usage_log").insert({
      user_id: userId,
      call_type: "ai_import",
      success,
      failure_reason: failureReason,
    });
    if (error) console.error(`[ai-import] usage log insert failed: ${error.message}`);
  } catch (err) {
    console.error(`[ai-import] usage log insert threw: ${(err as Error).message}`);
  }
}

// ============================================================================
// BACKGROUND IMPORT (owner decision 2026-08-24) — docs/PENDING_SQL.md §54.
// The real fix for "an import feels slow" isn't more speed, it's not
// making the user watch it happen. Mode 'job'/'retry_job' (handled by
// handleJobStart() below, branched to right after auth in Deno.serve)
// creates/reuses one `import_jobs` row and returns {jobId} immediately
// (202 Accepted) — the actual extraction keeps running in the background
// via EdgeRuntime.waitUntil(runJobInBackground(...)), a genuine Supabase
// Edge Runtime capability for continuing work after a response has
// already been sent (this file's own TIMEOUT/PAGE-BUDGET comment block
// above has referenced this capability for a while — this is the first
// pass that actually uses it). This is what makes the job survive
// navigation and app backgrounding: nothing about its progress depends on
// the CLIENT's own JS still running — the client just polls/subscribes to
// `import_jobs` for progress, from any screen, at any time, and can pick
// up wherever the server currently is even after being fully closed and
// reopened later.
// JOB_HARD_BUDGET_MS: a genuine, HONESTLY-FLAGGED best-effort value, not
// an independently-verified platform ceiling — this file's own prior
// TIMEOUT/PAGE-BUDGET comment cites "~400s" for waitUntil background work
// from a documentation lookup that was never actually exercised in this
// codebase before now (the function had never used waitUntil until this
// pass). 240s (4 min) is chosen as a conservative, comfortable margin
// under that unverified figure — realistic settlements (even a dozen
// pages at the slowest previously-MEASURED per-page time, ~40s, with
// BATCH_CONCURRENCY=2 halving the effective wall-clock) should finish
// well inside this budget; a job that's still running when this budget
// is hit is marked 'failed' with a clear "took too long" reason rather
// than left stuck in 'processing' forever. Monitor real device job
// timing (the same INSTRUMENT log lines the synchronous path already
// uses) and adjust this constant if the platform's real ceiling turns
// out to be different.
const JOB_HARD_BUDGET_MS = 240_000;

// The job's own version of "process every page" — reuses every tested
// extraction primitive (triagePageOrder, runWithConcurrencyLimit,
// runPageWithRetry) but loops across the WHOLE document in one go rather
// than handing off between HTTP invocations (extractPagesForInvocation
// above stays exactly as it was, for the synchronous request/response
// callers that still need the 150s-per-invocation hand-off protocol).
// `onPageSettled` fires after EVERY individual page resolves (success or
// permanently-missing-after-retry) — not just once per wave — so
// `import_jobs.pages_done` advances smoothly as pages complete, which is
// what lets a polling client show real, granular progress.
async function runJobPages(
  anthropicKey: string,
  fileBase64: string,
  totalPages: number,
  prompt: string,
  remainingBudgetMs: () => number,
  onPageSettled: (outcome: PageOutcome) => Promise<void>,
): Promise<PageOutcome[]> {
  const triageStartedAt = performance.now();
  const allRanges: PageRange[] = Array.from({ length: totalPages }, (_, i) => ({ start: i + 1, end: i + 1 }));
  const pageChunks = await splitPdfIntoChunks(fileBase64, allRanges);
  const byteSizes: PageByteSize[] = pageChunks.map((b64, i) => ({ page: i + 1, byteSize: b64.length }));
  const pageBytesCache = new Map<number, string>();
  pageChunks.forEach((b64, i) => pageBytesCache.set(i + 1, b64));
  const pageOrder = triagePageOrder(byteSizes);
  const totalBytes = byteSizes.reduce((sum, p) => sum + p.byteSize, 0);
  console.log(
    `[ai-import] INSTRUMENT job triage pages=${byteSizes.length} avgPageBytes=${byteSizes.length > 0 ? Math.round(totalBytes / byteSizes.length) : 0} order=[${pageOrder.join(",")}] triageDurationMs=${Math.round(performance.now() - triageStartedAt)}`
  );

  return runWithConcurrencyLimit(pageOrder, BATCH_CONCURRENCY, async (page) => {
    if (remainingBudgetMs() < MIN_USEFUL_BUDGET_MS) {
      console.log(`[ai-import] job: skipping page ${page} — job budget nearly exhausted`);
      const outcome: PageOutcome = { page, missing: true };
      await onPageSettled(outcome);
      return outcome;
    }
    const outcome = await runPageWithRetry(anthropicKey, fileBase64, totalPages, page, prompt, remainingBudgetMs, pageBytesCache.get(page));
    await onPageSettled(outcome);
    return outcome;
  });
}

// The actual background work — SINGLE CALL IS STILL THE DEFAULT (same
// "try the whole document in one call first" philosophy as the
// synchronous path), falling back to runJobPages() only on a genuine
// "too much content for one call" signal (timeout/truncated). Every state
// transition is written to `import_jobs` as it happens (queued ->
// processing -> ready|failed) — this function's own `supabase` client
// still carries the ORIGINAL caller's JWT (captured before the response
// was sent), so these writes are genuinely on behalf of that user and
// pass RLS exactly like any other authenticated request would.
async function runJobInBackground(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  userId: string,
  anthropicKey: string,
  fileBase64: string,
  mediaType: string,
  prompt: string,
): Promise<void> {
  const jobStartedAt = performance.now();
  function remainingJobBudgetMs(): number {
    return JOB_HARD_BUDGET_MS - (performance.now() - jobStartedAt);
  }

  async function markFailed(message: string, step: string): Promise<void> {
    console.log(`[ai-import] job ${jobId} failed: ${step} — ${message}`);
    await supabase.from("import_jobs").update({
      status: "failed",
      error_message: message,
      error_step: step,
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);
    await logAiUsage(supabase, userId, false, step);
  }

  try {
    await supabase.from("import_jobs").update({ status: "processing", updated_at: new Date().toISOString() }).eq("id", jobId);

    const isImage = mediaType.startsWith("image/");
    const contentBlock = isImage
      ? { type: "image", source: { type: "base64", media_type: mediaType, data: fileBase64 } }
      : { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBase64 } };

    let result: ExtractOneResult = isImage
      ? await extractOnePass(anthropicKey, contentBlock, prompt, IMAGE_TIMEOUT_MS, MAX_ANTHROPIC_ATTEMPTS)
      : await extractOnePass(anthropicKey, contentBlock, prompt, SINGLE_CALL_TIMEOUT_MS, MAX_ANTHROPIC_ATTEMPTS);
    console.log(`[ai-import] job ${jobId} single-call result: ${"errorType" in result ? result.errorType : "success"}`);

    // FALLBACK: only a genuine "too much content for one call" signal
    // enters the per-page path — a clean 4xx/parse-failure/refusal is not
    // something splitting into pages can fix (same rule as the
    // synchronous path above).
    if (!isImage && "errorType" in result && (result.errorType === "timeout" || result.errorType === "truncated")) {
      const rawPageCount = await getPdfPageCount(fileBase64);
      if (rawPageCount !== null && rawPageCount > 1) {
        const clampedTotal = Math.min(rawPageCount, MAX_TOTAL_PAGES);
        console.log(`[ai-import] job ${jobId}: single-call failed (${result.errorType}) — falling back to page-by-page, totalPages=${rawPageCount}`);
        await supabase.from("import_jobs").update({ pages_total: clampedTotal, updated_at: new Date().toISOString() }).eq("id", jobId);

        let doneCount = 0;
        const outcomes = await runJobPages(anthropicKey, fileBase64, clampedTotal, prompt, remainingJobBudgetMs, async () => {
          doneCount++;
          await supabase.from("import_jobs").update({ pages_done: doneCount, updated_at: new Date().toISOString() }).eq("id", jobId);
        });

        const merged = mergeAllPages(outcomes);
        if (merged) {
          result = { extraction: merged.extraction };
          if (merged.missingPages.length > 0) {
            console.log(`[ai-import] job ${jobId}: completed with missing pages ${JSON.stringify(merged.missingPages)}`);
          }
        } else {
          result = {
            errorType: "anthropic_error",
            message: "Could not process this document — the AI service was unavailable or timed out even after a retry.",
          };
        }
      }
      // else: genuinely can't chunk (single-page document, or pdf-lib
      // couldn't determine a page count) — keep the original single-call
      // error as the final result.
    }

    if ("errorType" in result) {
      await markFailed(result.message, result.errorType);
      return;
    }

    await supabase.from("import_jobs").update({
      status: "ready",
      result_json: result.extraction,
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }).eq("id", jobId);
    await logAiUsage(supabase, userId, true, null);
    await consumeOneCreditIfOverAllowance(supabase, userId);
    console.log(`[ai-import] job ${jobId} ready`);
  } catch (err) {
    // A thrown error anywhere in this function (a network blip that
    // wasn't already caught/converted by extractOnePass, a genuinely
    // unexpected bug) must never leave the job silently stuck in
    // 'processing' forever — same "never leave things in an ambiguous
    // state" principle the rest of this codebase already follows.
    await markFailed(err instanceof Error ? err.message : String(err), "unexpected");
  }
}

// JOB START / RETRY (owner decision 2026-08-24) — branched to from
// Deno.serve right after auth, before the synchronous path's own
// fileBase64/mediaType handling (a job request never sends fileBase64 at
// all). Creates (mode 'job') or resets (mode 'retry_job', REUSING the
// same job row and its already-uploaded storage_path — "never make the
// user pick it again") the import_jobs row, runs the SAME daily-limit/
// usage-limit/ANTHROPIC_API_KEY checks the synchronous path runs on a
// fresh request, downloads the file from Storage, and kicks off
// EdgeRuntime.waitUntil(runJobInBackground(...)) before returning
// {jobId} with 202 Accepted. Every failure path here marks the job row
// 'failed' with a real reason too — a job the user can SEE failed
// (with retry available) is far better than an HTTP error that vanishes
// with no trace of what was attempted.
async function handleJobStart(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  body: {
    mode?: "job" | "retry_job";
    storagePath?: string;
    mediaType?: string;
    fileName?: string;
    retryJobId?: string;
    docHint?: string;
    locale?: string;
    customCategories?: string[];
    learningRules?: { keyword: string; category: string }[];
    carrierCodeMaps?: { carrier: string; code: string; subCode: string | null; label: string; description: string | null }[];
  },
): Promise<Response> {
  const isRetry = body.mode === "retry_job";
  let jobId: string;
  let storagePath: string;
  let mediaType: string;

  if (isRetry) {
    if (!body.retryJobId) return errorResponse("bad_request", "retryJobId is required.", 400);
    const { data: existing, error: fetchError } = await supabase
      .from("import_jobs")
      .select("id, storage_path, media_type, user_id")
      .eq("id", body.retryJobId)
      .maybeSingle();
    if (fetchError || !existing || existing.user_id !== userId) {
      return errorResponse("bad_request", "That import job could not be found.", 404);
    }
    jobId = existing.id as string;
    storagePath = existing.storage_path as string;
    mediaType = existing.media_type as string;
    await supabase.from("import_jobs").update({
      status: "queued",
      pages_done: 0,
      pages_total: null,
      result_json: null,
      error_message: null,
      error_step: null,
      updated_at: new Date().toISOString(),
      completed_at: null,
    }).eq("id", jobId);
  } else {
    if (!body.storagePath || !body.mediaType) {
      return errorResponse("bad_request", "storagePath and mediaType are required.", 400);
    }
    storagePath = body.storagePath;
    mediaType = body.mediaType;
    const { data: inserted, error: insertError } = await supabase
      .from("import_jobs")
      .insert({ user_id: userId, storage_path: storagePath, media_type: mediaType, file_name: body.fileName ?? null, status: "queued" })
      .select("id")
      .single();
    if (insertError || !inserted) {
      return errorResponse("anthropic_error", "Could not start the import job.", 500);
    }
    jobId = inserted.id as string;
  }

  async function failJob(message: string, step: string, status: number): Promise<Response> {
    await supabase.from("import_jobs").update({
      status: "failed", error_message: message, error_step: step, updated_at: new Date().toISOString(),
    }).eq("id", jobId);
    return errorResponse(step as ErrorType, message, status);
  }

  // DAILY LIMIT + USAGE LIMIT — the SAME checks a fresh synchronous
  // request runs; a background job is still a real import and must
  // respect the same limits, checked BEFORE any Anthropic call/Storage
  // download.
  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);
  const { count, error: countError } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("imported_at", startOfDayUtc.toISOString());
  if (countError) return failJob("Could not check today's import count.", "anthropic_error", 500);
  if ((count ?? 0) >= DAILY_IMPORT_LIMIT) {
    return failJob(`Daily import limit reached (${DAILY_IMPORT_LIMIT}/day). Try again tomorrow.`, "rate_limited", 429);
  }

  const usageCheck = await checkAiImportUsageAllowed(supabase, userId);
  if (!usageCheck.allowed) {
    await logAiUsage(supabase, userId, false, "usage_limit_reached");
    return failJob(usageCheck.message, "usage_limit_reached", 429);
  }

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return failJob("Server misconfigured: ANTHROPIC_API_KEY not set.", "anthropic_error", 500);

  // PDF/FILE SIZE GUARD — re-checked here (belt and suspenders, same
  // spirit as the synchronous path's own guard) even though the client
  // already checked before uploading; a client bug/bypass must never be
  // the only thing standing between an oversized file and this function.
  const { data: fileData, error: downloadError } = await supabase.storage.from("documents").download(storagePath);
  if (downloadError || !fileData) return failJob("Could not read the uploaded file.", "bad_request", 400);
  const fileBytes = new Uint8Array(await fileData.arrayBuffer());
  const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
  if (fileBytes.byteLength > MAX_FILE_SIZE_BYTES) {
    return failJob("This file is too large — try splitting it or exporting a smaller version.", "bad_request", 413);
  }
  const fileBase64 = bytesToBase64(fileBytes);

  const prompt = buildExtractionPrompt(body.docHint, body.locale, body.customCategories, body.learningRules, body.carrierCodeMaps);

  console.log(`[ai-import] job ${jobId} accepted (${isRetry ? "retry" : "new"}), mediaType=${mediaType}, kicking off background processing`);
  // EdgeRuntime is a Supabase Edge Runtime global (not a standard Deno/TS
  // lib type, hence the loose reference) — this is what lets processing
  // continue after the response below is already sent.
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime.waitUntil(runJobInBackground(supabase, jobId, userId, anthropicKey, fileBase64, mediaType, prompt));

  return new Response(JSON.stringify({ jobId }), { status: 202, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  // DYNAMIC TIME-BUDGET TRACKING (owner decision 2026-08-03, round 5) —
  // computed HERE, inside the handler, not at module scope: Deno keeps
  // this module loaded across many invocations, so a module-level
  // constant would only ever reflect the FIRST invocation's start time.
  // See the PAGE-BUDGET comment block near the top of this file.
  const invocationStartedAt = performance.now();
  function remainingInvocationBudgetMs(): number {
    return HARD_INVOCATION_BUDGET_MS - (performance.now() - invocationStartedAt);
  }

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

  let body: {
    fileBase64?: string;
    mediaType?: string;
    docHint?: string;
    locale?: string;
    customCategories?: string[];
    learningRules?: { keyword: string; category: string }[];
    // CARRIER-SCOPED PAYROLL/SETTLEMENT CODES (owner decision) — the
    // client fetches this small, global reference table itself and
    // forwards it here, same pattern as learningRules above (never fetched
    // server-side, keeping every request self-contained and avoiding an
    // extra round trip inside the tight per-invocation time budget).
    carrierCodeMaps?: { carrier: string; code: string; subCode: string | null; label: string; description: string | null }[];
    // CONTINUATION PROTOCOL (owner decision 2026-08-03, renamed/extended
    // 2026-08-24 SPEED PASS): set by the client on every call AFTER the
    // first one for a long PDF — see the PAGE-BUDGET comment block near
    // the top of this file. `orderIndex` is a position INTO `pageOrder`
    // (SMART PAGE TRIAGE's financially-meaningful-first ordering of page
    // NUMBERS), not a raw page number — absent/0 on the initial call.
    // `pageOrder` is computed once, the first time a document enters the
    // continuation path, and returned to the client so every LATER round
    // echoes it back instead of the server re-triaging the same document
    // twice; absent on the initial call, since it doesn't exist yet.
    orderIndex?: number;
    pageOrder?: number[];
    // Every page gathered from EARLIER invocations, tagged with its own
    // page number (gaps are possible — a missing page doesn't block a
    // LATER page from having succeeded) — this function never persists
    // state between invocations itself, so the client hands it back
    // every time. priorMissingPages is the parallel list of page numbers
    // that failed even after this function's own one retry.
    priorPageExtractions?: { page: number; extraction: unknown }[];
    priorMissingPages?: number[];
    // BACKGROUND IMPORT (owner decision 2026-08-24) — mode 'job' starts a
    // new server-tracked import_jobs row and returns {jobId} immediately
    // (202 Accepted), continuing to process in the background via
    // EdgeRuntime.waitUntil() — see runJobInBackground()/handleJobStart()
    // below. Mode 'retry_job' reuses an existing FAILED job's own already-
    // uploaded storagePath (never asks the client to re-pick/re-upload).
    // Neither mode sends fileBase64 at all — the file is read from Storage
    // server-side via storagePath (a new upload, for 'job') or the job's
    // own stored path (for 'retry_job').
    mode?: "job" | "retry_job";
    storagePath?: string;
    fileName?: string;
    retryJobId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse("bad_request", "Request body must be valid JSON.", 400);
  }

  if (body.mode === "job" || body.mode === "retry_job") {
    return handleJobStart(supabase, userId, body);
  }

  const { fileBase64, mediaType, docHint, locale, customCategories, learningRules, carrierCodeMaps, priorPageExtractions, priorMissingPages } = body;
  const orderIndex = body.orderIndex ?? 0;
  const requestPageOrder = body.pageOrder;
  if (!fileBase64 || !mediaType) {
    return errorResponse("bad_request", "fileBase64 and mediaType are required.", 400);
  }

  // PDF/FILE SIZE GUARD (pre-launch hardening, owner decision 2026-08-02):
  // the same 10 MB limit the client already enforces before ever
  // base64-encoding a file — checked again here so a client bug/bypass is
  // never the only thing standing between a huge request and this
  // function (which would otherwise burn tokens on a doomed Anthropic call
  // or simply time out with no useful error). Base64 inflates the original
  // byte count by ~4/3 (plus up to 2 padding chars); reversing that gives
  // a decoded-size estimate without actually decoding the string.
  const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
  const approxDecodedBytes = Math.floor((fileBase64.length * 3) / 4);
  if (approxDecodedBytes > MAX_FILE_SIZE_BYTES) {
    return errorResponse("bad_request", "This file is too large — try splitting it or exporting a smaller version.", 413);
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

  // USAGE LIMITS BY FLEET SIZE + CREDIT PACKS (owner decision 2026-08-24,
  // FIVE ADDITIONS pass, PART 5) — checked ONLY on a fresh top-level
  // request (never on an in-progress multi-page continuation round, which
  // must always be allowed to finish once started). A soft limit (80%) is
  // a CLIENT-side quiet notice only (app/src/usage/aiUsage.ts) — this
  // server gate is the hard 100% stop.
  const isFreshRequestForUsageGate = orderIndex === 0 && (!priorPageExtractions || priorPageExtractions.length === 0) && (!priorMissingPages || priorMissingPages.length === 0);
  if (isFreshRequestForUsageGate) {
    const usageCheck = await checkAiImportUsageAllowed(supabase, userId);
    if (!usageCheck.allowed) {
      await logAiUsage(supabase, userId, false, "usage_limit_reached");
      return errorResponse("usage_limit_reached", usageCheck.message, 429, { used: usageCheck.used, allowance: usageCheck.allowance });
    }
  }

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    return errorResponse("anthropic_error", "Server misconfigured: ANTHROPIC_API_KEY not set.", 500);
  }

  const isImage = mediaType.startsWith("image/");
  const contentBlock = isImage
    ? { type: "image", source: { type: "base64", media_type: mediaType, data: fileBase64 } }
    : { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBase64 } };

  const prompt = buildExtractionPrompt(docHint, locale, customCategories, learningRules, carrierCodeMaps);

  // SINGLE CALL IS THE DEFAULT (owner decision 2026-08-03 — see the
  // budget comment block near the top of this file). `isFirstCall`
  // distinguishes a fresh request (try the whole document in one call)
  // from a client that's already mid-fallback-continuation from an
  // EARLIER response on this same document (go straight to the next
  // batch, never re-attempt the single-call path partway through).
  const isFirstCall = orderIndex === 0 && (!priorPageExtractions || priorPageExtractions.length === 0) && (!priorMissingPages || priorMissingPages.length === 0);
  console.log(
    `[ai-import] request: mediaType=${mediaType} isImage=${isImage} isFirstCall=${isFirstCall} orderIndex=${orderIndex} priorCovered=${priorPageExtractions?.length ?? 0} priorMissing=${priorMissingPages?.length ?? 0}`
  );

  let pagesProcessed: { total: number; missingPages: number[] } | null = null;
  // null = no continuation (this response is terminal). Deliberately
  // compared with `!== null` everywhere below, NEVER truthiness — 0 is a
  // legitimate "continue, but zero pages were attempted this invocation"
  // value (e.g. an invocation that hit its budget ceiling before starting
  // even one page), which `!nextOrderIndex` would have wrongly treated as
  // "terminal" (the old page-number-based `nextPageStart` never had this
  // hazard, since real page numbers start at 1 and are always truthy).
  let nextOrderIndex: number | null = null;
  let responsePageOrder: number[] | null = null;
  let rawPageExtractions: { page: number; extraction: unknown }[] | null = null;
  let rawMissingPages: number[] | null = null;
  // PROGRESSIVE UI (owner decision 2026-08-24, SPEED PASS item 4): the
  // merged-so-far extraction on every ONGOING (non-terminal) response, so
  // the client can show a running settlement header/totals preview while
  // later pages are still processing — the terminal response's own `data`
  // field already IS the final merged extraction, so this is only ever
  // set alongside `nextOrderIndex`.
  let partialData: ChunkExtraction | null = null;
  let result: ExtractOneResult;

  // FALLBACK, NOT DEFAULT (owner decision 2026-08-03): the client-driven
  // continuation protocol — this invocation attempts up to
  // PAGES_PER_BATCH pages from `pageOrder` (SMART PAGE TRIAGE order,
  // CONTROLLED CONCURRENCY within the batch — see this file's own
  // comments near the top); a page's own failure — even after its one
  // retry — never stops a LATER page from still being attempted,
  // chunking.ts's gap-tolerant `mergeAllPages`. Every decision is logged
  // so a real device test's function logs show exactly which page
  // succeeded/failed/retried and why. Assigns to the outer `result`/
  // `pagesProcessed`/`nextOrderIndex`/`rawPageExtractions`/
  // `rawMissingPages`/`partialData` directly rather than returning a
  // value, since all six are needed by the shared response-building code
  // below regardless of which path produced them.
  async function runContinuation(rawPageCount: number): Promise<void> {
    // MAX_TOTAL_PAGES is a defensive-only ceiling (see its own comment
    // above) — the user-facing `total` in the response always reports
    // the REAL page count, even on the rare document long enough to hit it.
    const clampedTotal = Math.min(rawPageCount, MAX_TOTAL_PAGES);
    console.log(`[ai-import] continuation: orderIndex=${orderIndex} rawPageCount=${rawPageCount} clampedTotal=${clampedTotal}`);

    // SMART PAGE TRIAGE (owner decision 2026-08-24, SPEED PASS item 2) —
    // computed ONCE per document: if the client already has a pageOrder
    // (echoed back from an earlier response), reuse it verbatim rather
    // than re-triaging; otherwise this is the FIRST invocation to enter
    // the continuation path for this document, so split every page once
    // (to measure its own byte size — SHRINK THE PAYLOAD item 3's
    // measurement), triage, and cache the split bytes for whichever pages
    // THIS SAME invocation is about to process (avoids re-splitting them
    // a second time inside runPageWithRetry).
    const pageBytesCache = new Map<number, string>();
    let pageOrder = requestPageOrder;
    if (!pageOrder || pageOrder.length === 0) {
      const triageStartedAt = performance.now();
      const allRanges: PageRange[] = Array.from({ length: clampedTotal }, (_, i) => ({ start: i + 1, end: i + 1 }));
      const pageChunks = await splitPdfIntoChunks(fileBase64, allRanges);
      const byteSizes: PageByteSize[] = pageChunks.map((b64, i) => ({ page: i + 1, byteSize: b64.length }));
      pageChunks.forEach((b64, i) => pageBytesCache.set(i + 1, b64));
      pageOrder = triagePageOrder(byteSizes);
      const totalBytes = byteSizes.reduce((sum, p) => sum + p.byteSize, 0);
      const avgBytes = byteSizes.length > 0 ? Math.round(totalBytes / byteSizes.length) : 0;
      console.log(
        `[ai-import] INSTRUMENT triage pages=${byteSizes.length} avgPageBytes=${avgBytes} order=[${pageOrder.join(",")}] triageDurationMs=${Math.round(performance.now() - triageStartedAt)}`
      );
    }

    const batch = await extractPagesForInvocation(
      anthropicKey, fileBase64, clampedTotal, pageOrder, orderIndex, PAGES_PER_BATCH, BATCH_CONCURRENCY, prompt, remainingInvocationBudgetMs, pageBytesCache
    );
    console.log(
      `[ai-import] this invocation attempted ${batch.attemptedCount} page(s), budgetRemaining=${Math.round(remainingInvocationBudgetMs())}ms`
    );

    const priorOutcomes: PageOutcome[] = [
      ...(priorPageExtractions ?? []).map((p): PageOutcome => ({ page: p.page, extraction: p.extraction as ChunkExtraction })),
      ...(priorMissingPages ?? []).map((page): PageOutcome => ({ page, missing: true })),
    ];
    const allOutcomes = [...priorOutcomes, ...batch.outcomes];

    const merged = mergeAllPages(allOutcomes);
    if (!merged) {
      result = { errorType: "anthropic_error", message: `Could not process this document — the AI service was unavailable or timed out even after a retry.` };
      console.log(`[ai-import] continuation: nothing succeeded at all — total failure`);
      return;
    }
    result = { extraction: merged.extraction };

    const attemptedSoFar = orderIndex + batch.attemptedCount;
    if (attemptedSoFar >= pageOrder.length) {
      // Every page in the triage order has now been attempted,
      // successfully or not — this is a terminal result.
      if (merged.missingPages.length > 0 || clampedTotal < rawPageCount) {
        pagesProcessed = { total: rawPageCount, missingPages: merged.missingPages };
      }
      console.log(`[ai-import] continuation complete: covered=${merged.coveredPages.length}/${rawPageCount}, missing=${JSON.stringify(merged.missingPages)}`);
    } else {
      // More pages remain — tell the client to keep going, carrying
      // forward every page gathered so far (covered AND missing), the
      // SAME pageOrder (so the next invocation never re-triages), and a
      // partial preview of what's been merged so far.
      nextOrderIndex = attemptedSoFar;
      responsePageOrder = pageOrder;
      rawPageExtractions = allOutcomes.filter((o): o is { page: number; extraction: ChunkExtraction } => 'extraction' in o).map((o) => ({ page: o.page, extraction: o.extraction }));
      rawMissingPages = merged.missingPages;
      partialData = merged.extraction;
      console.log(`[ai-import] continuation ongoing: nextOrderIndex=${nextOrderIndex}/${pageOrder.length}, covered so far=${merged.coveredPages.length}, missing so far=${merged.missingPages.length}`);
    }
  }

  if (isImage) {
    result = await extractOnePass(anthropicKey, contentBlock, prompt, IMAGE_TIMEOUT_MS, MAX_ANTHROPIC_ATTEMPTS);
  } else if (!isFirstCall) {
    // Already mid-continuation from an earlier response on this same
    // document — go straight to the next batch of pages.
    const rawPageCount = await getPdfPageCount(fileBase64);
    if (rawPageCount === null) {
      // Shouldn't happen in practice (pdf-lib already parsed this same
      // file once, to have gotten here) but fail clearly rather than throw.
      result = { errorType: "anthropic_error", message: "Could not continue processing this document." };
    } else {
      await runContinuation(rawPageCount);
    }
  } else {
    // DEFAULT PATH: ONE call over the WHOLE document, exactly like this
    // function's original, previously-working implementation before any
    // chunking pass — no pdf-lib cropping, no page-count check needed
    // up front at all.
    result = await extractOnePass(anthropicKey, contentBlock, prompt, SINGLE_CALL_TIMEOUT_MS, MAX_ANTHROPIC_ATTEMPTS);
    console.log(`[ai-import] single-call result: ${"errorType" in result ? result.errorType : "success"}`);

    // FALLBACK: only a genuine "too much content for one call" signal
    // (timeout or a token-ceiling truncation) enters the continuation
    // path — a clean 4xx/parse-failure/refusal is not something
    // splitting into pages can fix.
    if (!isImage && "errorType" in result && (result.errorType === "timeout" || result.errorType === "truncated")) {
      const rawPageCount = await getPdfPageCount(fileBase64);
      if (rawPageCount !== null && rawPageCount > 1) {
        console.log(`[ai-import] single-call failed (${result.errorType}) — falling back to page-by-page processing, totalPages=${rawPageCount}`);
        await runContinuation(rawPageCount);
      }
      // else: genuinely can't chunk (single-page document, or pdf-lib
      // couldn't determine a page count) — keep the original single-call
      // error as the final result.
    }
  }

  if ("errorType" in result) {
    // COST CONTROL — LOGGING (owner decision 2026-08-24, FIVE ADDITIONS
    // pass, PART 4 item 1): logged, but never counted against the monthly
    // allowance (shouldCountAiImportUsage()'s own mirrored rule in
    // app/src/usage/aiUsage.ts — a failed call never counts).
    await logAiUsage(supabase, userId, false, result.errorType);
    const status = result.errorType === "timeout" ? 504 : result.errorType === "anthropic_error" ? 502 : 422;
    return errorResponse(result.errorType, result.message, status, result.extra);
  }

  // USAGE LIMITS + LOGGING (owner decision 2026-08-24, FIVE ADDITIONS
  // pass, PARTS 4+5) — only a genuinely TERMINAL response (nextOrderIndex
  // still null — the multi-page continuation protocol, if any, is fully
  // done) counts against the monthly allowance/credits, mirroring
  // app/src/usage/aiUsage.ts's shouldCountAiImportUsage(hasNextPageStart,
  // hadError) exactly: a multi-page settlement is billed exactly once, on
  // its own final round; an in-progress continuation round is logged as a
  // success but never counted twice for the same document. `!== null`,
  // never truthiness — see nextOrderIndex's own declaration comment above
  // for why (0 is a legitimate "keep going" value).
  const isTerminal = nextOrderIndex === null;
  if (isTerminal) {
    await logAiUsage(supabase, userId, true, null);
    await consumeOneCreditIfOverAllowance(supabase, userId);
  }

  return new Response(
    JSON.stringify({
      data: result.extraction,
      ...(pagesProcessed ? { pagesProcessed } : {}),
      ...(nextOrderIndex !== null
        ? {
            nextOrderIndex,
            pageOrder: responsePageOrder,
            rawPageExtractions,
            rawMissingPages: rawMissingPages ?? [],
            partialData,
            progress: { through: nextOrderIndex, total: responsePageOrder?.length ?? nextOrderIndex },
          }
        : {}),
    }),
    { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
  );
});
