// supabase/functions/ai-import/index.ts
//
// Deno Edge Function — receipts/statements/settlements → structured JSON via
// the Anthropic API. ANTHROPIC_API_KEY lives only in this function's
// environment secrets; the mobile app never holds it (CLAUDE.md).
//
// POST body: { fileBase64: string, mediaType: string, docHint?: string, locale?: string, customCategories?: string[], learningRules?: { keyword: string, category: string }[], carrierCodeMaps?: { carrier: string, code: string, subCode: string | null, label: string, description: string | null }[] } (the direct path: one call, a photo).
// Every PDF import is a settlement-reader job: mode read_start with a
// storagePath (reader/server.ts). The old reader modes return 410.
// learningRules (owner decision 2026-08-05, FULL PARITY follow-up item
// G, app/src/import/categoryLearning.ts) — the user's own learned
// keyword->category corrections, appended to the prompt as plain-text
// "USER CORRECTIONS" hints. PROMPT-CONTEXT ONLY: never used to fine-tune
// or retrain the model — the same one-shot-per-request behavior as every
// other prompt input here.
// Auth: Supabase JWT in the Authorization header (required).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import {
  normalizeStatementColumns,
} from "./statementColumns.ts";
import { scrubBankDigits, scrubBankDigitsInText } from "./bankDigits.ts";
import { extractionOutputSchema, FAILED_REPLY_MAX_CHARS, isSchemaRejection, type JsonSchema } from "./outputSchema.ts";
import { pdfCreationDateOf } from "./pdfInfo.ts";
import {
  PLAN_SECRET_NAME,
  STALE_LEASE_AFTER_MS,
  checkImportLimits,
  leaseIsStale,
  limitsForPlan,
  planTierFrom,
  type UsageCallType,
} from "./jobEngine.ts";

import {
  assembleDiagnoseReport,
  columnErrorMeansMissing,
  DIAGNOSE_MODELS,
  DIAGNOSE_PROBE_ARG,
  missingFromPgProc,
  PG_PROC_RPC,
  planInfo,
  REQUIRED_COLUMNS,
  REQUIRED_RPCS,
  rpcProbePresent,
  runModelCheck,
  stampedBuildId,
  summarizeJobs,
  type FetchLike,
  type FunctionsCheckedBy,
  type JobRowForDiagnose,
} from "./diagnose.ts";
import { AI_IMPORT_DEPLOYED_AT, AI_IMPORT_GIT_HASH } from "./buildStamp.ts";
import { isReaderRow, runReaderJob, type ModelReply, type PromptInputs as ReaderPromptInputs, type ReaderKit, type ReaderRowProgress } from "./reader/server.ts";
import * as readerCore from "./reader/core.gen.js";

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

// DIRECT PATH BUDGET: a photo (or a PDF sent without a job) is read in ONE
// model call that must end inside the 150 s Free-plan worker. Every PDF
// import goes through the settlement reader's background job instead
// (read_start). The old page-by-page continuation was removed with the old
// reader (owner decision 2026-11-13, commit 6).
const IMAGE_TIMEOUT_MS = 90_000;
const SINGLE_CALL_TIMEOUT_MS = 100_000;

