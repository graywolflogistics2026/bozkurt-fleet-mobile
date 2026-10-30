# Master plan v2 (owner, 2026-10-30)

> Saved verbatim from the owner's paste so that "continue the master plan"
> is enough to resume after a /clear. Progress is tracked in the
> "Progress" section at the bottom (updated after every batch).

```text
MASTER PLAN v2, 2026-10. ONE PASTE, SIX BATCHES (0b, A, B, C, D, E).
Owner decision: ship these TODAY, done properly. This replaces any
earlier master plan.

PROTOCOL
0. git status and git log -15 first. Batch 0 (printed dates, held by
   carrier, one deposit per statement) is DONE in 5bd080d: skip it.
   Anything below already built and pushed is skipped too (list what
   and why). Never rebuild finished work.
1. Save this whole message as docs/decisions/master-plan-2026-10.md and
   commit it (docs only). After a /clear, "continue the master plan"
   must be enough to resume.
2. I waive "wait for my approval" (rule 2) for the whole plan, except
   the STOP list at the end. Rule 1 stays light: trace each cause with
   file:line in your report, then fix in the same run.
3. One batch at a time. After EACH batch: tsc, tests, commit, push,
   then STOP and write ONE final message, at most 25 lines, in SIMPLE
   TURKISH (I am not a developer): what changed in plain words; the
   ship list in this order (PENDING_SQL with a read-only check query,
   Edge Functions, then eas update, or eas build for batch E); five
   things to test on the tablet; what could NOT be verified here.
   Commands for me are PowerShell, each in its own code block, cd line
   first. Then wait for me to write "next". Never run eas update
   yourself while code is still changing.
4. No change to any canonical calculation (profit, CPM, tax) unless an
   item says so; extend the isolation proofs for every item.
5. New strings go to all 7 locale files, en.json first; the 5 enabled
   locales are translated with proper diacritics (this prompt is ASCII
   because of the terminal).

=== BATCH 0b: LEFTOVERS FROM 5bd080d ===
0b.1 DATE DISPLAY SHIFT (approved): stored date-only values
  (YYYY-MM-DD: week_ending, ded_date, purchase dates, due dates) show
  one day early on US timezones (8/14 shows as 8/13). Fix at the root
  with ONE shared parser and formatter that treats a date-only string
  as a LOCAL calendar date (never new Date("YYYY-MM-DD"), which is
  UTC), used by every screen, export, chart label, period window (week,
  month, quarter, YTD buckets), per-diem day count, reminder and alert.
  List every place changed, with grep proof that no date-only string
  still goes through new Date(). Month bucketing and period windows use
  the same parsing so NO row moves to another month: before/after proof
  on both golden weeks and on a month boundary (2026-07-31 and
  2026-08-01). Tests under TZ=America/Chicago, TZ=UTC and
  TZ=Pacific/Auckland.
0b.2 ACCOUNTANT PACKAGE: a "settlement-withheld" line is counted as a
  deductible expense somewhere. Report first (exact line, file:line,
  formula, numbers it changes on the golden weeks), then fix so the
  origin rule holds (out-of-pocket, settlement-withheld and combined
  scopes keep their existing meaning).
0b.3 CASH FLOW 30-day forecast counts a week twice: trace and fix; test
  with the two golden weeks and the same week imported with and without
  a truck.
0b.4 ONE SHARED NUMBER PARSER (num / numOrNull): thousands separators,
  trailing minus, parentheses, leading $, stray spaces, a missing
  leading zero; unparseable text gives null, never a wrong number
  ("3,212.19" currently parses as 3). Table-driven tests: "3,212.19" ->
  3212.19, "184.85-" -> -184.85, ".37-" -> -0.37, "47.34-" -> -47.34,
  "(12.50)" -> -12.5, "$1,884.73" -> 1884.73.
Ship: eas update (ai-import redeploy only if the shared parser lives in
the Edge Function; no SQL expected).

=== BATCH A: DATA CONSISTENCY (items 1, 2, 7) ===
ITEM 1 - CATEGORY SYNC between the "For Prime Inc Drivers" screen and
Deductions. Expenses first saved as Misc were later categorized on the
Prime screen; Deductions kept the old category.
- Reverse map accountant -> canonical: Lumpers -> Lumper Fees; Cash
  Tolls/Parking Fees and Scales -> Tolls & Scales; Equipment/Operating
  Supplies -> Truck Supplies & Equipment; Safety/Weather Gear -> Safety
  Gear & Workwear; Cash Fuel -> Fuel & DEF; Oil & Additives -> Fuel
  Additives; Truck & Trailer Wash -> Truck Wash & Detailing; Repairs ->
  Maintenance & Repairs; Communication -> Utilities & Subscriptions;
  Advertising -> Advertising; Office Supplies -> Office & Admin;
  Lodging -> Parking & Lodging; Bank/ATM Fees -> Bank & Merchant Fees;
  Misc -> Misc; Laundry/Showers has no canonical home, unchanged.
- Changing the accountant category of a row whose canonical category is
  Misc, Other or empty offers ONE confirmation "Also set Deductions
  category to X?" with Undo. A specific canonical category is never
  overwritten silently. A canonical change in Deductions never rewrites
  an accountant category I picked by hand.
- Deductions rows show an "Accountant: X" chip.
- One-time card "Categories out of sync (N)": rows with an accountant
  category but canonical Misc/Other; preview, per-row Apply, "Apply
  all". Nothing automatic.
- Isolation proof: totals, profit, CPM and tax identical before and
  after; only category breakdowns move.
ITEM 2 - TRUCKS AND DRIVERS: edit, archive, delete. I added a truck and
a driver and cannot edit or remove them; nothing happens. Trace first
(is there a button; does a write fail silently; missing RLS UPDATE or
DELETE policy on trucks or drivers; swallowed error; wrong id; where
the driver is stored). Build: edit truck (unit number, nickname, plate,
VIN, year, make, model, assigned driver, active); ARCHIVE (hidden from
selectors and the scope strip, history kept, restorable) vs DELETE (the
existing cascade: counts, dollar total, type the unit, export first);
edit a driver; remove a driver (history kept as "former driver");
reassign; last-truck rule; every failure shows a visible error, never
silence. An RLS fix goes in PENDING_SQL. Tests: add, edit, archive,
restore, delete with data, no orphans in any table.
ITEM 7 - DELETE A DOCUMENT AND EVERYTHING LINKED, WITH UPDATED NUMBERS.
Opening a file in Documents offers no working delete. Trace first: is
there a delete action; why does it fail (FK from deductions,
fuel_purchases, maintenance_records, tolls, settlements,
reimbursements, loads, equipment, compliance items,
prime_driver_expenses or import_jobs to documents without ON DELETE;
missing RLS DELETE policy; swallowed error); list EVERY table that
references documents.id or stores the storage path.
- DERIVED links (rows an import created: settlement children, companion
  and lumper rows, statement jsonb, loans created from the settlement,
  auto-created equipment, capital contributions from the owner-paid
  sync, import_jobs) and ATTACHED links (manual records that only have
  the file attached).
- Delete sheet: counts by table, dollar totals and the effect ("this
  week's profit changes from $A to $B"). Buttons: [Delete file and
  everything linked] (my default request: derived AND attached),
  [Delete file only, keep the records] (shown when linked records
  exist), [Cancel]. A settlement document deletes the WHOLE settlement
  through the existing settlement delete path plus its attachments,
  listed with counts, and asks me to type the week ending. Say it is
  irreversible.
- One atomic server function: preview_document_delete(doc_id) and
  delete_document_cascade(doc_id, mode), SECURITY DEFINER, scoped to the
  caller, idempotent, all-or-nothing, REUSING the existing atomic RPCs
  (sections 60, 62, 64, 70, 73) instead of a thinner parallel delete.
  The storage object is removed after the commit and retried by the
  existing orphan cleanup. PENDING_SQL with a read-only check query.
- Refresh: invalidate every dependent query (Home KPIs and bridge,
  Scorecard, Profit Analysis, Per-Truck, Deductions, Fuel, Tolls,
  Maintenance, Equipment, Capital, Tax Estimator and reserve, Cash Flow,
  alerts, Prime Inc Drivers report, Accountant Package, Settlements,
  YTD comparison, held, deposited, Documents lists). A certification on
  an affected week is cleared (batch C).
- Tests: a receipt that created a deduction, a capital contribution and
  an equipment row: deleting removes all three and every total equals a
  fixture that never had the document; a settlement document removes
  children and attachments and updates profit, deposited and held;
  "file only" keeps the records; a failure halfway rolls back; another
  user's document cannot be deleted; re-importing the same file after a
  delete works.

=== BATCH B: VEHICLE PURCHASE AND TAX TREATMENT (items 3-4) ===
On truck 283940 I added the purchase document and price and chose
deduct / don't deduct / "tax officer decides": nothing changed anywhere.
Trace where price, date, document and the choice are stored, who reads
them, and why changing the choice does nothing. Design:
- "Deduct in the purchase year": lowers the Tax Estimator's taxable
  income by the price, labeled an estimate ("your tax professional
  decides the actual treatment"); warn when it exceeds estimated
  income. The weekly tax reserve on Home is NOT lowered silently: show
  it with and without the purchase deduction.
- "Don't deduct": no effect on the estimate.
- "My tax professional decides" (default): no effect on the estimate;
  the Accountant Package lists an open capital item (unit, date, price,
  document, "treatment: preparer decides").
- Weekly profit and RPM/CPM/PPM never include the price (capital, not an
  operating expense), except the existing truck cost-basis estimate; one
  plain line on screen says so.
- The add-vehicle flow asks: purchase date, price, financed or cash,
  document (optional), tax treatment (default: preparer decides) and
  shows the effect on the estimate right there. Editing the choice later
  updates every view at once.
- No depreciation law is encoded in this round.
Tests: each choice on a fixture (estimate before and after, Accountant
Package line, profit and CPM unchanged, all views update together).

=== BATCH C: REVIEW AND CERTIFY, HOME MILES (items 5, 6) ===
ITEM 5 - Every import raises many "review" and "mileage missing"
warnings. Trace each warning an imported settlement can raise and why
"mileage missing" shows on a statement-backed week whose statement
prints total miles. Then ONE post-import card "Review this week"
replaces the scattered warnings: "Things to check (N)" with one-tap
"Looks right" per item and a single [Certify]. DRAFT text (my attorney
reviews the final wording before public launch; mark it so in docs):
"This report was generated by AI from your statement. I reviewed it
against my original documents. I understand it is not a tax document,
an accounting record or tax advice, and that I should confirm
everything with a licensed tax professional." Record certified_at, text
version and app version; any later edit of that week clears the
certification. Show "Certified by you on <date>" and the same
disclaimer in exports. Reuse reviewed_at where possible; a new column
means a PENDING_SQL section. Tests: statement-backed golden weeks raise
only items that truly need a look; certify and re-certify; no
certification survives an edit.
ITEM 6 - HOME MONEY AND MILES. Add empty (deadhead) miles and total
miles beside Revenue / Expenses / Net and RPM / CPM / PPM; Total Miles
is tappable: a list per settlement week and truck (week ending, loaded,
empty, total, deadhead %) for the selected period and scope, same period
tabs including All. If Home gets crowded, split into two cards: Money
(Revenue, Expenses, Net, RPM, CPM, PPM) and Miles (Total, Loaded, Empty,
Deadhead %). First check whether the earlier empty-miles card task
exists and reconcile with it. One canonical source (computeKpis),
identical numbers on every screen. Golden weeks: 8/21 2,081 / 246 /
2,327 = 10.6%; 8/14 2,739 / 577 / 3,316 = 17.4%. Phone and tablet.
Carrier wording: Prime keeps its exact reading ("empty"); another
carrier may print "deadhead", "DH" or "unloaded", so any other carrier
uses a generic reader that returns loaded / empty / total plus the label
the statement used: if only loaded and total are printed, empty = total
- loaded, marked "derived"; a deadhead PAY line without miles is not
the week's empty miles (flag it); bobtail and out-of-route miles are
never deadhead; nothing recognizable leaves the split null (not 0) and
the card counts "N weeks without breakdown". Loaded and empty are
editable per week and manual values survive re-imports. The card says
"Empty / deadhead miles" for every carrier.

=== BATCH D: EXPLANATIONS AND WARNINGS (items 8, 10) ===
ITEM 8 - PROFIT EXPLAINER (my own expenses vs Prime's numbers).
- Three layers for the selected period and scope: (A) profit per your
  settlements, with its label (Verified / Totals match / Unverified);
  (B) your own expenses: every deductible expense with no settlement
  link in the window (manual entries, receipt photos), count and total,
  expandable into rows that open for editing, plus a muted list of what
  was NOT counted and why (meals, advance repayment, escrow); (C) result
  = A - B, equal to the canonical profit to the cent. Sentence: "Your
  settlements show $X profit. You added $Y of your own expenses (N
  items) this week, so your profit is $Z." (TR: "Settlement'larina gore
  karin $X. Bu hafta kendi ekledigin $Y gider var (N kalem), o yuzden
  karin $Z.") plus one line: the bank deposit stays the carrier's
  figure.
- Residual check: A - B - canonical profit must be 0.00, else show
  "Unexplained difference $X" with needs-review; add it to the
  cross-screen consistency test.
- Flag, never silently drop, a layer-B row that looks like a
  settlement-withheld line (same amount within about 3 days, similar
  category): "possible duplicate: keep / remove".
- ONE shared explainer function with cases (none, ownExpenses,
  primeMatch, extractionMismatch, unexplained) used on the Home caption,
  bridge sheet, settlement detail, Settlements banner, AI Coach review
  and accountant notes. A gap caused only by my own expenses is neutral
  INFO; amber is only for a real mismatch between Prime-derived figures
  and Prime's printed numbers; own expenses never trigger a Prime
  mismatch banner.
- Per-Truck Profitability shows two lines per truck: "Profit", identical
  to Home for the same truck and period, and "After truck cost
  estimate" (today's figure); rank by the second and label both.
- Tests: golden 8/21 with $100 + $50 own expenses reads settlements
  2,534.36, own 150.00 (2 items), profit 2,384.36; the same on
  1M/3M/Yearly/All and per truck; a non-deductible own row is listed as
  not counted.
ITEM 10 - BIG, UNMISSABLE "ESTIMATES ONLY - NOT TAX ADVICE" NOTICES.
1. ONE shared component EstimateBanner (the small LegalFootnote stays
   for minor screens). Warning-colored background, thick border, a
   vector warning icon (not an emoji), headline at least 18sp, weight
   800, UPPERCASE; body 14-15sp semibold. Theme tokens for light AND
   dark mode, text contrast at least 4.5:1 (a contrast test), never
   color-only meaning, respects dynamic type, phone and tablet, NOT
   dismissible on the screens below. English: "ESTIMATES ONLY - NOT TAX
   ADVICE." / "BOZKA TRUCKING AI is a record-keeping and estimating
   tool, not a tax preparer, accountant or law firm. Numbers are
   AI-generated estimates from your documents and can be wrong. Confirm
   everything with a licensed tax professional before you file or
   pay." Turkish headline: "SADECE TAHMINDIR - VERGI TAVSIYESI
   DEGILDIR." (use proper Turkish characters in the locale file). Mark
   the text DRAFT in docs: my attorney reviews it before public launch.
2. WHERE (full banner, visible without scrolling): Tax Estimator;
   Accountant Package preview; Review and certify card; vehicle purchase
   and tax treatment screen; For Prime Inc Drivers report ("Record-
   keeping aid. Not an accounting or tax document."); Cash Flow forecast
   ("Forecast. Estimate only."). Home tax strip (Weekly Tax Reserve,
   Next Quarterly, Yearly Tax): a colored one-line banner directly above
   it ("ESTIMATES ONLY - NOT TAX ADVICE", bold) that opens the full text
   in a sheet; Home must not get cluttered.
3. EXPORTS (PDF, Excel, CSV, share text, accountant package, Prime Inc
   Drivers report): the full banner at the top of the first page or
   sheet, a one-line footer on every page, and "Prepared by the owner
   with AI-generated estimates. Not reviewed by a CPA." AI Coach tax
   answers and weekly review carry the one-line banner. Every
   tax-estimate notification says "estimate".
4. ACKNOWLEDGMENT GATE: a full-screen "Before you start" on first
   launch after sign-in and whenever the text version changes: banner
   text, three plain bullets (estimates only; not tax, legal or
   accounting advice; confirm with a licensed professional), a required
   checkbox "I understand" and [Continue]. Record accepted_at and
   text_version; reuse the existing terms-acceptance record if there is
   one, otherwise PENDING_SQL with a read-only check query. The same
   text lives under Settings, Legal. The gate cannot be skipped.
5. ENFORCEMENT: a source check that every screen in the list renders
   EstimateBanner; an export test asserting the banner string in each
   export; a test that the gate appears on first launch and again after
   a version bump; no calculation changes.
6. Update the Privacy Policy and Terms drafts and the store-label notes
   with one line: the app gives estimates only; the acknowledgment is
   recorded. List what needs my attorney.

=== BATCH E: AUTOMATIC DOCUMENT SCANNER (needs a NATIVE build) ===
The camera should detect the paper or receipt, flatten it and crop only
that area, like a scanner app. This is NOT an OTA change.
E1. Library check (one paragraph, then proceed): compatibility with THIS
    project (Expo SDK, React Native version, New Architecture state,
    expo-doctor / expo install --check, maintenance, MIT). Candidates:
    react-native-document-scanner-plugin (Expo config plugin; Android =
    Google ML Kit Document Scanner, iOS = VisionKit), expo-document-
    scanner (Nitro module, needs New Architecture),
    @dariyd/react-native-document-scanner. Avoid Android-only libraries
    so iOS works later. Android needs Google Play Services and about
    1.7 GB RAM; the ML Kit UI asks for the camera permission itself.
E2. ONE shared helper scanDocument() used by EVERY place that takes a
    photo today: Deductions receipt, Documents add, Import "take photo",
    For Prime Inc Drivers add-expense photo, maintenance, tolls,
    equipment and vehicle purchase documents. Fall back to today's
    camera or picker whenever the scanner is unsupported, denied,
    cancelled or fails. "Plain photo", "From gallery" and "PDF" stay
    available. Gallery import does not rely on the scanner's
    Android-only button.
E3. Output: JPEG about 85% quality, long edge at most about 2,200 px.
    Multi-page scans, capped at 10 pages in app code on both platforms
    (iOS has no page-cap option), are combined into ONE PDF on the
    device (propose how, e.g. pdf-lib) and go through the existing
    resumable page-by-page import. Respect the 10 MB limit and compress
    when needed.
E4. Privacy: the scan runs on the device. Temporary scan files are
    deleted after upload or cancel. Nothing leaves the phone before the
    AI consent screen. Add one line to the Privacy Policy draft and the
    store-label notes: "On-device document scanning (Google ML Kit
    Document Scanner on Android, Apple VisionKit on iOS); images stay on
    the device until you import." Flag that Google's current statement
    on ML Kit data collection must be checked before filing the Data
    Safety form, and that Apple App Privacy needs User Content "Photos
    or Videos" (verify on Apple's current page).
E5. EAS: add the config plugin; set the iOS camera usage string "We use
    the camera to scan your receipts and statements."; bump the app
    version so the appVersion runtime policy keeps old binaries from
    receiving JS that calls a missing native module; write into
    CLAUDE.md's EAS facts that this change needs eas build, not eas
    update; run expo-doctor. No iOS build now (Apple Developer account
    and D-U-N-S are still missing).
E6. Tests with the module mocked: success, cancel, permission denied,
    unsupported (fallback), multi-page to one PDF, oversize compression.
    No change to any calculation.
Ship: eas build --profile preview --platform android (no SQL, no Edge
Function). List what could NOT be verified here (real device, Play
Services, real receipts).

=== STOP AND ASK ONLY IF ===
a fix needs deleting or rewriting my data outside the preview-and-
confirm flows above; a PENDING_SQL would drop or alter an existing
column; an isolation proof fails and you cannot explain it; the Tax
Estimator cannot show the new effect without changing how taxes are
computed for other cases; a check would block a real statement of mine
that matches Prime's printed totals.

Start now with the protocol, then batch 0b.
```

## Progress

| Batch | Status | Commit |
|---|---|---|
| 0 (printed dates, held by carrier, one deposit per statement) | Done before this plan | 5bd080d |
| 0b | In progress | — |
| A | Not started | — |
| B | Not started | — |
| C | Not started | — |
| D | Not started | — |
| E | Not started | — |
