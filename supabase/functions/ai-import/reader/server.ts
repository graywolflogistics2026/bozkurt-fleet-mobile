// THE SETTLEMENT READER, SERVER SIDE (owner decision 2026-11-13). The
// effects only: the Anthropic call, the PDF page subset, the job row writes
// (lease-checked), the heartbeat. Every decision (range, the one content
// read, the gate, the four states, attachments) is the app's pure code,
// bundled into ./core.gen.js (app/src/settlementReader, `npm run
// build:reader`) and tested there with simulated replies.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import * as core from "./core.gen.js";

type Admin = ReturnType<typeof createClient>;
type ModelError = "timeout" | "max_tokens" | "refusal" | "unreadable_reply" | "busy" | "api_error";
type Outcome = { ok: true; value: unknown } | { ok: false; error: ModelError; detail?: string };
export type ModelReply = { outcome: Outcome; usage: Record<string, number> | null; ms: number };
type ModelRequest = {
  role: string;
  model: string;
  effort: "low" | "medium";
  pages: number[];
  system: string;
  userText: string;
  schema: Record<string, unknown>;
  timeoutMs: number;
  maxTokens: number;
};
export type PromptInputs = {
  docHint?: string;
  locale?: string;
  customCategories?: string[];
  learningRules?: { keyword: string; category: string }[];
  carrierCodeMaps?: { carrier: string; code: string; subCode: string | null; label: string; description: string | null }[];
};
// import_jobs.progress of a reader job.
export type ReaderRowProgress = { reader: Record<string, unknown> & { v: number; state: string }; inputs?: PromptInputs };

export type ReaderKit = {
  limits: { exitByMs: number; callEndLimitMs: number; startMarginMs: number; wallClockMs: number };
  anthropicKey: string | undefined;
  getCooldownMs(): Promise<number>;
  setCooldown(seconds: number, reason: string): Promise<void>;
  // The general (non-settlement / photo) reader: the existing extraction
  // prompt on the whole file, one call.
  general(input: { bytes: Uint8Array; mediaType: string; inputs: PromptInputs; timeoutMs: number }): Promise<ModelReply>;
  logImport(admin: Admin, userId: string, success: boolean, reason?: string): Promise<void>;
  startNextRun(jobId: string): Promise<void>;
  download(admin: Admin, storagePath: string): Promise<Uint8Array | null>;
  scrub<T>(value: T): T;
  pdfCreationDate(bytes: Uint8Array): string | null;
};

const MAX_ATTEMPTS = 3;
const HEARTBEAT_EVERY_MS = 20_000;
const backoff = (attempt: number) => 800 * 2 ** (attempt - 1);