// Retry ONLY for a genuine TRANSIENT failure (a real network-level throw,
// or a 5xx/529-overloaded response from Anthropic) — never for a 4xx
// (bad request/auth/billing, which retrying can't fix) and, as of this
// pass, never for a timeout/AbortError either (see callAnthropicMessages
// below — that used to retry too, silently doubling the wait).
// R4 (owner decision 2026-11-03): 3 attempts, backoff doubling from 800 ms
// (800, 1600) — still only for a transient failure, never a timeout.
const MAX_ANTHROPIC_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 800;
const backoffMs = (attempt: number) => RETRY_BACKOFF_MS * 2 ** (attempt - 1);

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
  `Parse this document for Graywolf Logistics LLC (Ali Bozkurt, Prime Inc. owner-operator, Unit 830157). Return ONLY raw JSON starting with { ending with }. No markdown.\n\ndocType: settlement|fuel|maintenance|amazon|store|toll|loan|other\n\nFor settlement: {"docType":"settlement","date":"YYYY-MM-DD","vendor":"","totalAmount":0,"taxDeductible":true,"bizPct":100,"summary":"","settlement":{"weekEnding":"","carrier":"","unit":"","grossRevenue":0,"reimbursements":0,"totalDeductions":0,"netPay":0,"totalMiles":0,"loadedMiles":0,"revenueItems":[{"desc":"","order":"","amount":0}],"reimbursementItems":[{"desc":"","ref":"","amount":0}],"loads":[{"order":"","from":"","to":"","loadedMiles":0,"emptyMiles":0,"revenue":0,"rate":0,"shipper":""}],"tractorFuel":[{"date":"","location":"","gallons":0,"amount":0,"discount":0}],"reeferFuel":[{"date":"","location":"","gallons":0,"amount":0,"discount":0}],"deductions":[{"code":"","desc":"","balance":0,"amount":0,"category":"Software & Subscriptions|Legal & Accounting Fees|Insurance|Licensing & Permits|Fixed|Variable|Other"}],"maintenance":[{"invoice":"","unit":"","desc":"","odometer":0,"serviceType":"oil|fuel|valve|dpf|def|coolext|coolant|trans|tires|brakes|general|other","parts":0,"labor":0,"total":0,"covered":0}],"tolls":{"ezpass":{"total":0,"items":[]},"drivewyze":{"total":0,"items":[]}},"loans":[{"name":"","balance":0,"payment":0,"frequency":"","nextDue":""}],"assets":{"tractor":{"unit":"","year":"","make":"","model":"","vin":"","license":"","odometer":0},"apu":{"unit":"","make":"","model":"","vin":"","hours":0,"rental":0}},"operating":{"weekRevenue":0,"weekMiles":0,"weekExpenses":0,"weekNet":0,"ytdRevenue":0,"ytdMiles":0,"ytdExpenses":0,"ytdNet":0,"ltdRevenue":0,"ltdMiles":0,"weeksInService":0}}}\n\nFor fuel: {"docType":"fuel","date":"","vendor":"","totalAmount":0,"taxDeductible":true,"summary":"","fuel":{"type":"tractor","station":"","location":"","gallons":0,"pricePerGallon":0,"gross":0,"discount":0,"net":0}}\n\nFor maintenance: {"docType":"maintenance","date":"","vendor":"","totalAmount":0,"taxDeductible":true,"summary":"","maintenance":{"invoice":"","shop":"","unit":"","description":"","odometer":0,"serviceType":"oil|fuel|valve|dpf|def|coolext|coolant|trans|tires|brakes|general|other","parts":0,"labor":0,"total":0,"warrantyCredit":0,"netCost":0}}\n\n
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
  `"settlement":{"weekEnding":"","printDate":"","settlementDateRaw":"","printDateRaw":"","statementWeekEndingRaw":"","carrier":"","unit":"","driverName":"","grossRevenue":0,`;

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

// ---- Approved addition (golden settlement pass, owner decision
// 2026-10-13): the settlement schema's "operating" object now names the
// REAL Prime operating-statement lines (WEEKS TOTAL column + the YTD
// totals the app checks), read from a real 8-page Prime settlement — the
// old object assumed a weekly "expenses" figure Prime never prints. Kept
// in sync by hand with app/src/import/types.ts's ExtractedSettlement.
// operating and app/src/import/primeOperatingStatement.ts. ----
const OPERATING_SCHEMA_BEFORE =
  `"operating":{"weekRevenue":0,"weekMiles":0,"weekExpenses":0,"weekNet":0,"ytdRevenue":0,"ytdMiles":0,"ytdExpenses":0,"ytdNet":0,"ltdRevenue":0,"ltdMiles":0,"weeksInService":0}`;
const OPERATING_SCHEMA_AFTER =
  `"operating":{"lines":[{"section":"","label":"","weeks":"","ytd":"","ltd":""}],"totalLines":[{"label":"","weeks":"","ytd":"","ltd":""}],"recapLines":[{"label":"","weeks":"","ytd":"","ltd":""}],"payoutMethod":"","weekEnding":"","weekEndingRaw":"","weeksInService":0,"escrowPriorBalance":0,"escrowThisWeek":0,"escrowBalance":0,"escrowInterestRatePct":0}`;

// ---- Approved addition (owner decision 2026-10-13): reimbursement lines
// carry their own printed code (Prime "PR" = personal-payment
// reimbursement, the offset limit for PERSONAL PYMNT RCV), and every
// settlement may carry the printed deposit AMOUNT (never bank digits). ----
const REIMBURSEMENT_ITEMS_BEFORE = `"reimbursementItems":[{"desc":"","ref":"","amount":0}]`;
const REIMBURSEMENT_ITEMS_AFTER = `"reimbursementItems":[{"code":"","desc":"","ref":"","amount":0}]`;
const DEPOSIT_SCHEMA_BEFORE = `"netPay":0,`;
const DEPOSIT_SCHEMA_AFTER = `"netPay":0,"depositAmount":0,"payoutMethod":"","totalLabels":{"grossRevenue":"","reimbursements":"","totalDeductions":"","netPay":"","depositAmount":""},"settlementTotalLines":[{"label":"","amount":0}],"milesLines":[{"label":"","miles":0}],`;

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

APPROVED ADDITION (settlement loan-recap field clarity, owner decision, device report: a settlement's own loans[] section produced a "balance"/"payment" that didn't make sense together — e.g. a monthly payment nearly equal to the whole balance): when a settlement statement's own recap/summary section shows a truck/trailer/equipment loan or escrow account, loans[].balance is the loan's REMAINING/OUTSTANDING balance as of this statement (a large figure, typically tens of thousands of dollars for a truck loan) and loans[].payment is ONLY the RECURRING PERIODIC payment amount for ONE pay period (frequency below) — a small figure, typically a few hundred to a couple thousand dollars for a weekly/biweekly/monthly truck payment. NEVER put the balance, the original loan amount, or a year-to-date/cumulative total into payment — if the statement shows only ONE loan-related dollar figure and you cannot tell whether it is the balance or a single period's payment, prefer leaving payment 0 rather than guessing, since a wrong balance is far less misleading than a payment that looks like it pays off the whole loan at once.

APPROVED ADDITION (weekly miles only, owner decision 2026-08-02, CRITICAL BUG FIX — verified against a real statement that printed 0 loaded miles this week alongside a large "LTD MILES"/lifetime figure): settlement.totalMiles MUST be THIS SETTLEMENT WEEK's own miles only — the figure shown next to this week's revenue/loads section, NOT any lifetime-to-date, quarter-to-date, or year-to-date odometer/mileage total the statement also prints elsewhere (commonly labeled "LTD MILES", "MILES QTD", "YTD MILES", "Odometer", or similar cumulative labels). These cumulative figures are always much larger than one week's driving and must NEVER be substituted for totalMiles. If the document shows loads for the week, totalMiles should be consistent with (ideally the sum of) those loads' own loaded_miles + empty_miles — if the week's loads list is empty (a "home week," no freight moved), totalMiles is 0, never a nonzero lifetime figure. When genuinely unsure which printed number is this week's own total, prefer summing the individual loads' mileage over any single "TOTAL MILES" label that could be ambiguous.

APPROVED ADDITION (escrow & deposits, owner decision 2026-08-02, PRODUCT DECISION — verified against a real statement with a "PERFORMNCE BOND" OCR-damaged line): a settlement deduction line that is a REFUNDABLE DEPOSIT the carrier holds on the driver's behalf — a performance bond, escrow reserve, tire fund, emergency fund, or maintenance reserve (including OCR-damaged/misspelled variants of these words, e.g. "PERFORMNCE BOND", "ESCROW RESRV", "TIRE FND") — is NOT a business expense; it is money temporarily held by the carrier that is typically returned later. Set its chargebackType to "escrow_reserve" (already in the chargebackType enum below) so the app books it as a non-deductible "Escrow & Deposits" category rather than a real cost. Do not confuse this with a one-time cash_advance (money given to the driver, deducted back the same or a later week) or advance_repayment (repaying a PRIOR advance/purchase credit, e.g. an extended warranty) — an escrow/bond/reserve/fund deduction is a DEPOSIT the carrier is holding, conceptually different from either of those.

APPROVED ADDITION (settlement-line classifier + new categories, owner decision 2026-08-05, FULL PARITY pass — a real device statement's unmapped chargeback codes were landing in "Misc" with zero accountant-usable detail): the category enum above now includes six new categories — classify a settlement deduction/purchase item into these when it fits, using GENERIC, carrier-neutral wording/concepts only (any carrier may abbreviate differently — match by MEANING, not exact spelling): "Fuel Additives" (anti-gel, diesel treatment, cetane booster, injector cleaner — Howes/Power Service/Hot Shot's/Lucas/Archoil/Stanadyne/Diesel 911 — never bare pump fuel, which stays "Fuel & DEF"), "Truck Parts" (a CONSUMED part the owner installs himself — alternator, starter, battery, belts, hoses, filters, mirrors, lights, sensors, wheel seals, brake shoes, mud flaps, wiper blades — distinct from "Tools & Equipment", a reusable TOOL kept after the job: wrench, impact gun, jack, tool box, blower, grease gun), "Major Repairs & Overhauls" (a single invoice OVER $2,500 rebuilding a major component — engine in-frame, transmission, differential, cab, repaint — note in your summary that this may be a capital improvement the user's CPA should review), "Truck Wash & Detailing", "Warranty & Service Contracts" (an extended warranty/service-contract PURCHASE), and "Lumper Fees" (a lumper/unloading fee — including an ADVANCE-shaped settlement line that names an outside lumper, which stays deductible Lumper Fees even though it contains the word "ADV": this is different from a plain "ADVANCE"/"ADV" line with no lumper wording, which is chargebackType "advance_repayment" / category "Advance Repayment", non-deductible loan-principal repayment). CARRIER ISOLATION: a settlement chargeback CODE is one specific carrier's own internal abbreviation (e.g. one carrier's own "EXTEND WR PURCH" or "EZ FAST LN") and means nothing outside that carrier's own statements — never apply a code meaning you've seen from one carrier's document to any other carrier's document. If this document's carrier is confirmed against one of the named carrier code blocks appended below, use ONLY that carrier's own code meanings for its codes; otherwise (an unrecognized or unconfirmed carrier) classify every line using the generic, carrier-neutral concepts above and your own general knowledge, never a specific code you recall from a different carrier. A SHOP INVOICE that includes LABOR (not just parts) -> "Maintenance & Repairs". Split a receipt that mixes consumed PARTS and reusable TOOLS into separate line items with their own correct category each — never lump them into one line under a single guessed category.

APPROVED ADDITION (loans[] is a RECAP field, never synthesized from a deduction line, owner decision, device report: an extended-warranty loan was being re-created on every settlement import): settlement.loans[] must ONLY be populated when the settlement document itself shows a DEDICATED loan/financing/escrow RECAP section — a separate summary block (often near the bottom, sometimes labeled "Loan Summary", "Escrow Account", "Deductions Summary — Recurring", or similar) that states a standing obligation's own remaining balance, distinct from the week's line-item deductions list. Do NOT create a settlement.loans[] entry merely because a deductions[] line looks like it might be repaying something (an "ADVANCE — EXT WARRANTY" or similar weekly repayment line already belongs ONLY in deductions[] with category "Advance Repayment" / chargebackType "advance_repayment" as documented above — it must never ALSO be synthesized into loans[], since that repayment line is not itself a loan recap, it's one week's payment against an obligation whose balance you cannot determine from that single line alone). If the document has no genuine loan-recap section, leave settlement.loans[] empty — an empty array is correct and expected for most settlements, not a failure to extract something. When a genuine recap section IS present and repeats week to week for the same obligation, keep loans[].name STABLE and free of anything that changes week to week (no invoice numbers, reference IDs, dates, or check numbers in the name) — use just the obligation's own stable identity as printed (e.g. "Extended Warranty" or the lender's name), since the app matches this loan to the SAME Loan Center row across every settlement by this name and a wording change breaks that match.
APPROVED ADDITION (document titles, owner decision 2026-09-23): every response MUST include a top-level "title" field — a short, specific, human-readable name for THIS document (at most 60 characters) built from what you actually extracted: its kind, then the vendor/station/shop/carrier or subject, then its date as month/day when there is one. Examples of the style: "Fuel receipt — Pilot, 7/14", "Maintenance invoice — Oil change, 6/2", "Prime settlement — W/E 7/17", "IRS Form 2290", "Insurance card — Mayfair". Never a generic word like "Document", "Receipt" or "Scan" on its own; never invent a vendor or date you did not read on the document — leave that part out instead. Plain text only, no quotes or emoji.
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

// GLOSSARY APPLIES TO AI OUTPUT TOO (owner decision, LANGUAGE PICKER —
// FIVE LANGUAGES AT LAUNCH pass) — docs/I18N_GLOSSARY.md's DO-NOT-
// TRANSLATE list, spelled out explicitly rather than the previous
// 3-example shorthand ("per diem", "ELD", "IFTA"). Kept in sync with that
// doc, app/src/i18n/__tests__/glossary.test.ts's GLOSSARY_TERMS array,
// AND supabase/functions/ai-advisor/index.ts's identical constant by
// hand — this Deno function can't import a TS module from app/src or
// from its sibling function, same standing constraint as
// LOCALE_LANGUAGE_NAME above.
const GLOSSARY_TERMS_FOR_PROMPT =
  'per diem, coolant, DPF, DEF, ELD, IFTA, IRP, HVUT/2290, settlement(s), ' +
  'linehaul, fuel surcharge, detention, layover, lumper, bobtail, deadhead, ' +
  'reefer, APU, CDL, DOT, MC number, escrow, factoring, Schedule C, 1099, ' +
  "W-2, K-1, S-Corp, LLC, MACRS, Section 179, owner's draw, CPM, RPM";

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
    .replace(SETTLEMENT_DEDUCTIONS_BEFORE, SETTLEMENT_DEDUCTIONS_AFTER)
    .replace(OPERATING_SCHEMA_BEFORE, OPERATING_SCHEMA_AFTER)
    .replace(REIMBURSEMENT_ITEMS_BEFORE, REIMBURSEMENT_ITEMS_AFTER)
    .replace(DEPOSIT_SCHEMA_BEFORE, DEPOSIT_SCHEMA_AFTER);
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
  prompt += `\nAPPROVED ADDITION (date hardening round 3, owner decision 2026-07-30, amended 2026-11-03): a settlement's dates are never inferred, defaulted or approximated from today's date (${todayIso}) or from any unrelated date on the document. When a date is not printed, leave its field "".\n`;
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
  prompt += `\nAPPROVED ADDITION (dates as printed text, owner decision 2026-11-03, supersedes date hardening round 4): never interpret, convert or reorder a settlement date. Leave settlement.weekEnding, settlement.printDate and settlement.operating.weekEnding as "" — the app parses the printed texts in settlement.settlementDateRaw, settlement.printDateRaw, settlement.statementWeekEndingRaw and settlement.operating.weekEndingRaw itself. When the STATEMENT OF INCOME AND EXPENSE page is on these pages, copy its header WEEK ENDING into BOTH settlement.statementWeekEndingRaw and settlement.operating.weekEndingRaw.\n`;
  // PRINTED DATES (owner decision 2026-10-29, DATES definitive): the app
  // parses every settlement date itself (app/src/import/printedDates.ts);
  // the model copies the text exactly as printed.
  prompt += `\nAPPROVED ADDITION (printed dates, owner decision 2026-10-29, DEFINITIVE): copy each of these dates EXACTLY AS PRINTED, as text, character for character, without converting, reordering or completing it: settlement.settlementDateRaw = the SETTLEMENT DATE / SETTLEMENTS DATE / week-ending date on the settlement page (e.g. "26/08/14"); settlement.printDateRaw = the header print DATE (e.g. "8/13/26"); settlement.statementWeekEndingRaw = the week ending printed in the header of the STATEMENT OF INCOME AND EXPENSE page, when that page is in this document (e.g. "26/08/14"). Leave a field "" when that date is not printed on these pages. The app reads these texts itself; never put an interpreted date in them.\n`;
  if (docHint) {
    prompt += `\nThe user has hinted this document is likely a "${docHint}" — verify against the actual content, but use this as a tiebreaker only if the content is genuinely ambiguous.\n`;
  }
  const languageName = locale ? LOCALE_LANGUAGE_NAME[locale] : undefined;
  if (languageName) {
    prompt += `\nAPPROVED ADDITION (AI in user's language, owner decision 2026-07-10; glossary explicit list added in the LANGUAGE PICKER — FIVE LANGUAGES AT LAUNCH pass): write every free-text field (summary, and any description you compose yourself) in ${languageName} — the user's chosen app language, never the document's own language. Keep these trucking/tax industry terms in ENGLISH exactly as written, embedded in your ${languageName} sentence — never translate or transliterate them: ${GLOSSARY_TERMS_FOR_PROMPT}. This does NOT apply to enum-like fields (docType, category, chargebackType, incomeType, serviceType, paymentMethod) or to text you copy verbatim from the document itself (vendor names, item names, addresses) — only to text you are generating/summarizing in your own words.\n`;
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
  // PRIME OPERATING STATEMENT (owner decision, USE PRIME'S "STATEMENT OF
  // INCOME AND EXPENSE" AS THE VERIFICATION SOURCE OF TRUTH pass). Prime
  // Inc's own settlements typically include a Perryman & Associates
  // operating-statement page (see docs/CARRIER_CODES.md's "AS/ACCOUNTING
  // SERVICE" row — that chargeback code literally IS the cost of this
  // page) with the carrier's OWN verified weekly/YTD/LTD revenue, miles,
  // expenses, and net — this app's own accounting is what gets
  // cross-checked against it, never the reverse. HARD-CODED to "PRIME
  // INC" specifically, not driven by `carrierCodeMaps` (which today only
  // ever contains Prime's own rows anyway) — this is a deliberately
  // separate, narrower instruction from the carrier-code block above,
  // gated the identical "ONLY IF confirmed" way, so adding a second
  // carrier's own code map later can never accidentally also trigger
  // Prime-shaped operating-statement expectations against it.
  // PRIME STATEMENT AS SOURCE (owner decision 2026-10-13) — every line of
  // the WEEKS column with its printed sign, plus every printed subtotal;
  // the app self-checks them (app/src/import/settlementStatement.ts) and
  // classifies each line (app/src/import/primeStatementLines.ts).
  prompt += `\nAPPROVED ADDITION (Prime Inc operating statement, carrier-scoped, never applied to any other carrier; COLUMNS, owner decision 2026-11-03): If — and ONLY if — this document's own letterhead/header confirms the carrier is "Prime Inc" (or "PRIME INC", "Prime, Inc.") AND the document includes an OPERATING STATEMENT / "STATEMENT OF INCOME AND EXPENSE" page (commonly prepared by Perryman & Associates; columns WEEKS TOTAL, ACTUAL/MILE, YTD TOTAL, LTD TOTAL), populate settlement.operating from that page. COLUMNS: every row below is read as {"label","weeks","ytd","ltd"}: label = the row's text exactly as printed; weeks = the figure in the WEEKS TOTAL column, ytd = the figure in the YTD TOTAL column, ltd = the figure in the LTD TOTAL column, each copied as printed, as text, WITH its sign (a trailing minus stays: "1,997.82-"), or "" when that column is BLANK on that row. Take each figure from the column it is printed under, by its position below the column header: never move a figure into another column, never fill a blank WEEKS TOTAL cell with the YTD or LTD figure, and never read the ACTUAL/MILE column. A row printed with a single amount and no columns (a recap or balance-sheet page) puts that amount in weeks and "" in ytd and ltd. settlement.operating.lines = EVERY individual line of the statement, in page order, each as {"section","label","weeks","ytd","ltd"}: section is one of "revenue" (FREIGHT REVENUE and OTHER REVENUE lines, e.g. REVENUE FROM PRIME INC., EXTRA PAY, FUEL SURCG BILL, OUTSIDE LUMPER 1099 PAY, TOLL 1099 PAY), "fuel_oil_tax" (FUEL,OIL,TAX lines incl. the discount lines), "repair" (EQUIPMENT REPAIR AND MAINT. lines), "tires", "misc" (MISCELLANEOUS lines, e.g. TOLLS, LUMPERS, ADVANCES, WEIGHT TICKETS, QUALCOMM COST, WIRE CHARGE, TRIP XPRESS CHG, PERSONAL PYMNT RCV, OPERATOR TRK EXTRAS), "out_of_pocket", "fixed" (FIXED COST lines), "other" (OTHER INCOME AND EXPENSE lines, e.g. ACCRUAL PERFORMANCE BOND, INTEREST INCOME FROM DEPOSIT, INTEREST EXPENSE ON OVER DRAW, START UP & EXCESS MILEAGE COST). Never put a "TOTAL ..." subtotal line in lines. The MILES row (e.g. 3,316.00, printed inside the revenue block), WEEKS IN SERVICE, PRIOR WEEK BALANCE FORWARD, TOTAL CASH FLOW, SETTLEMENT TO OPERATOR and PERF BD/EMGCY FD are NOT dollar lines of any section — never put them in lines. settlement.operating.totalLines = EVERY printed line whose printed label STARTS WITH the word TOTAL (TOTAL FREIGHT REVENUE, TOTAL OTHER REVENUE, TOTAL REVENUE, TOTAL FUEL,OIL,TAX, TOTAL EQUIPMENT REPAIR AND MAINT., TOTAL TIRES, TOTAL MISCELLANEOUS, TOTAL VARIABLE COSTS, TOTAL OUT OF POCKET COSTS, TOTAL FIXED COST, TOTAL OTHER INCOME AND EXPENSE, TOTAL OPERATING EXPENSES, TOTAL STATEMENT OF INCOME & EXPENSE, TOTAL CASH FLOW), each as {"label","weeks","ytd","ltd"}. A BLOCK TOTAL IS ONLY A LINE WHOSE LABEL STARTS WITH "TOTAL": a line labeled just "MISCELLANEOUS" inside the MISCELLANEOUS block (for example "MISCELLANEOUS 6.50-", a navigation charge) is a REGULAR line of that block — it goes in lines with section "misc", never in totalLines. A block can continue on the next page: its lines can be on one page and its TOTAL line on the next; read both. A block total keeps its printed sign and can be positive (TOTAL MISCELLANEOUS 10.68 when ADVANCES and PERSONAL PYMNT RCV credits exceed the charges). settlement.operating.recapLines = the other labeled amount rows, each as {"label","weeks","ytd","ltd"}: MILES; PRIOR WEEK BALANCE FORWARD below TOTAL STATEMENT, WITH ITS PRINTED SIGN as printed there ("1,202.92-" = the operator owed Prime last week; the accounts page prints the same balance without a sign — never take the sign from that page); SETTLEMENT TO OPERATOR from the balance-sheet page; PERF BD/EMGCY FD from the balance sheet; and the recap's payout line under WHATEVER label Prime printed (DIRECT DEPOSIT TO BANK, AMOUNT LOADED ON CARD, SETTLEMENT GROSS DUE TO/FROM OWNER, ...) — never require the words DIRECT DEPOSIT. NET AMOUNT DUE UNIT is the NET DUE (settlement.netPay), printed BEFORE interest and the balance forward: it is NEVER a recapLines row. Do not fill any single-number subtotal, payout, balance-forward, miles or YTD field of settlement.operating — the app takes every one of them from these labeled rows. NEGATIVE WEEK: TOTAL STATEMENT OF INCOME & EXPENSE and TOTAL CASH FLOW can be negative (a trailing minus, "812.40-") — keep the sign; when TOTAL CASH FLOW is negative the owner owes Prime: SETTLEMENT TO OPERATOR is printed as 0 or blank (weeks "" when blank) and no payout line is printed — never copy TOTAL CASH FLOW, its absolute value or NET AMOUNT DUE UNIT into a payout row. payoutMethod = "bank" when the payout line pays a bank account, "card" when it is loaded on a card, "other" for any other payout label, "" when no payout line is printed. Some statements have NO cash-flow section and end at TOTAL STATEMENT OF INCOME & EXPENSE. Locate every section (accounts, interest, recap, statement, balance sheet) by its printed header, never by its page number: the same section can be on a different page from one statement to the next. weekEndingRaw = the WEEK ENDING printed in this statement page's own header, copied EXACTLY AS PRINTED, as text, character for character (e.g. "26/08/21") — never converted, reordered or completed; weekEnding stays "" (the app reads the printed text itself). weeksInService = WEEKS IN SERVICE from the page header. HELD BY CARRIER (owner decision 2026-10-29), each figure exactly as printed, 0 when not printed: escrowPriorBalance, escrowThisWeek and escrowBalance = the accounts page's PERFORMANCE BOND/EMER FUND PAID account: its prior/beginning balance, this week's amount and its ending balance (e.g. 400.00, 100.00, 500.00), unsigned as printed there; escrowInterestRatePct = the annual interest rate printed on the interest page for the deposit/overdraw interest, in percent as printed (3.83 for 3.83%). If the carrier is anything other than Prime Inc, or no such page exists in this document, leave settlement.operating entirely at its zero/empty defaults — do not estimate or reconstruct these figures from anywhere else in the document.\n`;
  // BANK DEPOSIT IS READ, NEVER COMPUTED (owner decision 2026-10-13).
  prompt += `\nAPPROVED ADDITION (deposit amount, every carrier, owner decision 2026-10-13): settlement.depositAmount = the dollar amount the statement says was paid out to the driver/owner (e.g. "DIRECT DEPOSIT TO BANK ...", "AMOUNT LOADED ON CARD ...", or any other paid-to-owner line), when such a line is printed; leave it 0 when no payout line is printed — never compute it. settlement.payoutMethod = "bank", "card" or "other" for that line ("" when none is printed). Copy the AMOUNT only: never copy a routing number, account number or any other bank digits into ANY field, including summary and descriptions. reimbursementItems[].code = the line's own printed 2-letter code (e.g. "PR", "RF", "WI") when one is printed at the start of the line, else "".\n`;
  // TRAILING-MINUS CREDITS (golden settlement pass, owner decision
  // 2026-10-13, every carrier) — the client also parses "184.85-" as
  // negative (app/src/import/amount.ts); this asks the model for the
  // clean number in the first place.
  prompt += `\nAPPROVED ADDITION (trailing-minus credits, owner decision 2026-10-13, every carrier): settlement statements often print a credit with the minus sign AFTER the number (e.g. "184.85-" on a fuel-discount line). Every settlement amount — deductions[].amount, revenueItems[].amount, reimbursementItems[].amount, and the settlement totals — must be returned as a plain JSON number with the sign in front: a trailing-minus "184.85-" becomes -184.85. Never drop the sign and never return the amount as a string. (settlement.operating lines and subtotals also keep their printed sign, as described above.)\n`;
  // PRINTED LABELS OF THE HEADER TOTALS (owner decision 2026-10-17, every
  // carrier) — page-by-page merging (chunking.ts) only treats two values as
  // a conflict when they came from the same printed label.
  prompt += `\nAPPROVED ADDITION (printed labels of the settlement totals, owner decision 2026-10-17, every carrier): settlement.totalLabels names the printed label text each settlement total on THIS page was read from, exactly as printed (e.g. {"grossRevenue":"TOTAL REV","netPay":"NET AMOUNT DUE UNIT","depositAmount":"DIRECT DEPOSIT"}); leave a label "" when that total is not on this page.\n`;
  // SETTLEMENT TOTALS FROM TOTAL LABELS ONLY (owner decision 2026-11-03,
  // R3): the merge fills the Prime settlement totals only from these lines
  // (chunking.ts withSettlementTotalsFromLabels).
  prompt += `\nAPPROVED ADDITION (settlement total lines, owner decision 2026-11-03): settlement.settlementTotalLines = EVERY line on THESE pages of the settlement (not the STATEMENT OF INCOME AND EXPENSE) whose printed label is a section total or a recap amount — for Prime: TOTAL REV, TOTAL REIMBURSED, TOTAL DEDUCTIONS FROM TRUCK, GROSS AMOUNT DUE UNIT, NET AMOUNT DUE UNIT and every line of the recap block — each as {"label","amount"} with the label exactly as printed and the amount WITH ITS PRINTED SIGN (a trailing minus is negative). Never put a regular line of a section (a single deduction such as "AS 23.50", one load, one reimbursement) in it. A page that prints no such line returns []. grossRevenue, reimbursements, totalDeductions and netPay are each filled ONLY from the TOTAL line of their own label on these pages, and stay 0 when that TOTAL line is not on these pages — never from any other line.\n`;
  // LOADED / EMPTY MILES, EVERY CARRIER (owner decision 2026-10-30, master
  // plan batch C item 6): the printed weekly miles totals with their own
  // labels, read by app/src/import/milesSplit.ts. Additive: no existing
  // field changes meaning.
  prompt += `\nAPPROVED ADDITION (weekly miles lines, every carrier, owner decision 2026-10-30): settlement.milesLines lists every WEEKLY miles TOTAL printed on THIS page, each with its exact printed label, e.g. [{"label":"LOADED MILES","miles":2081},{"label":"DEADHEAD","miles":246},{"label":"TOTAL MILES","miles":2327}]. Copy the label exactly as printed (carriers say "EMPTY", "DEADHEAD", "DH", "UNLOADED", "BOBTAIL", "OUT OF ROUTE" — never rename one into another). Only this week's totals: never per-load lines, never lifetime/YTD/QTD/odometer figures. A deadhead PAY line that prints a dollar amount but no miles is listed with "miles": null. Leave milesLines [] when the page prints no weekly miles total.\n`;
  // PRIME SETTLEMENT PAGES (owner decision 2026-10-17, week ending
  // 2026-08-14: the app read revenue 10,386.86 for a printed 7,914.10 —
  // the TRIP REVENUE column instead of OWNER REVENUE, plus "47.34-" read as
  // +47.34). Carrier-scoped exactly like the operating-statement block.
  prompt += `\nAPPROVED ADDITION (Prime Inc settlement pages, carrier-scoped, never applied to any other carrier, owner decision 2026-10-17): If — and ONLY if — this document's own letterhead/header confirms the carrier is "Prime Inc" (or "PRIME INC", "Prime, Inc."): (1) Load revenue is the OWNER REVENUE column — never the LOAD REVENUE or TRIP REVENUE column (on a percentage load TRIP REVENUE 4,028.34 at .720 is OWNER REVENUE 2,900.40; use 2,900.40). Every RV line's revenueItems[].amount and loads[].revenue = its OWNER REVENUE figure. (2) The trailing minus applies to revenue lines too: "Linehaul 47.34-" is -47.34. (3) An RV line with no miles (e.g. a "Linehaul" adjustment with no LOAD MILES/LOADED/EMPTY) is a revenue adjustment: put it in revenueItems with its signed amount, never in loads. loads = only the RV lines that print miles, with loadedMiles = LOADED and emptyMiles = EMPTY. (4) grossRevenue = the revenue section's TOTAL REV (also the recap's revenue figure). The accounts page's GROSS AMOUNT DUE UNIT and NET AMOUNT DUE UNIT are the NET amount due (netPay), never grossRevenue. The recap's SETTLEMENT GROSS DUE TO/FROM OWNER and its payout line (DIRECT DEPOSIT, AMOUNT LOADED ON CARD, or any other paid-to-owner label) are the deposit (depositAmount), never grossRevenue or netPay. reimbursements = the printed TOTAL REIMBURSED exactly as printed — the reimbursement section can also hold lines that are not reimbursements (PR PERSONAL PAYMNT = the owner's own money in, WA ADVANCE = an advance taken); list every one of them in reimbursementItems with its printed code and keep reimbursements = TOTAL REIMBURSED; totalDeductions = TOTAL DEDUCTIONS FROM TRUCK; netPay = NET AMOUNT DUE UNIT. A printed 0 is a real value, not "missing": EMPTY 0 miles is emptyMiles 0. (5) Prime prints statement header dates as YY/MM/DD: "SETTLEMENTS DATE: 26/08/14" is 2026-08-14 (never 2014-08-26).\n`;
  return prompt;
}

// ============================================================================
// Structured error helper — every failure path returns { error: { type, message } }
// so the app can render something specific instead of a generic failure toast.
// ============================================================================
// STRUCTURED ERROR CODES, THE FULL LIST (owner decision 2026-08-24, "Edge
// Function returned a non-2xx status code" bug fix pass — that raw SDK
// string was reaching users whenever an uncaught exception bypassed every
// one of this file's own errorResponse() calls, since Deno's own default
// error page for an uncaught throw is not JSON. Fixed two ways: (1) the
// WHOLE Deno.serve handler body below is now wrapped in one top-level
// try/catch that always returns a real errorResponse("internal", ...)
// instead of letting Deno's bare error page through; (2) six specific,
// actionable codes so the client never has to guess WHY a call failed —
// billing_exhausted (our own Anthropic account is out of credit/disabled),
// rate_limited (too many requests right now — see the rate-limit-cooldown
// mechanism below), timeout (took too long), oversized (the file itself
// is too big), invalid_document (the document couldn't be read/parsed —
// covers model_refusal/parse_failed below), internal (anything else,
// including a genuinely unexpected bug — always logged in full server-side
// via console.error, never leaked verbatim to the client). `bad_request`/
// `unauthenticated`/`usage_limit_reached` are NOT part of that 6-code set —
// they're pre-existing, already-distinct, already-correctly-surfaced cases
// (a malformed request, a missing session, the app's own usage gate) with
// their own dedicated client-side UI, left untouched by this pass.
type ErrorType =
  | "unauthenticated"
  | "bad_request"
  | "rate_limited"
  | "billing_exhausted"
  | "oversized"
  | "invalid_document"
  | "internal"
  // Kept as their own distinct server-side codes (richer, more specific
  // messages than the generic "invalid_document") — the CLIENT'S friendly-
  // failure classifier (app/src/import/friendlyAiFailure.ts) buckets both
  // of these under the same "invalid_document" user-facing copy.
  | "model_refusal"
  | "parse_failed"
  // Owner decision 2026-08-02 ("settlement imports failing frequently"
  // audit): the model's response hit ANTHROPIC_MAX_TOKENS and was cut off
  // mid-JSON — a genuinely different, actionable failure from a malformed
  // response (parse_failed), which the client should message distinctly
  // ("try splitting this into fewer pages" rather than "try a clearer
  // photo"). Bucketed under the same "timeout" friendly copy client-side.
  | "truncated"
  // Same audit: the Anthropic call itself timed out (ANTHROPIC_TIMEOUT_MS)
  // even after the one retry — distinct from a plain network error so the
  // client can say "this took too long" rather than "could not connect."
  | "timeout"
  // USAGE LIMITS BY FLEET SIZE + CREDIT PACKS (owner decision 2026-08-24,
  // FIVE ADDITIONS pass, PART 5) — the monthly ai-import allowance (60 per
  // active truck, docs/PENDING_SQL.md's ai_usage_config) plus any owner-
  // granted credit packs are both exhausted. Returned BEFORE any Anthropic
  // call is made.
  | "usage_limit_reached";

// RATE-LIMIT COOLDOWN — GLOBAL BACK-PRESSURE (owner decision 2026-08-24,
// same pass). Every user of this app shares ONE Anthropic API key
// (CLAUDE.md: "the mobile app never holds it" — it lives only in this
// function's own secrets) — an Anthropic 429 is therefore an ACCOUNT-WIDE
// signal, not a per-user one. `ai_rate_limit_state` (docs/PENDING_SQL.md
// §56) is a single global row this function writes to via a SERVICE-ROLE
// client (new precedent for this function, matching delete-account/
// reset-data/referral-sync's own established SUPABASE_SERVICE_ROLE_KEY
// usage) whenever a real 429 comes back from Anthropic — every other call,
// in ANY job, for ANY user, checks this row FIRST and short-circuits to a
// safe "rate_limited" result with NO Anthropic call at all while the
// cooldown is active. This is what "pause the queue" actually means here:
// a batch of several queued documents (or several DIFFERENT users' jobs
// running at the same time) all stop hammering Anthropic the instant ANY
// one of them gets rate-limited, instead of every remaining item failing
// independently. Best-effort throughout (every read/write is wrapped in
// try/catch) — a failure of THIS table must never be the reason an import
// fails; worst case, the cooldown gate silently does nothing and Anthropic's
// own per-call 429 handling (still present) is the only backstop.
const DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS = 30;

// UNAWAITED handleJobStart + EdgeRuntime.waitUntil WITHOUT A SERVICE-ROLE
// CLIENT (P1 fix, FULL SYSTEM AUDIT) — renamed from getRateLimitAdminClient()
// to reflect a second use: background import jobs' own import_jobs writes
// go through this SAME cached service-role client instead of the caller's
// own JWT-scoped one — a job's later runs have no user session at all
// (they are started by the previous run, mode 'continue_job'). Every write
// via this client MUST explicitly scope by id + user_id or lease owner (RLS
// is bypassed for a service-role client, unlike the per-request
// JWT-scoped one).
let cachedServiceRoleAdminClient: ReturnType<typeof createClient> | null | undefined;
function getServiceRoleAdminClient(): ReturnType<typeof createClient> | null {
  if (cachedServiceRoleAdminClient !== undefined) return cachedServiceRoleAdminClient;
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  cachedServiceRoleAdminClient = url && serviceRoleKey ? createClient(url, serviceRoleKey) : null;
  if (!cachedServiceRoleAdminClient) {
    console.error("[ai-import] SUPABASE_SERVICE_ROLE_KEY not set — rate-limit cross-job cooldown and background-job service-role writes are both disabled (per-call/per-request handling still applies).");
  }
  return cachedServiceRoleAdminClient;
}

// Anthropic's Retry-After header is documented as seconds for a 429 — this
// also tolerates an HTTP-date form defensively, and any missing/unparsable
// value falls back to the caller's own default rather than throwing.
function parseRetryAfterSeconds(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const asSeconds = Number(headerValue);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) return Math.ceil(asSeconds);
  const asDate = Date.parse(headerValue);
  if (Number.isFinite(asDate)) {
    const diffSeconds = Math.ceil((asDate - Date.now()) / 1000);
    return diffSeconds > 0 ? diffSeconds : 0;
  }
  return null;
}

