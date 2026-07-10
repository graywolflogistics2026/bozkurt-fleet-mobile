// supabase/functions/ai-advisor/index.ts
//
// Deno Edge Function — proxies the AI Advisor chat. Ported from legacy
// aiCtx()/sendAI() (legacy/index.html, "AI ADVISOR" section): a short system
// prompt built from the user's own revenue/deductions/miles, plus a rolling
// message history, max 150-word replies. ANTHROPIC_API_KEY stays server-side
// (CLAUDE.md) — the mobile app only ever sends conversation history here.
//
// POST body: { messages: { role: "user" | "assistant"; content: string }[], locale?: string }
// Auth: Supabase JWT in the Authorization header (required).
//
// locale (owner decision 2026-07-10, PRODUCT DECISION — personalization &
// onboarding package, item 4 "AI in user's language"): groundwork only —
// no app screen calls this function yet (PROMPTS.md Session 9b "AI
// Advisor"), but the Edge Function itself accepts and honors locale now so
// that screen just has to pass profile.locale/i18n.language when it's
// built, with no further server-side work.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_MAX_TOKENS = 400; // matches legacy sendAI()
const HISTORY_WINDOW = 6; // matches legacy aiHist.slice(-6)

type ErrorType = "unauthenticated" | "bad_request" | "anthropic_error";

// Matches app/src/i18n's SUPPORTED_LOCALES (see ai-import's identical map
// and comment for why a language NAME, not a bare locale code, is used).
const LOCALE_LANGUAGE_NAME: Record<string, string> = {
  es: "Spanish",
  ru: "Russian",
  ar: "Arabic",
  tr: "Turkish",
  hi: "Hindi",
  uk: "Ukrainian",
};

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

  let body: { messages?: { role: string; content: string }[]; locale?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("bad_request", "Request body must be valid JSON.", 400);
  }

  const messages = body.messages;
  const locale = body.locale;
  if (!Array.isArray(messages) || messages.length === 0) {
    return errorResponse("bad_request", "messages must be a non-empty array.", 400);
  }

  // System prompt: ported from legacy aiCtx() — figures pulled live from
  // this user's own data (settlements + deductions), not the fixed
  // Graywolf/Unit-830157 sample copy baked into the legacy single-user app.
  const [{ data: profile }, { data: settlements }, { data: deductions }] = await Promise.all([
    supabase.from("profiles").select("company_name, owner_name").eq("user_id", userId).maybeSingle(),
    supabase.from("settlements").select("gross, miles").eq("user_id", userId),
    supabase.from("deductions").select("amount").eq("user_id", userId),
  ]);

  const rev = (settlements ?? []).reduce((a, x) => a + (x.gross ?? 0), 0);
  const ded = (deductions ?? []).reduce((a, x) => a + (x.amount ?? 0), 0);
  const miles = (settlements ?? []).reduce((a, x) => a + (x.miles ?? 0), 0);
  const settlementCount = (settlements ?? []).length;
  const ownerLabel = profile?.owner_name || "the owner-operator";
  const companyLabel = profile?.company_name || "this fleet";

  const languageName = locale ? LOCALE_LANGUAGE_NAME[locale] : undefined;
  const languageInstruction = languageName
    ? ` Respond in ${languageName} — the user's chosen app language. Standard financial/trucking terms may stay in English when there's no natural equivalent (e.g. "per diem", "ELD", "IFTA").`
    : "";

  const systemPrompt =
    `You are the AI business advisor for ${ownerLabel}, owner-operator of ${companyLabel}.\n` +
    `Revenue: $${rev.toFixed(2)} | Deductions: $${ded.toFixed(2)} | Net: $${(rev - ded).toFixed(2)}\n` +
    `Miles: ${miles.toLocaleString()} | Settlements: ${settlementCount}\n` +
    `Give specific, actionable trucking advice. Max 150 words.${languageInstruction}`;

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    return errorResponse("anthropic_error", "Server misconfigured: ANTHROPIC_API_KEY not set.", 500);
  }

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
        system: systemPrompt,
        messages: messages.slice(-HISTORY_WINDOW),
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

  const answer = (data.content ?? []).map((c: { text?: string }) => c.text ?? "").join("");

  return new Response(JSON.stringify({ answer }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