export function isReaderRow(progress: unknown): progress is ReaderRowProgress {
  return !!progress && typeof progress === "object" && core.isReaderProgress((progress as { reader?: unknown }).reader);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// The pages of the original PDF a call sends, as one PDF, in page order.
class PdfPages {
  private doc: PDFDocument | null = null;
  constructor(private readonly bytes: Uint8Array) {}
  async subset(pages: number[]): Promise<string> {
    if (!this.doc) this.doc = await PDFDocument.load(this.bytes, { ignoreEncryption: true });
    const out = await PDFDocument.create();
    const copied = await out.copyPages(this.doc, pages.map((p) => p - 1));
    copied.forEach((page) => out.addPage(page));
    return bytesToBase64(await out.save());
  }
}

function parseJson(text: string): unknown | null {
  for (const attempt of [
    (t: string) => JSON.parse(t),
    (t: string) => JSON.parse(t.replace(/```json|```/g, "").trim()),
    (t: string) => {
      const m = t.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("no json");
      return JSON.parse(m[0]);
    },
  ]) {
    try {
      return attempt(text);
    } catch {
      // next
    }
  }
  return null;
}

// One reader call: structured output (json_schema), adaptive thinking at
// the role's effort, the PDF block cached (a second read of the same pages
// within 5 minutes reads it from the cache). A schema the API refuses is
// retried once with the schema in the text; 5xx/network errors up to 3
// attempts with doubling backoff; a timeout is never retried here (the
// machine decides: split or read again).
async function callModel(kit: ReaderKit, pdf: PdfPages, req: ModelRequest): Promise<ModelReply> {
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  const fail = (error: ModelError, detail?: string): ModelReply => ({ outcome: { ok: false, error, ...(detail ? { detail: detail.slice(0, 300) } : {}) }, usage: null, ms: ms() });
  if (!kit.anthropicKey) return fail("api_error", "ANTHROPIC_API_KEY not set");
  const cooldown = await kit.getCooldownMs();
  if (cooldown > 0) return fail("busy", `rate-limit cooldown ${Math.ceil(cooldown / 1000)}s`);
  let data: string;
  try {
    data = await pdf.subset(req.pages);
  } catch (err) {
    return fail("api_error", `pdf subset failed: ${(err as Error).message}`);
  }
  let withSchema = true;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, req.timeoutMs - ms()));
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": kit.anthropicKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: req.model,
          max_tokens: req.maxTokens,
          thinking: { type: "adaptive" },
          output_config: { effort: req.effort, ...(withSchema ? { format: { type: "json_schema", schema: req.schema } } : {}) },
          system: [{ type: "text", text: req.system }],
          messages: [
            {
              role: "user",
              content: [
                { type: "document", source: { type: "base64", media_type: "application/pdf", data }, cache_control: { type: "ephemeral" } },
                { type: "text", text: withSchema ? req.userText : `${req.userText}\n\nReply with ONLY one JSON object that matches this JSON schema:\n${JSON.stringify(req.schema)}` },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.error(`[ai-import] reader ${req.role}: HTTP ${resp.status}: ${text.slice(0, 500)}`);
        if (resp.status === 400 && withSchema && /schema|output_config|format/i.test(text)) {
          withSchema = false;
          attempt--;
          continue;
        }
        if (resp.status === 429) {
          const retryAfter = Number(resp.headers.get("retry-after"));
          await kit.setCooldown(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 30, `reader HTTP 429`);
          return fail("busy", "HTTP 429");
        }
        if (resp.status >= 500 && attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, backoff(attempt)));
          continue;
        }
        return fail(resp.status === 529 ? "busy" : "api_error", `HTTP ${resp.status}`);
      }
      const body = await resp.json();
      const usage = (body.usage ?? null) as Record<string, number> | null;
      if (body.stop_reason === "refusal") return { outcome: { ok: false, error: "refusal" }, usage, ms: ms() };
      if (body.stop_reason === "max_tokens") return { outcome: { ok: false, error: "max_tokens" }, usage, ms: ms() };
      const text = (body.content ?? []).filter((c: { type?: string }) => c.type === "text").map((c: { text?: string }) => c.text ?? "").join("");
      const parsed = parseJson(text);
      if (parsed == null || typeof parsed !== "object") return { outcome: { ok: false, error: "unreadable_reply", detail: kit.scrub(text.slice(0, 300)) }, usage, ms: ms() };
      return { outcome: { ok: true, value: parsed }, usage, ms: ms() };
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") return fail("timeout", `over ${Math.round(req.timeoutMs / 1000)}s`);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, backoff(attempt)));
        continue;
      }
      return fail("api_error", (err as Error).message);
    }
  }
  return fail("api_error", "no attempt made");
}