// Returns 0 (no cooldown, or the mechanism is unavailable) or the real
// remaining milliseconds until `ai_rate_limit_state.limited_until`.
async function getRateLimitCooldownMs(): Promise<number> {
  const admin = getServiceRoleAdminClient();
  if (!admin) return 0;
  try {
    const { data } = await admin.from("ai_rate_limit_state").select("limited_until").eq("id", true).maybeSingle();
    const limitedUntil = data?.limited_until as string | null | undefined;
    if (!limitedUntil) return 0;
    const remaining = new Date(limitedUntil).getTime() - Date.now();
    return remaining > 0 ? remaining : 0;
  } catch (err) {
    console.error(`[ai-import] rate-limit cooldown read failed (treating as no cooldown): ${(err as Error).message}`);
    return 0;
  }
}

// Extends (never shrinks) the shared cooldown — a best-effort read-then-max
// rather than a transaction; an occasional race just means a slightly
// shorter cooldown wins, never a correctness problem for this feature.
async function setRateLimitCooldown(seconds: number, reason: string): Promise<void> {
  const admin = getServiceRoleAdminClient();
  if (!admin) return;
  try {
    const untilMs = Date.now() + seconds * 1000;
    const { data } = await admin.from("ai_rate_limit_state").select("limited_until").eq("id", true).maybeSingle();
    const existingMs = data?.limited_until ? new Date(data.limited_until as string).getTime() : 0;
    const finalMs = Math.max(existingMs, untilMs);
    await admin.from("ai_rate_limit_state").update({
      limited_until: new Date(finalMs).toISOString(),
      last_reason: reason.slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq("id", true);
    console.log(`[ai-import] rate-limit cooldown set until ${new Date(finalMs).toISOString()} (${seconds}s requested) — ${reason.slice(0, 200)}`);
  } catch (err) {
    console.error(`[ai-import] rate-limit cooldown write failed: ${(err as Error).message}`);
  }
}

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
  model?: { model: string; maxTokens: number },
  schema?: JsonSchema | null,
): Promise<{ resp: Response } | { errorType: "timeout" | "internal"; message: string }> {
  // STRUCTURED OUTPUT (R4, owner decision 2026-11-03): every call sends
  // output_config.format json_schema (outputSchema.ts). A 400 that refuses
  // the schema itself is retried once without it, so a schema problem can
  // never stop an import (logged as SCHEMA_REJECTED).
  let useSchema = !!schema;
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
          model: model?.model ?? ANTHROPIC_MODEL,
          max_tokens: model?.maxTokens ?? ANTHROPIC_MAX_TOKENS,
          messages: [{ role: "user", content: [contentBlock, { type: "text", text: prompt }] }],
          ...(useSchema && schema ? { output_config: { format: { type: "json_schema", schema } } } : {}),
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (useSchema && resp.status === 400) {
        const bodyText = await resp.clone().text().catch(() => "");
        if (isSchemaRejection(resp.status, bodyText)) {
          console.warn(`[ai-import] SCHEMA_REJECTED: retrying without output_config: ${bodyText.slice(0, 300)}`);
          useSchema = false;
          attempt--;
          continue;
        }
      }
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
        await new Promise((r) => setTimeout(r, backoffMs(attempt)));
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
        await new Promise((r) => setTimeout(r, backoffMs(attempt)));
        continue;
      }
      console.error(`[ai-import] Anthropic call failed after ${maxAttempts} attempt(s): ${(err as Error).message}`);
      return { errorType: "internal", message: `Network error calling Anthropic: ${(err as Error).message}` };
    }
  }
  // Unreachable given maxAttempts >= 1, but keeps TS satisfied.
  return { errorType: "internal", message: "Unknown error calling Anthropic." };
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
  model?: { model: string; maxTokens: number },
  // R4: the reply schema. undefined = any docType the prompt prints
  // (outputSchema.ts extractionOutputSchema); a caller that knows the shape
  // passes it (a settlement page, the classification reply).
  schema?: JsonSchema | null,
): Promise<ExtractOneResult> {
  // GLOBAL RATE-LIMIT GATE (owner decision 2026-08-24) — checked BEFORE
  // ever calling Anthropic, on every single call this function makes
  // (image, single-call PDF, and every individual page). Whenever ANY
  // other call — in any job, for any user — has recently hit a real
  // Anthropic 429, this short-circuits to the same "rate_limited" result
  // with zero further load on Anthropic, instead of every queued item
  // independently discovering the same 429 on its own.
  const cooldownMs = await getRateLimitCooldownMs();
  if (cooldownMs > 0) {
    const retryAfterSeconds = Math.ceil(cooldownMs / 1000);
    return {
      errorType: "rate_limited",
      message: "The AI import service is temporarily busy — please try again in a few minutes.",
      extra: { retryAfterSeconds },
    };
  }

  const replySchema = schema === undefined ? extractionOutputSchema(prompt, null) : schema;
  const callResult = await callAnthropicMessages(anthropicKey, contentBlock, prompt, timeoutMs, maxAttempts, model, replySchema);
  if ("errorType" in callResult) return callResult;
  const anthropicResp = callResult.resp;

  if (!anthropicResp.ok) {
    const bodyText = await anthropicResp.text().catch(() => "");
    // Always logged server-side in full, regardless of what (if anything)
    // is forwarded to the client — this is item 1/5's "log the underlying
    // Anthropic status and message server-side" requirement.
    console.error(`[ai-import] Anthropic HTTP ${anthropicResp.status}: ${bodyText.slice(0, 1000)}`);
    // 401/403 = bad/revoked API key; 402 = Anthropic doesn't actually use
    // 402, but is included defensively in case that ever changes — all
    // three mean "this app's own Anthropic account can't be billed/
    // authenticated right now," never something a retry or a smaller file
    // can fix.
    if (anthropicResp.status === 401 || anthropicResp.status === 403 || anthropicResp.status === 402) {
      return {
        errorType: "billing_exhausted",
        message: "AI reading is temporarily unavailable — your data is safe, and you can still add entries manually.",
      };
    }
    if (anthropicResp.status === 429) {
      const retryAfterSeconds =
        parseRetryAfterSeconds(anthropicResp.headers.get("retry-after")) ?? DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS;
      await setRateLimitCooldown(retryAfterSeconds, `Anthropic HTTP 429: ${bodyText.slice(0, 200)}`);
      return {
        errorType: "rate_limited",
        message: "The AI import service is temporarily busy — please try again in a few minutes.",
        extra: { retryAfterSeconds },
      };
    }
    // Any other status (a persistent 5xx after callAnthropicMessages's own
    // one retry, or anything unexpected) — genuinely our/Anthropic's fault,
    // never the user's document.
    return {
      errorType: "internal",
      message: "Something went wrong on our end while reading this document — your data is safe. Please try again.",
      extra: { detail: bodyText.slice(0, 500) },
    };
  }

  const data = await anthropicResp.json();
  if (data.error) {
    console.error(`[ai-import] Anthropic returned a 200 with an embedded error: ${JSON.stringify(data.error).slice(0, 500)}`);
    return { errorType: "internal", message: "Something went wrong on our end while reading this document — your data is safe. Please try again." };
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
      extra: { raw: raw.slice(0, FAILED_REPLY_MAX_CHARS) },
    };
  }

  // R2 (2026-11-03): statement columns {label, weeks, ytd, ltd} -> WEEKS only.
  return { extraction: normalizeStatementColumns(parsed) };
}

