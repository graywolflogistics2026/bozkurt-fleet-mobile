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
- `read_start` — a new import. Same limits as every import. PDFs only;
  it starts with the range call. A photo stays on the direct path (one
  call); when that call says settlement, the reply is only
  `{docType: "settlement"}` and the app says "This photo is not a full
  settlement. Upload the PDF." (commit 5).
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

The old reader (modes `job`, `reread_job`, `job_verdict`, ...) stayed as the
fallback until the owner confirmed the device test (2026-11-13: 18 weeks
imported with the new reader; Settlements 18, Capital Account and Home
Yearly match). Commit 6 then deleted it — see "Commit 6" below.

## The app (commit 5)
- `app/src/import/readerJob.ts` (pure, tested) turns the row into what the
  owner sees: Reading ("Reading again (2 of 2)" on the second read) /
  Ready to check (ready AND needs_input) / Could not read.
- Could not read lists the reason, the failing check with its printed and
  read values, the model's error, and "read twice with the same result"
  when that stopped it. [Read again] only while reads < 2; [Send report]
  carries the reader lines (state, reads, reason, cost per role).
- needs_input: the card asks the profit lines; they go to the server
  (`read_answer`), whose gate decides again.
- The chip, jobs list, notifications and auto-resume (`read_resume` after
  3 minutes without a heartbeat) read the same state. The app's verdict
  runner is not mounted any more.
- Old-reader jobs: failed with [Read again], which starts a new reader job
  from the stored file (PDFs) and removes the old row.
- Settlement detail keeps only the notes ("read line details again" and
  the attachments "Read" link started old-reader jobs; removed).
- Known difference: attachment pages still being read when the owner
  certifies are not kept (`import_job_saved` deletes the reader row).
- Diagnostics: "Settlement reader (last 5)".

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

## Commit 6: the old reader deleted (2026-11-13)
- Server: `chunking.ts` deleted (its one live function, the statement
  columns normalizer used by `extractOnePass()`, moved to
  `statementColumns.ts`); `jobEngine.ts` keeps only the plan-aware limits,
  the stale-lease rule and `checkImportLimits()`; `index.ts` lost the old
  modes, the page classifier, the per-page runs and the direct-path
  page-by-page continuation (a PDF sent without a job is one call).
- Old modes (`job`, `retry_job`, `resume_job`, `answer_job`, `read_pages`,
  `reread_job`, `job_verdict`) answer 410 with "This file was read by the
  old reader. Read it again with the new reader." A reader job resumed
  through `resume_job` still resumes in the reader. `continue_job` never
  runs an old row again.
- App: the old mode calls, `jobVerdictRunner.ts`, `jobVerdict.ts` and the
  import screen's own re-read flow are gone. Old `import_jobs` rows still
  show failed with [Read again] (`readerJob.ts` `old_reader`,
  `restartWithReader()`); the chip never resumes or answers them.
- Kept on purpose: `src/import/importJobs.ts` row helpers (old rows are
  still listed and counted), Diagnostics' old-row lines, and the client
  continuation loop in `aiImportCall.ts` (the server no longer sends
  `nextOrderIndex`, so it ends after one call).
