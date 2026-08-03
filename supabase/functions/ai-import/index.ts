// supabase/functions/ai-import/index.ts
//
// Deno Edge Function — receipts/statements/settlements → structured JSON via
// the Anthropic API. ANTHROPIC_API_KEY lives only in this function's
// environment secrets; the mobile app never holds it (CLAUDE.md).
//
// POST body: { fileBase64: string, mediaType: string, docHint?: string, locale?: string, customCategories?: string[], pageRangeStart?: number, priorPageExtractions?: unknown[] }
// pageRangeStart/priorPageExtractions (owner decision 2026-08-03, round 3
// continuation protocol) are set by the CLIENT on every call after the
// first one for a long multi-page PDF — see the PAGE-BUDGET comment
// below for the full reasoning. A response may include `nextPageStart` +
// `rawPageExtractions`, meaning: call again with those two values to
// keep going.
// Auth: Supabase JWT in the Authorization header (required).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import {
  buildChunkPromptAddendum,
  mergeSequentialPageResults,
  type ChunkExtraction,
  type PageAttemptResult,
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

// TIMEOUT/PAGE-BUDGET, ROUND 3 (owner decision 2026-08-03, device
// evidence: round 2's 3-page cap DID fix the timeout — "pages 1-3 of 11"
// came back correctly — but a real 11-page settlement's deduction LINE
// ITEMS live beyond page 3 (revenue/header is early; the full deduction
// breakdown, recap, and operating statement come later on a long
// statement). Capping at 3 pages silently produced Net Pay $0.00 /
// Deductions $0.00 while the AI's OWN summary text said "Total
// deductions from truck: $4,637.15" — i.e. gross income with zero
// recorded expenses. Saving that would be a real tax-accuracy bug, not
// just an incomplete import. There is NO fixed page count that's safe to
// assume covers every settlement's financial sections — the cap itself
// was the bug, not its size.
//
// FIX: no more page cap. A multi-page PDF is now processed across AS
// MANY PAGES AS IT HAS, via a CLIENT-DRIVEN CONTINUATION protocol
// instead of trying to do it all in one Edge Function invocation (which
// the 150s Supabase wall-clock ceiling — verified in the round-1 pass —
// makes impossible for a genuinely long document at a reliable per-page
// budget). Each invocation processes one small, safe BATCH of
// PAGES_PER_BATCH(3) pages sequentially (never in parallel — same
// contention finding as round 2) and, if there's more document left AND
// the batch fully succeeded, returns `nextPageStart` + the raw per-page
// extractions gathered SO FAR (`rawPageExtractions`) instead of a
// terminal result. The client (aiImportCall.ts) loops: sees
// `nextPageStart`, calls this function AGAIN passing `pageRangeStart`
// and the accumulated `priorPageExtractions` it was just handed back,
// and keeps going — sequentially, one invocation at a time, never
// parallel — until the whole document is covered or a page genuinely
// fails. The merge logic itself never moves off the server (still
// chunking.ts's pure, tested functions) — the client's only job is to
// store and resend the raw array between calls, never to re-implement
// any merge semantics itself.
//
// Budget math per INVOCATION against Supabase's VERIFIED 150s wall-clock
// ceiling (https://supabase.com/docs/guides/functions/limits — the
// "400s" figure is for `EdgeRuntime.waitUntil()` background work, which
// this function never uses) is UNCHANGED from round 2, since each batch
// is its own fresh invocation: PAGES_PER_BATCH(3) ×
// SEQUENTIAL_PAGE_TIMEOUT_MS(40s), each with the same 5xx-only retry
// headroom (~41s worst case per page) ≈ 123s for a full batch, leaving
// ~25s margin per invocation regardless of how many total batches a
// long document needs — the platform ceiling is never at risk no matter
// how many pages a settlement has, because no single invocation ever
// tries to cover more than PAGES_PER_BATCH pages.
const IMAGE_TIMEOUT_MS = 90_000;
const SINGLE_CALL_TIMEOUT_MS = 90_000;
const SEQUENTIAL_PAGE_TIMEOUT_MS = 40_000;
const PAGES_PER_BATCH = 3;
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