// base64<->bytes uses the Web-standard atob/btoa (both Deno globals) —
// bytesToBase64 chunks the String.fromCharCode(...) spread in 0x8000-byte
// batches to avoid a call-stack overflow on a large PDF's byte array.
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
  // OWNER/DEV ACCOUNT FLAG (owner decision) — an 'owner' plan
  // (docs/PENDING_SQL.md §58) bypasses the monthly allowance entirely:
  // no counter, no soft-limit notice, no hard limit, no credit-pack
  // prompt. Checked FIRST, before any of the counting queries below, so
  // an owner's own heavy testing never even touches ai_usage_config/
  // trucks/ai_usage_log/ai_credit_purchases for this purpose. Deliberately
  // does NOT touch the separate, GLOBAL rate-limit cooldown gate
  // (getRateLimitCooldownMs(), inside extractOnePass) — that's the same
  // shared Anthropic API key every user draws from, and an owner account
  // bypassing IT would risk real users, not just this account's own
  // allowance (owner decision, item 3).
  const { data: ownerCheck } = await supabase.from("profiles").select("plan").eq("user_id", userId).maybeSingle();
  if (ownerCheck?.plan === "owner") return { allowed: true, consumesCredit: false };

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
  // OWNER/DEV ACCOUNT FLAG — an owner account is never "over allowance"
  // (checkAiImportUsageAllowed() above already short-circuits before this
  // is ever reached in practice), but guard here too in case this
  // function is ever called independently — it must never consume a
  // credit pack that doesn't apply to this account anyway.
  const { data: ownerCheck } = await supabase.from("profiles").select("plan").eq("user_id", userId).maybeSingle();
  if (ownerCheck?.plan === "owner") return;

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

  // P0 SECURITY + TOCTOU FIX (docs/PENDING_SQL.md §59, FULL SYSTEM
  // AUDIT owner decision 2026-08-26): this used to be a plain client-
  // side select -> sort -> `update({credits_remaining: n - 1})` —  (a)
  // it relied on a blanket self-service UPDATE policy that ALSO let any
  // authenticated user grant themselves unlimited credits directly via
  // the REST API, and (b) the read-then-write was a genuine lost-update
  // race under concurrent calls. The RPC does the pack selection, row
  // lock, and decrement as ONE atomic transaction, scoped internally to
  // auth.uid() (never a parameter), and needs no client-writable UPDATE
  // policy on the table at all — see that section for the full RPC body
  // and reasoning. Returns null (never an error) when no credit is
  // available, same as the old code's silent no-op in that case.
  const { error } = await supabase.rpc("consume_ai_import_credit");
  if (error) {
    console.error(`[ai-import] consume_ai_import_credit RPC failed for user ${userId}: ${error.message}`);
  }
}

