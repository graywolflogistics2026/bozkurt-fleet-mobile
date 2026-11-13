# Settlement reader, rewritten (owner decision 2026-11-13)

Approved 2026-11-13. Supersedes the page-by-page job reader
(`settlement-import-chunking.md` page merge, re-read rules, app verdict
runner). Spec: `settlement-data-contract.md`,
`prime-statement-template.md`, `prime-code-classes.md`,
`printed-dates-and-held.md`.

## Principles
- **P1. One read, no merging.**
  - The content pages go as ONE PDF subset in ONE `claude-opus-5-5`
    call (json_schema output, adaptive thinking, effort medium):
    - normally page 1 to the page with TOTAL CASH FLOW;
    - when no cash-flow section is printed, page 1 to the page with
      TOTAL STATEMENT OF INCOME & EXPENSE.
  - Only on a timeout or max_tokens stop, two calls are made instead
    (settlement pages, statement pages). Their two parts have disjoint
    keys, so they are combined by label only.
- **P2. The model copies, the app decides.**
  - Dates come back as printed text.
  - Statement rows are `{label, weeks, ytd, ltd}`.
  - Settlement lines are `{code, description, reference, amount,
    direction}`.
  - The model does no arithmetic and assigns no sections or categories.
    The app maps a row to its block by the Prime template label, else by
    the next TOTAL line.
- **P3. The gate checks the printed totals** (identities in the data
  contract). Line sums never block.
- **P4. Four job states, decided and persisted by the server:**
  `reading`, `ready`, `needs_input`, `failed`.
  - At most 2 content reads per job. "Read again" counts toward them.
  - An identical second read stops at once.
- **P5. Attachments** (pages after the content range) are read after the
  card is ready, by `claude-haiku-5-5`, one page per call, max 12, best
  effort, never gating.
- **P6/P7.** The save gate, certify, re-import and every screen are
  unchanged.

## Owner answers (2026-11-13)
1. `settlement-data-contract.md` is written from the code; no code change.
2. 08/28 uses the real printed figures (13-week workbook fixture).
3. A photographed settlement (the direct, non-PDF path) returns only
   `{"docType":"settlement"}`. The app then shows "This photo is not a
   full settlement. Upload the PDF."
4. The "read line details again" button is removed; only the note stays.
   [Read again] re-reads the content range and counts toward the max 2.
5. The old reader stays in the repo as the fallback until the owner
   confirms the device test. Only then does the deletion commit go in.

## Where the code lives
- `app/src/settlementReader/`, pure TypeScript, Jest-tested:
  - schema and prompts;
  - `toExtraction` (copy → contract);
  - range;
  - decision / state machine;
  - cost.

  It is bundled together with the gate (`settlementGate.ts` and its 34
  pure modules) by esbuild into
  `supabase/functions/ai-import/reader/core.gen.js`. That bundle is
  generated and committed; a Jest test fails when it is stale. So the
  server runs the SAME gate as the app, with no second copy.
- `supabase/functions/ai-import/reader/`, Deno I/O only:
  - storage;
  - PDF subset;
  - the Anthropic call;
  - persistence;
  - chaining runs inside the plan budget (`limitsForPlan`).

## Server modes (ai-import, commit 4)
- `read_start` — a new import. Same limits as every import. A PDF starts
  with the range call. A photo goes straight to the general reader; a
  settlement photo fails with `photo_settlement` ("upload the PDF") and a
  result of only `{docType: "settlement"}`.
- `read_again` — a failed job, only while reads remain (max 2 per job).
- `read_answer` — the owner's typed profit lines (needs_input). No model
  call; the gate decides again.
- `read_resume` — the app's backup restart of a stopped reading job
  (a stale lease is released). The old `resume_job` sends a reader job here.
- `continue_job` (service key) — a reader job continues in the reader.

The run loop is `app/src/settlementReader/driver.ts` (pure, tested with
simulated replies): it saves after every model call, counts a read before
its call, starts a call only when its minimum timeout still fits the plan
budget, and continues in the next run otherwise (max 12 runs). Every
reader call: structured output, adaptive thinking at the role's effort,
the PDF block cached. A non-settlement PDF goes to the existing general
extraction prompt, on the whole file, in one call.

The old reader (modes `job`, `reread_job`, `job_verdict`, ...) stays as the
fallback until the owner confirms the device test (then commit 6).

## Job row (no SQL)
| Reader state | `import_jobs.status` |
|---|---|
| reading | `queued` / `processing` |
| ready | `ready` |
| needs_input | `needs_decision` |
| failed | `failed` |

- `progress.reader` (jsonb) holds:
  - version 2;
  - step;
  - range;
  - reads, each with its result signature;
  - failure (reason, check, printed, read);
  - questions;
  - attachments done/total;
  - cost per role (model, tokens, dollar estimate).
- `result_json` holds the contract `Extraction`.
- A job without `progress.reader.v === 2` is an old-reader job. The app
  shows it as failed with [Read again].

## Cost
Logged per call in `progress.reader.cost` and the function log:
- the roles are range (haiku), content (opus) and attachment (haiku);
- per call: tokens in and out, cache read and cache write, and a dollar
  estimate from the price table in `cost.ts`.

`ai_usage_log` keeps one row per import, as before.