function buildExtractionPrompt(docHint?: string, locale?: string, customCategories?: string[]): string {
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
  | "timeout";

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

type PageBatchResult = {
  newExtractions: ChunkExtraction[];
  failure: { errorType: ErrorType; message: string; extra?: Record<string, unknown> } | null;
  lastAttemptedPage: number;
};

// SEQUENTIAL, NOT PARALLEL, ONE BATCH (owner decision 2026-08-03, round 3
// — see the budget comment block near the top of this file for why this
// no longer tries to cover a whole long document in one invocation).
// Processes pages `startPage..min(startPage+batchSize-1, totalPages)` ONE
// AT A TIME, in order, STOPPING at the first page that fails — a later
// page's own slow/failed call never wastes time or shares rate-limit/
// contention risk with an earlier one. Every chunk pdf-lib produces
// really is cropped to just that one page (confirmed by reading
// splitPdfIntoChunks — this was never sending the whole document per
// call, in any pass). Returns only THIS batch's own new successes plus
// whatever failure stopped it (if any) — merging with previously-
// gathered pages from earlier batches happens in the caller (Deno.serve
// handler), via chunking.ts's existing mergeSequentialPageResults.
async function extractPageBatch(
  anthropicKey: string,
  fileBase64: string,
  totalPages: number,
  startPage: number,
  batchSize: number,
  basePrompt: string,
): Promise<PageBatchResult> {
  const endPage = Math.min(startPage + batchSize - 1, totalPages);
  const newExtractions: ChunkExtraction[] = [];
  let failure: PageBatchResult["failure"] = null;
  let lastAttemptedPage = startPage - 1;

  for (let page = startPage; page <= endPage; page++) {
    lastAttemptedPage = page;
    const range: PageRange = { start: page, end: page };
    const [chunkB64] = await splitPdfIntoChunks(fileBase64, [range]);
    const contentBlock = { type: "document", source: { type: "base64", media_type: "application/pdf", data: chunkB64 } };
    const chunkPrompt = basePrompt + buildChunkPromptAddendum(range, totalPages);
    const result = await extractOnePass(anthropicKey, contentBlock, chunkPrompt, SEQUENTIAL_PAGE_TIMEOUT_MS, MAX_ANTHROPIC_ATTEMPTS);
    if ("errorType" in result) {
      failure = result;
      break; // sequential: never attempt a later page once one has failed
    }
    newExtractions.push(result.extraction as ChunkExtraction);
  }

  return { newExtractions, failure, lastAttemptedPage };
}

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

  let body: {
    fileBase64?: string;
    mediaType?: string;
    docHint?: string;
    locale?: string;
    customCategories?: string[];
    // CONTINUATION PROTOCOL (owner decision 2026-08-03, round 3): set by
    // the client on every call AFTER the first one for a long PDF — see
    // the PAGE-BUDGET comment block near the top of this file. Absent/1
    // on the initial call.
    pageRangeStart?: number;
    // Raw per-page extractions already gathered from EARLIER invocations
    // (in page order) — this function never persists state between
    // invocations itself, so the client hands it back every time.
    priorPageExtractions?: unknown[];
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse("bad_request", "Request body must be valid JSON.", 400);
  }

  const { fileBase64, mediaType, docHint, locale, customCategories, priorPageExtractions } = body;
  const pageRangeStart = body.pageRangeStart ?? 1;
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

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    return errorResponse("anthropic_error", "Server misconfigured: ANTHROPIC_API_KEY not set.", 500);
  }

  const isImage = mediaType.startsWith("image/");
  const contentBlock = isImage
    ? { type: "image", source: { type: "base64", media_type: mediaType, data: fileBase64 } }
    : { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBase64 } };

  const prompt = buildExtractionPrompt(docHint, locale, customCategories);

  // CONTINUATION ORCHESTRATION (owner decision 2026-08-03, round 3 — see
  // the budget comment block near the top of this file for the full
  // root-cause reasoning): no more fixed page cap. Every response that
  // doesn't cover the whole document either carries `nextPageStart` (the
  // client must call again to keep going) or `pagesProcessed` (a genuine
  // stopping point — total success or an unrecoverable failure).
  let pagesProcessed: { through: number; total: number } | null = null;
  let nextPageStart: number | null = null;
  let rawPageExtractions: unknown[] | null = null;
  let result: ExtractOneResult;

  if (isImage) {
    result = await extractOnePass(anthropicKey, contentBlock, prompt, IMAGE_TIMEOUT_MS, MAX_ANTHROPIC_ATTEMPTS);
  } else {
    const rawPageCount = await getPdfPageCount(fileBase64);

    if (rawPageCount === null) {
      // Can't determine a page count at all — page-batching isn't
      // possible, send the whole original file as one call, exactly as
      // if this feature didn't exist (chunking is purely additive).
      result = await extractOnePass(anthropicKey, contentBlock, prompt, SINGLE_CALL_TIMEOUT_MS, MAX_ANTHROPIC_ATTEMPTS);
    } else if (pageRangeStart === 1 && rawPageCount <= PAGES_PER_BATCH) {
      // Whole document already fits in one batch — no cropping needed.
      result = await extractOnePass(anthropicKey, contentBlock, prompt, SINGLE_CALL_TIMEOUT_MS, MAX_ANTHROPIC_ATTEMPTS);
    } else {
      // MAX_TOTAL_PAGES is a defensive-only ceiling (see its own comment
      // above) — the user-facing `total` below always reports the REAL
      // page count, even on the rare document long enough to hit it.
      const clampedTotal = Math.min(rawPageCount, MAX_TOTAL_PAGES);
      const batch = await extractPageBatch(anthropicKey, fileBase64, clampedTotal, pageRangeStart, PAGES_PER_BATCH, prompt);
      const allExtractions = [...(priorPageExtractions ?? []), ...batch.newExtractions] as ChunkExtraction[];
      const attemptResults: PageAttemptResult[] = allExtractions.map((e) => ({ success: true, extraction: e }));
      if (batch.failure) attemptResults.push({ success: false });

      const merged = mergeSequentialPageResults(attemptResults, clampedTotal);
      if (!merged) {
        // The very first page of this batch failed — nothing (from this
        // batch OR any prior one, though prior batches always succeed by
        // construction or the client wouldn't have continued) to save.
        result = batch.failure ?? { errorType: "anthropic_error", message: `Could not process page ${pageRangeStart} of this document.` };
      } else {
        result = { extraction: merged.extraction };
        const batchFullySucceeded = !batch.failure && batch.lastAttemptedPage === Math.min(pageRangeStart + PAGES_PER_BATCH - 1, clampedTotal);
        if (batchFullySucceeded && merged.processedThrough < clampedTotal) {
          // More document left and nothing went wrong yet — tell the
          // client to keep going, carrying forward every page gathered
          // so far (this batch's own new successes plus every earlier
          // batch's).
          nextPageStart = merged.processedThrough + 1;
          rawPageExtractions = allExtractions;
        } else if (merged.truncated || clampedTotal < rawPageCount) {
          // Either a page failed partway (batch.failure set), or we hit
          // MAX_TOTAL_PAGES (merged.truncated alone wouldn't catch this —
          // it's computed against clampedTotal, not the real page count)
          // — either way, this is where we stop; report exactly how much
          // of the REAL document was actually covered.
          pagesProcessed = { through: merged.processedThrough, total: rawPageCount };
        }
      }
    }
  }

  if ("errorType" in result) {
    const status = result.errorType === "timeout" ? 504 : result.errorType === "anthropic_error" ? 502 : 422;
    return errorResponse(result.errorType, result.message, status, result.extra);
  }

  return new Response(
    JSON.stringify({
      data: result.extraction,
      ...(pagesProcessed ? { pagesProcessed } : {}),
      ...(nextPageStart ? { nextPageStart, rawPageExtractions } : {}),
    }),
    { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
  );
});