// COST CONTROL — LOGGING (owner decision 2026-08-24, FIVE ADDITIONS pass,
// PART 4 item 1; extended 2026-08-24 "non-2xx never leaks raw" pass, item
// 5 — OWNER DIAGNOSTIC) — every ai-import call, success or failure, so
// cost per user AND the real cause of every failure is queryable
// (docs/ADMIN_RUNBOOK.md's own recipe). `detail` (optional) is the
// server's own full message for that failure — the raw Anthropic status/
// body already went to console.error at the point of failure (searchable
// via `supabase functions logs ai-import`); this puts a short version of
// the SAME cause into `ai_usage_log.failure_reason` too so it's queryable
// with plain SQL instead of grepping logs. Best-effort: a logging failure
// must never fail the actual import response — wrapped in try/catch and
// only ever logged to the function's own console.
async function logAiUsage(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  success: boolean,
  failureReason: string | null,
  detail?: string | null,
): Promise<void> {
  try {
    const reason = failureReason && detail ? `${failureReason}: ${detail.slice(0, 400)}` : failureReason;
    const { error } = await supabase.from("ai_usage_log").insert({
      user_id: userId,
      call_type: "ai_import",
      success,
      failure_reason: reason,
    });
    if (error) console.error(`[ai-import] usage log insert failed: ${error.message}`);
  } catch (err) {
    console.error(`[ai-import] usage log insert threw: ${(err as Error).message}`);
  }
}

