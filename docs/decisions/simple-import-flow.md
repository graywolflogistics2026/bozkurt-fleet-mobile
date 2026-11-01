# Simple import flow and certify (batch D2, owner decision 2026-10-31)

## Three states
A settlement import shows exactly one of:
1. READING — "Reading your statement. Keep the app open. Usually 2-4 minutes
   for 17 pages." No pages, steps, pauses or interruptions are shown.
2. CHECK AND CERTIFY — week ending, revenue, net due, deposited (or owed to
   carrier, red), miles (loaded/empty), per diem days (editable 0-7),
   estimated profit ("~"), the estimates-only banner, one button
   "Certify and add to my books", Discard, collapsed "Show details".
3. COULD NOT READ — "We couldn't read this statement reliably. Nothing was
   saved." + one-sentence reason, Upload again, Send report (Share sheet;
   audit text with bank digits scrubbed).

## The one gate
`app/src/import/settlementGate.ts` `evaluateSettlementGate()` — used by the
card AND by `saveExtraction()` (a save that does not pass throws; nothing is
written). No override.
- Prime: statement gate passed, gross matches, net due / deposit match, no
  zero-net-with-gross. Date issues that mean a misread fail; unusual-only
  dates (not Friday, future, too old) are asked once inside the card
  (`needs_date`). A Prime reading with no statement page falls back to the
  printed-totals rules only when no content page is incomplete.
- Other carriers: printed gross, deductions and net due must be printed
  (`totals_not_printed`) and add up within $1 (`totals_differ`); lines must
  match them (`lines_differ`); deposit must match; ambiguous date -> asked.
- Fail -> automatic re-read (max 2, `MAX_AUTO_REREADS`), best reading kept
  (`pickBetterReading`), then COULD NOT READ. Line details that differ
  NEVER trigger a re-read (2026-10-31): Certify at once, lines not stored.
- Ready to review (2026-10-31): `isReadyToReview()` is the one rule; a job
  with a re-read requested is ready only once it completed after that
  request (the cached list row said 'ready' while the server had already
  cleared the reading). `loadJobForReview()`: ready / finishing / failed /
  missing; finishing retries 3 times (2, 4, 8 s), then Read again.
- Prime statement passed but line details disagree (loads, deductions,
  incomplete content pages): the week saves from the statement WITHOUT line
  rows, `statement.linesNotSaved = true`; detail shows "Line details were
  not saved [Try reading them again]".
- The gate result is stored in `parsed_json.settlementGate` for audit only.

## Certify
Certify and add = save, then ONE last write of `certified_at`,
`certification_text_version`, `certification_app_version` (§82 triggers
clear the certification on any later edit, so it must be last).
Text (DRAFT, attorney review): "I checked these numbers against my
statement. AI-generated estimates, not tax advice."
`CERTIFICATION_TEXT_VERSION = 'draft-2026-10-31'`. Weeks saved earlier show
"Not certified [Certify]", which opens the same headline card from the
stored numbers. The only week status anywhere: "Certified on <date>" /
"Not certified".

## Removed from the screens
Verified / Totals match / Unverified labels, "Save anyway", Review All,
"Things to check", "line items incomplete" notices, missing-pages lists,
"Needs a date check" list, duplicate / replace banners. Data kept
(statement reasons, review_acknowledged).

## Attachments
After save, attachment pages are read silently (cap 12,
`ATTACHMENT_READ_CAP`) into `documents.parsed_json`, never re-saving the
week. Detail: "Attachments: N saved, M read [Read]".