// One server run of reader job `jobId`: claim the lease, run the reader
// until the job is final or this run's time is up, release.
export async function runReaderJob(admin: Admin, jobId: string, invocationStartedAt: number, kit: ReaderKit, preloaded?: Uint8Array): Promise<void> {
  const owner = crypto.randomUUID();
  const leaseSeconds = Math.ceil((kit.limits.wallClockMs + 5_000) / 1000);
  const { data: claimed, error: claimError } = await admin.rpc("import_job_claim", { p_job_id: jobId, p_owner: owner, p_lease_seconds: leaseSeconds });
  if (claimError || claimed !== true) {
    console.log(`[ai-import] reader ${jobId}: not claimed (${claimError?.message ?? "another run owns it"})`);
    return;
  }
  const release = async () => {
    const { error } = await admin.rpc("import_job_release", { p_job_id: jobId, p_owner: owner });
    if (error) console.error(`[ai-import] reader ${jobId}: release failed: ${error.message}`);
  };
  const heartbeat = setInterval(() => {
    admin.from("import_jobs").update({ heartbeat_at: new Date().toISOString() }).eq("id", jobId).eq("lease_owner", owner).then(() => {}, () => {});
  }, HEARTBEAT_EVERY_MS);
  try {
    const { data: row, error } = await admin
      .from("import_jobs")
      .select("id, user_id, status, progress, result_json, storage_path, media_type, document_id")
      .eq("id", jobId)
      .maybeSingle();
    if (error || !row || !isReaderRow(row.progress)) {
      console.error(`[ai-import] reader ${jobId}: not a reader job (${error?.message ?? "no reader progress"})`);
      return;
    }
    const userId = row.user_id as string;
    const inputs = (row.progress as ReaderRowProgress).inputs ?? {};
    const mediaType = row.media_type as string;
    const write = async (fields: Record<string, unknown>, extraction: unknown | undefined): Promise<boolean> => {
      const now = new Date().toISOString();
      const { data, error: e } = await admin
        .from("import_jobs")
        .update({ ...fields, heartbeat_at: now, updated_at: now })
        .eq("id", jobId)
        .eq("lease_owner", owner)
        .select("id");
      if (e) console.error(`[ai-import] reader ${jobId}: save failed: ${e.message}`);
      if (e || (data ?? []).length === 0) return false;
      // The reading goes to result_json only while the week is not saved.
      if (extraction !== undefined) {
        await admin.from("import_jobs").update({ result_json: kit.scrub(extraction) }).eq("id", jobId).eq("lease_owner", owner).is("document_id", null);
      }
      return true;
    };
    const bytes = preloaded ?? (await kit.download(admin, row.storage_path as string));
    if (!bytes) {
      const p = (row.progress as ReaderRowProgress).reader;
      await write({ status: "failed", error_step: "model_failed", completed_at: new Date().toISOString(), progress: { reader: { ...p, state: "failed", step: "done", failure: { reason: "model_failed", error: "api_error" } }, inputs } }, undefined);
      await kit.logImport(admin, userId, false, "the stored file could not be read");
      return;
    }
    const created = mediaType.startsWith("image/") ? null : kit.pdfCreationDate(bytes);
    const pdf = new PdfPages(bytes);
    const result = await core.runReader(
      { progress: (row.progress as ReaderRowProgress).reader, extraction: (row.result_json ?? null) },
      {
        limits: kit.limits,
        elapsedMs: () => performance.now() - invocationStartedAt,
        call: (req: ModelRequest) => callModel(kit, pdf, req),
        general: (timeoutMs: number) => kit.general({ bytes, mediaType, inputs, timeoutMs }),
        save: ({ progress, status, extraction, final }: { progress: Record<string, unknown> & { failure?: { reason?: string } | null }; status: string; extraction?: Record<string, unknown> | null; final?: boolean }) => {
          const withDate = extraction && created && extraction.docType === "settlement" ? { ...extraction, pdfCreationDate: created } : extraction;
          return write(
            {
              status,
              progress: { reader: progress, inputs },
              error_step: progress.failure?.reason ?? null,
              error_message: null,
              ...(final ? { completed_at: new Date().toISOString() } : {}),
            },
            withDate ?? undefined,
          );
        },
        logImport: (success: boolean, reason?: string) => kit.logImport(admin, userId, success, reason),
        continueInNextRun: async () => {
          await release();
          await kit.startNextRun(jobId);
        },
        log: (message: string) => console.log(`[ai-import] reader ${jobId}: ${kit.scrub(message)}`),
      },
    );
    console.log(`[ai-import] reader ${jobId}: run ended (${result.kind}, ${result.calls} call(s), ${Math.round(performance.now() - invocationStartedAt)}ms)`);
  } catch (err) {
    console.error(`[ai-import] reader ${jobId}: run threw: ${(err as Error).message}`);
  } finally {
    clearInterval(heartbeat);
    await release();
  }
}