// ============================================================================
// BACKGROUND IMPORT JOBS: shared server pieces of the settlement reader's
// jobs (reader/server.ts): the plan-aware budget, usage logging, credits,
// the stored file and the next-run request. The old page-by-page reader
// (jobEngine.ts runJobStep) was removed 2026-11-13 (commit 6).
// ============================================================================

// PLAN-AWARE BUDGET (owner decision 2026-10-31): Free limits (exit by
// 130 s of 150 s) unless the secret AI_IMPORT_SUPABASE_PLAN is "pro" (or
// paid/team/enterprise) — then exit by 300 s of the documented 400 s
// (jobEngine.ts limitsForPlan()). The old AI_IMPORT_WALL_CLOCK_MS (a raw
// number with no upper bound) is no longer read.
const JOB_PLAN_TIER = planTierFrom(Deno.env.get(PLAN_SECRET_NAME));
const JOB_LIMITS = limitsForPlan(JOB_PLAN_TIER);
console.log(`[ai-import] job budget: plan=${JOB_PLAN_TIER} exitBy=${JOB_LIMITS.exitByMs}ms callEnd=${JOB_LIMITS.callEndLimitMs}ms documentedWallClock=${JOB_LIMITS.wallClockMs}ms`);
if (Deno.env.get("AI_IMPORT_WALL_CLOCK_MS")) {
  console.warn(`[ai-import] AI_IMPORT_WALL_CLOCK_MS is set but ignored — use ${PLAN_SECRET_NAME}=pro instead, and unset it.`);
}

async function logJobUsage(
  admin: ReturnType<typeof createClient>,
  userId: string,
  callType: UsageCallType,
  success: boolean,
  reason?: string,
): Promise<void> {
  try {
    const { error } = await admin.from("ai_usage_log").insert({
      user_id: userId,
      call_type: callType,
      success,
      failure_reason: reason ? scrubBankDigits(reason).slice(0, 500) : null,
    });
    if (error) console.error(`[ai-import] usage log insert failed (${callType}): ${error.message}`);
  } catch (err) {
    console.error(`[ai-import] usage log insert threw: ${(err as Error).message}`);
  }
}

// Same allowance arithmetic as consumeOneCreditIfOverAllowance(), but for a
// run that has no user session (a continuation run): the counting queries
// are scoped by user_id explicitly and the credit is taken through the
// service-role-only consume_ai_import_credit_for() RPC (§78).
async function consumeCreditForUserIfOverAllowance(admin: ReturnType<typeof createClient>, userId: string): Promise<void> {
  try {
    const { data: owner } = await admin.from("profiles").select("plan").eq("user_id", userId).maybeSingle();
    if (owner?.plan === "owner") return;
    const [{ data: config }, { count: activeTruckCount }, { count: usedThisMonth }] = await Promise.all([
      admin.from("ai_usage_config").select("imports_per_truck_per_month, account_ceiling").maybeSingle(),
      admin.from("trucks").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("is_active", true),
      admin
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
    if ((usedThisMonth ?? 0) <= allowance) return;
    const { error } = await admin.rpc("consume_ai_import_credit_for", { p_user_id: userId });
    if (error) console.error(`[ai-import] consume_ai_import_credit_for failed for user ${userId}: ${error.message}`);
  } catch (err) {
    console.error(`[ai-import] credit consumption threw: ${(err as Error).message}`);
  }
}

// The PDF's CreationDate rides along with the extraction (printed-date
// cross-check in the app, owner decision 2026-10-29).
function withPdfCreationDate<T>(extraction: T, created: string | null): T {
  if (!created || !extraction || typeof extraction !== "object") return extraction;
  return { ...(extraction as Record<string, unknown>), pdfCreationDate: created } as T;
}

async function downloadStoredFile(admin: ReturnType<typeof createClient>, storagePath: string): Promise<Uint8Array | null> {
  const { data, error } = await admin.storage.from("documents").download(storagePath);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

async function countPdfPages(bytes: Uint8Array): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return doc.getPageCount();
  } catch {
    return null;
  }
}

// Starts the next run of a job: this same function, mode 'continue_job',
// authorized with the service key (never accepted from a user). Awaited
// only until that invocation answers 202; if it fails, the app resumes the
// job once its heartbeat is 3 minutes old.
async function startNextRun(jobId: string): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    console.error(`[ai-import] job ${jobId}: cannot start the next run (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing) — the app will resume it`);
    return;
  }
  try {
    const resp = await fetch(`${url}/functions/v1/ai-import`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "continue_job", jobId }),
    });
    await resp.text().catch(() => "");
    console.log(`[ai-import] job ${jobId}: next run requested, status ${resp.status}`);
  } catch (err) {
    console.error(`[ai-import] job ${jobId}: next run request failed: ${(err as Error).message} — the app will resume it`);
  }
}

function edgeRuntimeAvailable(): boolean {
  // deno-lint-ignore no-explicit-any
  return typeof (globalThis as any).EdgeRuntime?.waitUntil === "function";
}

function runInBackground(work: Promise<void>): void {
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime.waitUntil(work);
}

