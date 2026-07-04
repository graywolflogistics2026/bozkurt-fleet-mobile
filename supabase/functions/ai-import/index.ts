// supabase/functions/ai-import/index.ts
//
// Deno Edge Function — receipts/statements/settlements → structured JSON via
// the Anthropic API. ANTHROPIC_API_KEY lives only in this function's
// environment secrets; the mobile app never holds it (CLAUDE.md).
//
// POST body: { fileBase64: string, mediaType: string, docHint?: string }
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
const DOCTYPE_ENUM_AFTER = `docType: settlement|fuel|maintenance|amazon|store|toll|loan|w2|other`;

const APPROVED_ADDITIONS_SUFFIX = `
APPROVED ADDITION (fuel/IFTA, owner decision 2026-07-03): for docType "fuel", also extract the US state as a 2-letter code (e.g. "TX", "OK") into fuel.state, read from the station's address on the receipt. If the state genuinely cannot be determined, leave fuel.state as "".

APPROVED ADDITION (w2, owner decision 2026-07-03 — household tax design): for a W-2 tax form, use docType "w2" (not "other"): {"docType":"w2","date":"","vendor":"","totalAmount":0,"taxDeductible":false,"summary":"","w2":{"employer":"","employeeName":"","taxYear":0,"box1Wages":0,"box2FederalWithheld":0}}. vendor = the employer's name. date = the tax year's Dec 31 (e.g. "2026-12-31") if no other date appears on the form. totalAmount = box1Wages. taxDeductible is always false for a W-2 — it is income, not a business expense.
`;

function buildExtractionPrompt(docHint?: string): string {
  let prompt = LEGACY_EXTRACTION_PROMPT
    .replace(FUEL_SCHEMA_BEFORE, FUEL_SCHEMA_AFTER)
    .replace(DOCTYPE_ENUM_BEFORE, DOCTYPE_ENUM_AFTER);
  prompt += APPROVED_ADDITIONS_SUFFIX;
  if (docHint) {
    prompt += `\nThe user has hinted this document is likely a "${docHint}" — verify against the actual content, but use this as a tiebreaker only if the content is genuinely ambiguous.\n`;
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

  let body: { fileBase64?: string; mediaType?: string; docHint?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("bad_request", "Request body must be valid JSON.", 400);
  }

  const { fileBase64, mediaType, docHint } = body;
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

  const prompt = buildExtractionPrompt(docHint);

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
