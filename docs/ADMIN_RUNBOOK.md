# Admin Runbook — Tax Year Data

This is the only place tax constants live (CLAUDE.md invariant: no tax
constant may live in app code). Updating a year's figures or rolling over to
a new tax year is a SQL edit against `tax_year_data`, run directly in the
Supabase SQL editor — no app release required. Users on any app version pick
up the change on their next launch (offline-cached copies refresh then too).

## Yearly checklist (every November, ahead of the new tax year)

1. Gather the new IRS figures for the upcoming `tax_year`:
   - Federal income tax brackets (MFJ, single, HoH) and standard deductions
   - SE-tax rate/factor and the new Social Security wage base
   - Per diem rate (currently $64/day, 100%-in-expenses per the net-pay
     model — confirm this hasn't changed)
   - The four quarterly estimated-tax deadline dates
   - Any state tax rate/bracket changes for the states already covered in
     `state_tax` — AND whether a state's classification itself has changed
     (flat vs. progressive-bracket). This isn't hypothetical: the 2026
     verification below found Georgia and North Carolina had both moved to
     flat-rate taxation since this app's state-tax design was first drafted
     (which had assumed them as "bracket" states). Don't assume last year's
     no_tax/flat/bracket bucketing still holds — re-check each covered
     state's current law, not just its rate.
2. Insert the new row using the template below with `published = false`
   first, so you can review it before it goes live.
3. Sanity-check the new row against a couple of known net-profit figures
   (e.g. re-run the numbers from last year's row through the same formula
   and confirm the app's dashboard matches by hand for a test user with
   `tax_config.tax_year` pointed at the new year).
4. Flip `published = true` when ready. The app will start using it for any
   user whose `tax_config.tax_year` equals the new year (typically after
   they roll over on Jan 1 — see PROMPTS.md Session 5's year-rollover
   behavior) and will keep showing the fallback banner for anyone still
   pointed at the new year before you publish it.
5. Do NOT delete or edit a published prior year's row — it's the audit
   trail for any estimate a user saw/relied on that year. Add a new row
   instead; only correct a live row's `notes`/typo-level fields, not its
   numbers, once it's been published and used.

## INSERT template

Replace every `<...>` placeholder with the confirmed IRS/state figure for
that year before running. Numeric values marked `<verify>` are real-world
figures this runbook cannot supply reliably — confirm them against the
actual IRS/state publication for that year before publishing.

```sql
insert into tax_year_data (
  tax_year, federal_brackets, standard_deduction, se_tax, per_diem,
  quarterly_deadlines, state_tax, published, notes
) values (
  <year>,
  '{
    "mfj":    [[0, <b1_hi>, 0.10], [<b1_hi>, <b2_hi>, 0.12], [<b2_hi>, <b3_hi>, 0.22], [<b3_hi>, <b4_hi>, 0.24], [<b4_hi>, <b5_hi>, 0.32], [<b5_hi>, <b6_hi>, 0.35], [<b6_hi>, null, 0.37]],
    "single": [[0, <b1_hi>, 0.10], [<b1_hi>, <b2_hi>, 0.12], [<b2_hi>, <b3_hi>, 0.22], [<b3_hi>, <b4_hi>, 0.24], [<b4_hi>, <b5_hi>, 0.32], [<b5_hi>, <b6_hi>, 0.35], [<b6_hi>, null, 0.37]],
    "hoh":    [[0, <b1_hi>, 0.10], [<b1_hi>, <b2_hi>, 0.12], [<b2_hi>, <b3_hi>, 0.22], [<b3_hi>, <b4_hi>, 0.24], [<b4_hi>, <b5_hi>, 0.32], [<b5_hi>, <b6_hi>, 0.35], [<b6_hi>, null, 0.37]]
  }'::jsonb,
  '{"mfj": <std_mfj>, "single": <std_single>, "hoh": <std_hoh>}'::jsonb,
  '{"rate": 0.153, "factor": 0.9235, "ss_wage_base": <verify>}'::jsonb,
  '{"daily_rate": 64, "deductible_pct": 100}'::jsonb,
  '[["Q1", "<year>-04-15"], ["Q2", "<year>-06-15"], ["Q3", "<year>-09-15"], ["Q4", "<year_plus_1>-01-15"]]'::jsonb,
  '{
    "no_tax": ["TX","FL","TN","WA","NV","SD","WY","AK","NH"],
    "flat": {"<state>": <verify — ALWAYS a bare rate number, never a nested object, even for a state with an exemption or surtax>},
    "flat_adjustments": {"<state>": <verify — only for flat-rate states whose law isn't a single bare rate, e.g. {"exempt_below": N} or {"surtax_rate": R, "surtax_over": N}; applied AFTER the flat rate, never in place of it>},
    "bracket": {"<state>": <verify — only for states genuinely still using progressive brackets that year; re-check this every year, don't carry a state over from last year's list>},
    "fallback_effective_rate": <verify>
  }'::jsonb,
  false,
  'Seeded <date>; brackets/std-deduction/SS-wage-base per IRS Rev. Proc. for <year>; state figures per each state''s revenue dept. Reviewed by: <name>.'
);

-- After review, publish it:
-- update tax_year_data set published = true where tax_year = <year>;
```

## 2026 row — verified reference example

The 2026 row is a special case in two ways: its federal brackets, standard
deduction, SE-tax rate/factor, and per diem are ported VERBATIM from legacy
`calcTax()`, not gathered fresh from an IRS publication (they already went
through that process when the legacy app was built) — and it's the first
row ever verified and published, so it doubles as the worked example for
every future year's checklist above. Verified and published 2026-07-03; the
applied SQL is in `docs/PENDING_SQL.md` §3.

**Federal (verbatim from legacy calcTax, unchanged from seed):**
- `standard_deduction`: `{mfj: 30000, single: 15000, hoh: 22500}`
- `se_tax`: `{rate: 0.153, factor: 0.9235, ss_wage_base: 184500}` — the
  `ss_wage_base` is recorded for future-proofing only; legacy's math applies
  SE tax UNCAPPED (no wage-base cutoff), so this figure does not change the
  2026 computation. Don't start applying the cap without an explicit,
  separate owner decision to do so.
- `per_diem`: `{daily_rate: 64, deductible_pct: 100}`
- `quarterly_deadlines`: `[["Q1","2026-04-15"],["Q2","2026-06-15"],["Q3","2026-09-15"],["Q4","2027-01-15"]]`

**State tax (verified 2026-07-03, source: Tax Foundation 2026 for flat
states, official FTB 2025 Schedule X/Y/Z for CA):**
- `no_tax`: `["TX","FL","TN","WA","NV","SD","WY","AK","NH"]` (unchanged)
- `flat` — always BARE rate numbers, never a nested object, for every state
  in this map:
  - `NC`: 3.99%
  - `GA`: 4.99% — **reclassified from bracket to flat this cycle**; Georgia
    completed its move to a flat individual income tax
  - `UT`: 4.45%
  - `OH`: 2.75% (its exemption lives in `flat_adjustments`, not here — see
    below)
  - `IL`: 4.95% — verified this pass (was wrongly left off as a "bracket"
    state in the original design; it's flat in reality)
  - `PA`: 3.07% — verified this pass (same correction as IL)
  - `NC`/`GA`/`IL`/`PA` were ALL "bracket" states in the original design
    (PROMPTS.md Session 5's "CA, GA, IL, NC, PA" list) — that list was
    written before checking current law and turned out wrong for four of
    the five. PROMPTS.md has been corrected. Treat any such list as a
    starting point to re-verify every year, never as settled.
- `flat_adjustments` — a SEPARATE object, keyed by state, for flat-rate
  states whose real law isn't just a single bare rate. Applied AFTER the
  state's `flat` rate is computed, as a second pass — never folded into
  `flat` itself. Live shape:
  - `OH`: `{"exempt_below": 26050}` — 0% on income below $26,050, then the
    flat 2.75% above it.
  - `MA`: `{"surtax_rate": 0.04, "surtax_over": 1000000}` — an additional
    4% on income over $1,000,000, on top of MA's own `flat` rate entry.
    (MA's own bare `flat` rate isn't itemized in this pass yet — add it
    when MA is fully verified; don't assume a number for it.)
  - This resolves what used to be an open question about how a state like
    Ohio, which doesn't fit a single bare rate, should be represented: it
    does NOT get a nested object inside `flat`. It gets a `flat` entry
    (bare rate) plus a `flat_adjustments` entry (the exemption/surtax
    logic). The state-tax module must apply `flat_adjustments` for a state
    as a second pass over the flat-rate result, not as a replacement.
- `bracket`:
  - `CA`: official 2025 FTB Schedule X (single) / Y (MFJ) / Z (HoH) — the
    ONLY state, as of 2026, that's still genuinely progressive.
    California's brackets range from 1% to 12.3% (plus a separate 1%
    Mental Health Services surcharge above $1M that the app does not yet
    model). **Transcribe the exact bracket thresholds directly from the
    live `tax_year_data` row or the FTB publication** — they are
    inflation-indexed and shift slightly every year, so no copy of them
    outside the database (including this runbook) should be treated as
    authoritative once a newer year exists.
- `fallback_effective_rate`: 0.045 — the generic approximation used for
  every state not explicitly listed above.

Use this row as the template for what "verified" should look like for any
future year: every rate sourced and cited, every state's flat-vs-bracket
classification re-checked rather than carried over, and any state whose law
doesn't fit the common shape (Ohio's exemption, Massachusetts' surtax)
represented via `flat_adjustments` instead of silently squeezed into
`flat` or skipped.
