# Statement reading plan, three steps (owner, 2026-10-31)

Saved verbatim so "continue the statement reading plan" resumes after a
/clear. Progress is tracked at the end of this file.

```
STATEMENT READING, THREE STEPS (A, B, C), ONE PASTE. Goal: a statement
imports reliably and correctly, or fails cleanly. Speed and cost do not
matter; reliability does. Nothing else is in scope.

PROTOCOL
- git status and git log first. Save this whole message as
  docs/decisions/statement-reading-2026-10.md and commit it (docs only)
  so "continue the statement reading plan" resumes after a /clear.
- ONE step at a time. After EACH step: tsc, tests, commit, push, then
  STOP and write ONE final message in simple Turkish (I am not a
  developer), at most 25 lines: what changed; the ship list in this
  order (SQL with a read-only check query, Edge Function redeploy from
  the repo root, then eas update from app) with the real paths (repo
  root C:\Users\Latitude 5520\Downloads\bozkurt-fleet-mobile-starter\
  bozkurt-fleet-mobile); five things to test on the tablet; what could
  NOT be verified. Wait for me to write "next". Never run eas update
  yourself.
- CLAUDE.md working rules apply. Locale strings use proper Turkish
  characters; this prompt is ASCII because of the terminal.

CONTEXT: server logs show import jobs ending "done" (6-9 calls, all 200,
claude-sonnet-4-6, three parse_failed, the same job read twice) while
the app refused results. Change 1 (0e3ea7a: one ready rule, no dead
end) is already pushed. Golden answers: week ending 2026-08-21: net due
1,884.36, deposited 1,884.73, profit 2,534.36, miles 2,327 (8 pages);
week ending 2026-08-14: net due 4,276.08, deposited 3,072.57, profit
4,987.74, miles 3,316 (17 pages).

STEP A: SYSTEM CHECK, LIVE MODEL CHECK, SEND REPORT. Do not touch the
import logic.
1. Settings, Diagnostics: app version, runtime, update id and channel,
   scanner module present, build stamp.
2. New ai-import mode "diagnose" (authenticated, scoped to the caller,
   booleans, names and counts only, NEVER secret values or bank
   digits): server build id; AI_IMPORT_SUPABASE_PLAN as free or pro and
   the budget in use; every table and column the code needs (migrations
   77-83), missing ones by name; Anthropic key present (boolean);
   storage reachable; import_jobs counts by status for 24 h and the last
   5 error codes with page and check names.
3. LIVE MODEL CHECK: one tiny call per model (claude-opus-5-5,
   claude-fable-5-1, claude-sonnet-5-5, claude-haiku-5-5) with the exact
   request shape the import will use: output_config.format json_schema,
   adaptive thinking, an output_config.effort value. Report OK or the
   exact API error, latency and token usage. Docs facts: forced
   tool_choice (any or tool) returns 400 on these models; thinking
   cannot be disabled on claude-opus-5-5; max_tokens covers thinking
   plus the reply; stop_reason refusal and max_tokens are failures of
   that call.
4. One "Share report" button (native share sheet, plain text, no
   amounts, no bank digits): everything above plus the last 5 import
   jobs (status, pages done, failed check names). Green or red per line.
5. Tests with the model client mocked; diagnose never returns a secret
   (test); 5 locales; no calculation changes.

STEP B: READ THE STATEMENT PAGES FIRST, PAGE BY PAGE, STRUCTURED OUTPUT.
1. Prime, all PDF sizes: remove the single whole-document call for PDFs
   of 8 pages or fewer (a misread deposit can be saved on that path
   today). One page per call, physical order, headline pages first: p1
   header and revenue totals, p3 accounts, p4 interest and recap, p5-6
   operating statement; stop after the statement's last page (the one
   with TOTAL CASH FLOW). Everything after it is an attachment.
   Line-item reading (rows on p1-p2) starts AFTER the headline card is
   ready, never gates "ready", and only rows that reconcile with the
   statement's group totals are stored (otherwise one quiet line "Line
   details were not saved because they did not match your statement.
   [Try reading them again]"). Other carriers: pages in physical order,
   the 40-page cap as built.
2. Structured output: output_config.format json_schema for every
   extraction call (simple schema per the docs' limits). Parse or
   schema failure: up to 3 retries with backoff, then that page is
   failed (no silent fallback). stop_reason max_tokens: retry with more
   room or split; refusal: failed page. Store the scrubbed raw reply of
   failed pages in import_jobs for diagnosis, deleted when the job is
   saved or dismissed.
3. Models by env: AI_IMPORT_MODEL_STATEMENT default claude-opus-5-5
   (effort medium), AI_IMPORT_MODEL_LINES default claude-sonnet-5-5
   (effort low), attachments claude-haiku-5-5. Fallback chain on
   not-found, permission or overloaded errors: claude-opus-5-5, then
   claude-sonnet-5-5; every fallback logged and shown in the report.
4. Resume: per-page results persisted; a killed worker re-reads at most
   ONE page (make the existing it.failing test pass); jobs span many
   invocations; the plan-aware time budget stays; per-call timeout 100 s.
5. Gate: the single pass/fail gate decides; a misread deposit or net due
   is never saved (make that it.failing test pass). Clean failure: "We
   couldn't read this statement reliably. Nothing was saved." [Upload
   again] [Send report].
6. Progress line only: "Reading your statement. This can take several
   minutes. Keep the app open." Never page, step, paused or interrupted
   wording.
7. Cost log: model, tokens, effort and dollar estimate per import in
   ai_usage_log; after my first real imports report the cost of one
   8-page and one 17-page import.
8. Tests: end-to-end with a simulated model for both golden weeks (the
   17-page one has a MILES row and a balance forward), a parse failure
   that retries, a max_tokens retry, a killed worker, a model fallback;
   show the old behaviour failing first where a test is new.

STEP C: DUAL READ AND MODEL PROFILES (step B must already work on a real
PDF).
1. Each headline or statement page is read TWICE with two independent
   configurations (different model; when only one is available, a
   different prompt and field order), compared number by number. Any
   disagreement: read that page a third time. Accept a number only when
   two reads agree AND the arithmetic chains pass (block totals;
   variable + fixed + other = total operating expenses; revenue -
   expenses = total statement; balance forward to cash flow to deposit;
   net due identity; date rules). Otherwise the clean failure screen
   appears and nothing is saved.
2. AI_IMPORT_PROFILE (Supabase secret, default balanced), resolved on
   the server: max = one read by claude-fable-5-1 and one by
   claude-opus-5-5, line pages claude-opus-5-5; balanced = two reads by
   claude-opus-5-5 with different prompt orders, line pages
   claude-opus-5-5, claude-fable-5-1 only as the third read; economy =
   ONE read by claude-opus-5-5, the second read by claude-fable-5-1 only
   when a gate fails. Attachments always claude-haiku-5-5. Keep step B's
   fallback chain. Document in CLAUDE.md Commands: supabase secrets set
   AI_IMPORT_PROFILE=... from the repo root, then deploy ai-import.
3. Log per import: profile, models, tokens, effort, dollar estimate,
   number of disagreements; show them in the Send report (names only).
4. After my first real imports report the measured dollar cost per
   profile for 8 and 17 pages and how often two reads disagreed.
5. Tests: the "two reads disagree" it.failing scenario passes; a
   deliberately misread number is caught by the comparison AND the
   gate; each profile selects the right models; fallback when a model is
   unavailable; 5 locales; no calculation changes.
```

## Progress

- [ ] Step A: system check, live model check, send report
- [ ] Step B: statement pages first, page by page, structured output
- [ ] Step C: dual read and model profiles