function accepted(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status: 202, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

// SYSTEM CHECK (statement reading plan step A, owner 2026-10-31): mode
// "diagnose". Booleans, names and counts only — never a secret value, an
// amount, a file name or bank digits (diagnose.ts). Reads nothing from any
// document, uses no import credit, and changes no data: tables are probed
// with zero-row selects, database functions with an argument name no
// function has (never executed), storage with a one-item list of the
// caller's own folder, and job rows are the caller's own.
async function handleDiagnose(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<Response> {
  const admin = getServiceRoleAdminClient();
  const probe = admin ?? supabase;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

  const missingColumns: string[] = [];
  for (const { table, columns } of REQUIRED_COLUMNS) {
    const { error } = await probe.from(table).select(columns.join(",")).limit(0);
    if (!error) continue;
    for (const col of columns) {
      const { error: colErr } = await probe.from(table).select(col).limit(0);
      if (colErr && columnErrorMeansMissing(colErr)) missingColumns.push(`${table}.${col}`);
    }
  }
  // pg_proc first (PENDING_SQL §85); the old probe only until §85 runs.
  const missingFunctions: string[] = [];
  let functionsCheckedBy: FunctionsCheckedBy = "pg_proc";
  const pg = await probe.rpc(PG_PROC_RPC, { p_names: REQUIRED_RPCS });
  const fromPgProc = missingFromPgProc(pg.data, pg.error);
  if (fromPgProc) {
    missingFunctions.push(...fromPgProc);
  } else {
    functionsCheckedBy = "probe";
    for (const name of REQUIRED_RPCS) {
      const { error } = await probe.rpc(name, DIAGNOSE_PROBE_ARG);
      if (!rpcProbePresent(name, error)) missingFunctions.push(name);
    }
  }
  console.log(`[ai-import] diagnose functions by ${functionsCheckedBy}: missing=${missingFunctions.join(",") || "none"}`);

  let storageReachable = false;
  try {
    const { error } = await supabase.storage.from("documents").list(userId, { limit: 1 });
    storageReachable = !error;
  } catch {
    storageReachable = false;
  }

  // DIAGNOSTICS JOB DETAIL (owner 2026-11-03): + id and the verdict
  // (page_plan.review), so each job line names its verdict source, final
  // state, failing checks and page errors.
  let jobRows: JobRowForDiagnose[] = [];
  const fullCols = "status, created_at, updated_at, error_step, error_page, pages_done, pages_total, page_results, progress";
  const withReview = await supabase
    .from("import_jobs")
    .select(`id, ${fullCols}, review:page_plan->review`)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  const { data: jobsData, error: jobsErr } = withReview.error
    ? await supabase.from("import_jobs").select(fullCols).eq("user_id", userId).order("created_at", { ascending: false }).limit(50)
    : withReview;
  if (!jobsErr) {
    jobRows = (jobsData ?? []) as JobRowForDiagnose[];
  } else {
    const { data } = await supabase
      .from("import_jobs")
      .select("status, created_at, updated_at, error_step")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    jobRows = (data ?? []) as JobRowForDiagnose[];
  }

  const fetcher: FetchLike = (url, init) => fetch(url, init);
  const models = anthropicKey
    ? await Promise.all(DIAGNOSE_MODELS.map((m) => runModelCheck(m, anthropicKey, fetcher, scrubBankDigitsInText)))
    : [];
  for (const m of models) {
    console.log(`[ai-import] diagnose model ${m.model}: ${m.outcome} status=${m.httpStatus} ${m.latencyMs}ms in=${m.inputTokens} out=${m.outputTokens}`);
  }

  const secrets = [anthropicKey, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? ""];
  const report = assembleDiagnoseReport(
    {
      deploymentId: Deno.env.get("DENO_DEPLOYMENT_ID") ?? null,
      plan: planInfo(JOB_PLAN_TIER, JOB_LIMITS),
      anthropicKeyPresent: anthropicKey.length > 0,
      storageReachable,
      schema: { ok: missingColumns.length === 0 && missingFunctions.length === 0, missingColumns, missingFunctions, functionsCheckedBy },
      jobs: summarizeJobs(jobRows, Date.now()),
      models,
      checkedAt: new Date().toISOString(),
    },
    secrets,
    scrubBankDigitsInText,
    stampedBuildId(AI_IMPORT_GIT_HASH, AI_IMPORT_DEPLOYED_AT),
  );
  return new Response(JSON.stringify(report), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

// Mode 'continue_job': the next run of a chain, requested by the previous
// run with the service key. Never accepted with a user token. Only a
// reader job (progress.reader) runs; a job of the old reader (removed
// 2026-11-13) is left as it is: the app shows it as failed with [Read
// again], which starts a new reader job from the same stored file.
async function handleJobContinue(body: { jobId?: string }, invocationStartedAt: number): Promise<Response> {
  if (!body.jobId) return errorResponse("bad_request", "jobId is required.", 400);
  const admin = getServiceRoleAdminClient();
  if (!admin || !edgeRuntimeAvailable()) return errorResponse("internal", "Background import isn't available right now.", 500);
  const { data: row } = await admin.from("import_jobs").select("progress").eq("id", body.jobId).maybeSingle();
  if (row && isReaderRow(row.progress)) runInBackground(runReaderJob(admin, body.jobId, invocationStartedAt, readerKit()));
  else console.log(`[ai-import] job ${body.jobId}: old reader job, not continued (read it again with the new reader)`);
  return accepted({ jobId: body.jobId });
}

// ============================================================================
// THE SETTLEMENT READER (owner decision 2026-11-13; reader/server.ts, the
// decisions in reader/core.gen.js). Modes: read_start (a new import),
// read_again (a failed job, while reads remain), read_answer (the owner's
// typed profit lines, no model call), read_resume (the app's backup restart
// of a reading job whose worker stopped). Job status column: reading ->
// processing/queued, ready -> ready, needs_input -> needs_decision,
// failed -> failed; the details are progress.reader. The old reader's modes
// were removed 2026-11-13 (commit 6, after the 18-week device test); a
// request for one gets OLD_READER_MESSAGE.
// ============================================================================

function readerKit(): ReaderKit {
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  return {
    limits: JOB_LIMITS,
    anthropicKey,
    getCooldownMs: getRateLimitCooldownMs,
    setCooldown: setRateLimitCooldown,
    async general({ bytes, inputs, timeoutMs }): Promise<ModelReply> {
      const started = performance.now();
      if (!anthropicKey) return { outcome: { ok: false, error: "api_error", detail: "ANTHROPIC_API_KEY not set" }, usage: null, ms: 0 };
      const prompt = buildExtractionPrompt(inputs.docHint, inputs.locale, inputs.customCategories, inputs.learningRules, inputs.carrierCodeMaps);
      const block = { type: "document", source: { type: "base64", media_type: "application/pdf", data: bytesToBase64(bytes) } };
      const r = await extractOnePass(anthropicKey, block, prompt, timeoutMs, MAX_ANTHROPIC_ATTEMPTS);
      const ms = Math.round(performance.now() - started);
      if ("errorType" in r) {
        const error = r.errorType === "timeout"
          ? "timeout"
          : r.errorType === "truncated"
          ? "max_tokens"
          : r.errorType === "model_refusal"
          ? "refusal"
          : r.errorType === "parse_failed"
          ? "unreadable_reply"
          : r.errorType === "rate_limited"
          ? "busy"
          : "api_error";
        return { outcome: { ok: false, error, detail: scrubBankDigitsInText(r.message).slice(0, 300) }, usage: null, ms };
      }
      return { outcome: { ok: true, value: withPdfCreationDate(r.extraction, pdfCreationDateOf(bytes)) }, usage: null, ms };
    },
    async logImport(admin, userId, success, reason) {
      await logJobUsage(admin, userId, "ai_import", success, reason);
      if (success) await consumeCreditForUserIfOverAllowance(admin, userId);
    },
    startNextRun,
    download: downloadStoredFile,
    scrub: scrubBankDigits,
    pdfCreationDate: pdfCreationDateOf,
  };
}

// The old reader's request modes (removed 2026-11-13) and the words the
// app shows for a job it read (importFlow.reader.reason.oldReader).
const OLD_READER_MODES = new Set(["job", "retry_job", "resume_job", "answer_job", "read_pages", "reread_job", "job_verdict"]);
const OLD_READER_MESSAGE = "This file was read by the old reader. Read it again with the new reader.";

type ReaderRequestBody = ReaderPromptInputs & {
  storagePath?: string;
  mediaType?: string;
  fileName?: string;
  jobId?: string;
  importDate?: string;
  answers?: { label?: unknown; amount?: unknown }[];
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

// Mode 'read_start': a new import read by the new reader. Same limits as
// every import (daily count, allowance, file size, page count). PDFs only:
// a photo stays on the direct path (one call).
async function handleReadStart(supabase: ReturnType<typeof createClient>, userId: string, body: ReaderRequestBody, invocationStartedAt: number): Promise<Response> {
  if (!edgeRuntimeAvailable()) return errorResponse("internal", "Background import isn't available right now — your data is safe. Please try again in a moment.", 500);
  if (!body.storagePath || !body.mediaType) return errorResponse("bad_request", "storagePath and mediaType are required.", 400);
  if (!body.storagePath.startsWith(`${userId}/`)) return errorResponse("bad_request", "That file could not be found.", 403);
  if (!body.mediaType.includes("pdf")) return errorResponse("bad_request", "Only a PDF can be read in the background.", 400);
  const admin = getServiceRoleAdminClient();
  if (!admin) return errorResponse("internal", "Background import isn't configured on the server — your data is safe.", 500);
  const { data: inserted, error: insertError } = await supabase
    .from("import_jobs")
    .insert({ user_id: userId, storage_path: body.storagePath, media_type: body.mediaType, file_name: body.fileName ?? null, status: "queued" })
    .select("id")
    .single();
  if (insertError || !inserted) {
    console.error(`[ai-import] read_start insert failed: ${insertError?.message ?? "no row returned"}`);
    return errorResponse("internal", "Could not start the import job — your data is safe. Please try again.", 500);
  }
  const jobId = inserted.id as string;
  const failJob = async (message: string, step: string, status: number): Promise<Response> => {
    await supabase.from("import_jobs").update({ status: "failed", error_message: message, error_step: step, updated_at: new Date().toISOString() }).eq("id", jobId);
    return errorResponse(step as ErrorType, message, status);
  };
  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);
  const { count, error: countError } = await supabase.from("documents").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("imported_at", startOfDayUtc.toISOString());
  if (countError) return failJob("Could not check today's import count — your data is safe. Please try again.", "internal", 500);
  if ((count ?? 0) >= DAILY_IMPORT_LIMIT) return failJob(`Daily import limit reached (${DAILY_IMPORT_LIMIT}/day). Try again tomorrow.`, "rate_limited", 429);
  const usageCheck = await checkAiImportUsageAllowed(supabase, userId);
  if (!usageCheck.allowed) {
    await logAiUsage(supabase, userId, false, "usage_limit_reached");
    return failJob(usageCheck.message, "usage_limit_reached", 429);
  }
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return failJob("AI reading is temporarily unavailable — your data is safe, and you can still add entries manually.", "internal", 500);
  const bytes = await downloadStoredFile(admin, body.storagePath);
  if (!bytes) return failJob("Could not read the uploaded file — your data is safe. Please try again.", "internal", 500);
  const sizeRefusal = checkImportLimits(0, bytes.byteLength);
  if (sizeRefusal) return failJob(sizeRefusal.message, sizeRefusal.code, 413);
  const totalPages = await countPdfPages(bytes);
  if (totalPages == null) return failJob("This PDF could not be opened — it may be damaged or password-protected. Try exporting it again.", "invalid_document", 422);
  const pageRefusal = checkImportLimits(totalPages, bytes.byteLength);
  if (pageRefusal) return failJob(pageRefusal.message, pageRefusal.code, 413);
  const importDate = typeof body.importDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.importDate) ? body.importDate : new Date().toISOString().slice(0, 10);
  const reader = readerCore.newReaderProgress(totalPages, importDate);
  const inputs: ReaderPromptInputs = { docHint: body.docHint, locale: body.locale, customCategories: body.customCategories, learningRules: body.learningRules, carrierCodeMaps: body.carrierCodeMaps };
  const { error: progressError } = await admin
    .from("import_jobs")
    .update({ progress: { reader, inputs }, status: "queued", pages_total: totalPages, updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("user_id", userId);
  if (progressError) return failJob("Could not start the import job — your data is safe. Please try again.", "internal", 500);
  console.log(`[ai-import] reader ${jobId} accepted: ${totalPages} page(s), ${bytes.byteLength} bytes`);
  runInBackground(runReaderJob(admin, jobId, invocationStartedAt, readerKit(), bytes));
  return accepted({ jobId });
}

type ReaderJobRow = {
  id: string;
  user_id: string;
  status: string;
  progress: ReaderRowProgress;
  result_json: unknown;
  heartbeat_at: string | null;
  lease_until: string | null;
};

async function loadReaderJob(supabase: ReturnType<typeof createClient>, userId: string, jobId: string | undefined): Promise<ReaderJobRow | null> {
  if (!jobId) return null;
  const { data: job } = await supabase
    .from("import_jobs")
    .select("id, user_id, status, progress, result_json, heartbeat_at, lease_until")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || job.user_id !== userId || !isReaderRow(job.progress)) return null;
  return job as unknown as ReaderJobRow;
}

// Mode 'read_again': the owner's [Read again] on a failed job. Allowed only
// while content reads remain (max 2 per job); counts toward that max.
async function handleReadAgain(supabase: ReturnType<typeof createClient>, userId: string, body: ReaderRequestBody, invocationStartedAt: number): Promise<Response> {
  const admin = getServiceRoleAdminClient();
  if (!admin || !edgeRuntimeAvailable()) return errorResponse("internal", "Background import isn't available right now — your data is safe.", 500);
  const job = await loadReaderJob(supabase, userId, body.jobId);
  if (!job) return errorResponse("bad_request", "That import job could not be found.", 404);
  const next = readerCore.readAgain(job.progress.reader);
  if (!next) return errorResponse("bad_request", "This file was already read twice. Upload it again to start a new import.", 400);
  const { data, error } = await admin
    .from("import_jobs")
    .update({
      progress: { ...job.progress, reader: next.progress },
      status: "queued",
      error_step: null,
      error_message: null,
      completed_at: null,
      lease_owner: null,
      lease_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("user_id", userId)
    .eq("status", "failed")
    .select("id");
  if (error || (data ?? []).length === 0) return errorResponse("internal", "Could not start reading again — your file is safe. Please try again.", 500);
  console.log(`[ai-import] reader ${job.id}: read again (read ${next.progress.readsStarted + 1} of 2)`);
  runInBackground(runReaderJob(admin, job.id, invocationStartedAt, readerKit()));
  return accepted({ jobId: job.id });
}

// Mode 'read_answer': the owner typed the profit lines the statement did
// not show (needs_input). No model call; the gate decides again.
async function handleReadAnswer(supabase: ReturnType<typeof createClient>, userId: string, body: ReaderRequestBody, invocationStartedAt: number): Promise<Response> {
  const admin = getServiceRoleAdminClient();
  if (!admin) return errorResponse("internal", "Background import isn't configured on the server — your data is safe.", 500);
  const job = await loadReaderJob(supabase, userId, body.jobId);
  if (!job || !job.result_json) return errorResponse("bad_request", "That import job could not be found.", 404);
  const answers = (Array.isArray(body.answers) ? body.answers : [])
    .filter((a) => typeof a?.label === "string" && typeof a?.amount === "number" && Number.isFinite(a.amount))
    .map((a) => ({ label: String(a.label), amount: a.amount as number }))
    .slice(0, 20);
  const p = job.progress.reader;
  const next = readerCore.afterAnswers(p, job.result_json, answers, { importDate: p.importDate });
  if (!next) return errorResponse("bad_request", "This import is not waiting for an answer.", 400);
  const { data, error } = await admin
    .from("import_jobs")
    .update({
      progress: { ...job.progress, reader: next.progress },
      status: next.status,
      error_step: next.progress.failure?.reason ?? null,
      ...(next.extraction ? { result_json: scrubBankDigits(next.extraction) } : {}),
      ...(next.progress.state !== "needs_input" ? { completed_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("user_id", userId)
    .eq("status", "needs_decision")
    .select("id");
  if (error || (data ?? []).length === 0) return errorResponse("internal", "Could not record your answer — your file is safe. Please try again.", 500);
  console.log(`[ai-import] reader ${job.id}: answers ${answers.map((a) => a.label).join(",") || "none"} -> ${next.progress.state}`);
  if (readerCore.pendingAttachments(next.progress).length > 0 && edgeRuntimeAvailable()) {
    runInBackground(runReaderJob(admin, job.id, invocationStartedAt, readerKit()));
  }
  return jsonResponse({ jobId: job.id, state: next.progress.state, questions: next.progress.questions });
}

// Mode 'read_resume': the app's backup restart of a reading job whose
// worker stopped (no heartbeat for 2 minutes releases its lease), or of a
// final job with attachments left.
async function handleReadResume(supabase: ReturnType<typeof createClient>, userId: string, body: ReaderRequestBody, invocationStartedAt: number): Promise<Response> {
  const admin = getServiceRoleAdminClient();
  if (!admin || !edgeRuntimeAvailable()) return errorResponse("internal", "Background import isn't available right now — your data is safe.", 500);
  const job = await loadReaderJob(supabase, userId, body.jobId);
  if (!job) return errorResponse("bad_request", "That import job could not be found.", 404);
  const attachmentsLeft = readerCore.pendingAttachments(job.progress.reader).length > 0;
  if (job.progress.reader.state !== "reading" && !attachmentsLeft) return accepted({ jobId: job.id });
  const nowMs = Date.now();
  const heartbeatMs = job.heartbeat_at ? new Date(job.heartbeat_at).getTime() : NaN;
  const leaseHeld = job.lease_until != null && new Date(job.lease_until).getTime() > nowMs;
  if (leaseHeld && leaseIsStale(Number.isFinite(heartbeatMs) ? heartbeatMs : null, nowMs)) {
    const cutoffIso = new Date(nowMs - STALE_LEASE_AFTER_MS).toISOString();
    await admin
      .from("import_jobs")
      .update({ lease_owner: null, lease_until: null })
      .eq("id", job.id)
      .eq("user_id", userId)
      .or(`heartbeat_at.is.null,heartbeat_at.lt.${cutoffIso}`);
  }
  runInBackground(runReaderJob(admin, job.id, invocationStartedAt, readerKit()));
  return accepted({ jobId: job.id });
}

Deno.serve(async (req: Request) => {
  // Computed inside the handler (the module stays loaded across
  // invocations): a background job run measures its budget from here.
  const invocationStartedAt = performance.now();

  // TOP-LEVEL TRY/CATCH (owner decision 2026-08-24, "Edge Function
  // returned a non-2xx status code" bug fix pass) — THE actual fix for
  // that raw SDK string reaching users. Before this, ANY uncaught
  // exception anywhere below (a Postgres error not wrapped in its own
  // try/catch, a bug in the page-merge logic, an unexpected null
  // reference) bypassed every one of this file's own errorResponse()
  // calls entirely — Deno's own default response for an uncaught throw is
  // NOT JSON, so the client's `ctx.json()` parse failed too, and it fell
  // back to the Supabase SDK's own hardcoded, unhelpful default message.
  // Now every single code path below always returns real, structured
  // JSON — the full real error is still logged via console.error (this
  // function's own logs, `supabase functions logs ai-import`, item 5's
  // "owner diagnostic") but the client only ever sees the safe "internal"
  // message.
  try {
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

  const rawBody = await req.text();
  // RESUMABLE JOBS (owner decision 2026-10-13): the next run of a job is
  // requested by the previous run with the service key — the only request
  // this function accepts without a user session, and only for this mode.
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && authHeader === `Bearer ${serviceKey}`) {
    let continueBody: { mode?: string; jobId?: string } = {};
    try {
      continueBody = JSON.parse(rawBody);
    } catch {
      return errorResponse("bad_request", "Request body must be valid JSON.", 400);
    }
    if (continueBody.mode !== "continue_job") return errorResponse("bad_request", "Unsupported request.", 400);
    return await handleJobContinue(continueBody, invocationStartedAt);
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
    // SETTLEMENT READER (owner decision 2026-11-13): every PDF import is a
    // reader job (read_start / read_again / read_answer / read_resume, the
    // file read from Storage via storagePath). A request without a mode is
    // the direct path: one model call over fileBase64 (a photo).
    mode?: string;
    storagePath?: string;
    fileName?: string;
    jobId?: string;
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse("bad_request", "Request body must be valid JSON.", 400);
  }

  if (body.mode === "diagnose") return await handleDiagnose(supabase, userId);
  // The old reader's modes (removed 2026-11-13, commit 6). An app that still
  // sends one gets the same words the app shows for an old job.
  if (OLD_READER_MODES.has(body.mode ?? "")) {
    // A reader job resumed through the old mode name still resumes in the
    // reader (an app bundle from before read_resume existed).
    if ((body.mode === "resume_job" || body.mode === "retry_job") && body.jobId) {
      const { data: withProgress } = await supabase.from("import_jobs").select("progress").eq("id", body.jobId).maybeSingle();
      if (isReaderRow(withProgress?.progress)) return await handleReadResume(supabase, userId, { jobId: body.jobId }, invocationStartedAt);
    }
    return errorResponse("bad_request", OLD_READER_MESSAGE, 410);
  }
  if (body.mode === "read_start") return await handleReadStart(supabase, userId, body as ReaderRequestBody, invocationStartedAt);
  if (body.mode === "read_again") return await handleReadAgain(supabase, userId, body as ReaderRequestBody, invocationStartedAt);
  if (body.mode === "read_answer") return await handleReadAnswer(supabase, userId, body as ReaderRequestBody, invocationStartedAt);
  if (body.mode === "read_resume") return await handleReadResume(supabase, userId, body as ReaderRequestBody, invocationStartedAt);

  const { fileBase64, mediaType, docHint, locale, customCategories, learningRules, carrierCodeMaps } = body;
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
    return errorResponse("oversized", "This file is too large — try splitting it or exporting a smaller version.", 413);
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
    console.error(`[ai-import] daily-count check failed: ${countError.message}`);
    return errorResponse("internal", "Could not check today's import count — your data is safe. Please try again.", 500);
  }
  if ((count ?? 0) >= DAILY_IMPORT_LIMIT) {
    return errorResponse(
      "rate_limited",
      `Daily import limit reached (${DAILY_IMPORT_LIMIT}/day). Try again tomorrow.`,
      429,
    );
  }

  // USAGE LIMITS BY FLEET SIZE + CREDIT PACKS (owner decision 2026-08-24,
  // FIVE ADDITIONS pass, PART 5). A soft limit (80%) is a CLIENT-side quiet
  // notice only (app/src/usage/aiUsage.ts) — this server gate is the hard
  // 100% stop.
  const usageCheck = await checkAiImportUsageAllowed(supabase, userId);
  if (!usageCheck.allowed) {
    await logAiUsage(supabase, userId, false, "usage_limit_reached");
    return errorResponse("usage_limit_reached", usageCheck.message, 429, { used: usageCheck.used, allowance: usageCheck.allowance });
  }

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    console.error("[ai-import] ANTHROPIC_API_KEY not set");
    return errorResponse("internal", "AI reading is temporarily unavailable — your data is safe, and you can still add entries manually.", 500);
  }

  const isImage = mediaType.startsWith("image/");
  const contentBlock = isImage
    ? { type: "image", source: { type: "base64", media_type: mediaType, data: fileBase64 } }
    : { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBase64 } };

  const prompt = buildExtractionPrompt(docHint, locale, customCategories, learningRules, carrierCodeMaps);

  console.log(`[ai-import] request: mediaType=${mediaType} isImage=${isImage}`);
  let result: ExtractOneResult;
  if (isImage) {
    result = await extractOnePass(anthropicKey, contentBlock, prompt, IMAGE_TIMEOUT_MS, MAX_ANTHROPIC_ATTEMPTS);
    // SETTLEMENT READER (owner answer 2026-11-13): a photographed settlement
    // is never a full week. Only its docType goes back; the app says
    // "This photo is not a full settlement. Upload the PDF."
    if (!("errorType" in result) && (result.extraction as { docType?: unknown } | null)?.docType === "settlement") {
      console.log("[ai-import] photo settlement: returning docType only (upload the PDF)");
      result = { extraction: { docType: "settlement" } };
    }
  } else {
    // A PDF sent without a job: ONE call over the whole document.
    result = await extractOnePass(anthropicKey, contentBlock, prompt, SINGLE_CALL_TIMEOUT_MS, MAX_ANTHROPIC_ATTEMPTS);
    console.log(`[ai-import] single-call result: ${"errorType" in result ? result.errorType : "success"}`);
  }

  if ("errorType" in result) {
    // COST CONTROL — LOGGING (owner decision 2026-08-24, FIVE ADDITIONS
    // pass, PART 4 item 1; extended same-day "non-2xx never leaks raw"
    // pass, item 5 — OWNER DIAGNOSTIC): logged with the real message
    // alongside the machine code, but never counted against the monthly
    // allowance (shouldCountAiImportUsage()'s own mirrored rule in
    // app/src/usage/aiUsage.ts — a failed call never counts).
    await logAiUsage(supabase, userId, false, result.errorType, result.message);
    const status =
      result.errorType === "timeout" ? 504 :
      result.errorType === "billing_exhausted" ? 503 :
      result.errorType === "rate_limited" ? 429 :
      result.errorType === "oversized" ? 413 :
      result.errorType === "internal" ? 500 :
      422;
    return errorResponse(result.errorType, result.message, status, result.extra);
  }

  // USAGE LIMITS + LOGGING (owner decision 2026-08-24, FIVE ADDITIONS
  // pass, PARTS 4+5): a successful reading counts once.
  await logAiUsage(supabase, userId, true, null);
  await consumeOneCreditIfOverAllowance(supabase, userId);

  return new Response(
    JSON.stringify({ data: withPdfCreationDate(result.extraction, isImage ? null : pdfCreationDateOf(base64ToBytes(fileBase64))) }),
    { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
  );
  } catch (err) {
    // See the TOP-LEVEL TRY/CATCH comment above — this is what guarantees
    // a real JSON body reaches the client no matter what went wrong,
    // instead of Deno's own non-JSON default error page (the confirmed
    // root cause of the raw "Edge Function returned a non-2xx status
    // code" SDK string leaking through). The full error + stack is always
    // logged here for the owner to review (item 5 — OWNER DIAGNOSTIC,
    // docs/ADMIN_RUNBOOK.md's own recipe for querying it alongside
    // ai_usage_log); the client only ever sees the safe, generic message.
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[ai-import] UNCAUGHT: ${err instanceof Error ? err.message : String(err)}${stack ? `\n${stack}` : ""}`);
    return errorResponse("internal", "Something went wrong on our end — your data is safe. Please try again.", 500);
  }
});
