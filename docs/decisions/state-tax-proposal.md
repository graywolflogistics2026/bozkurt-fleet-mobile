# State income tax in the Tax Estimator — proposal (2026-11-24)

Status: PROPOSAL, nothing implemented. No code, SQL or deploy was changed
for this document.

## Owner requests (verbatim)

> Goal: design state income tax support in the Tax Estimator. Owner
> request: filing status and home state must offer ALL states (50 + DC),
> each user picks their own state, and state tax must work correctly
> because some states have no income tax and others do.
>
> 1. Describe what the Tax Estimator does today (file:line): inputs, which
>    states can be selected now, how any state tax is computed today, where
>    the home state is stored, which tests pin its numbers.
> 2. Research the rules from OFFICIAL state revenue department sources
>    (cite the URL for every state, mark anything not verified). Tax year
>    2026 where published, otherwise the latest year and say so.
> 3. Propose the design: data model (rates per state, per tax year, per
>    filing status), where the user picks the state (and the default), how
>    the result is shown (federal vs state), the "estimate only" wording, a
>    "last updated / source" note per state, and how the data is updated
>    each year.
> 4. Scope options: (A) one effective rate per state, (B) full brackets for
>    bracket states and flat rates elsewhere, (C) hybrid. Recommend one.
>    List what is OUT of scope for a first version.
> 5. How to keep every current federal number unchanged (pinned tests) and
>    which new tests are needed.

---

## 1. What the Tax Estimator does today

### Inputs (`app/app/(tabs)/more/tax-estimator.tsx`)

- **Filing status:** three pills, `FILING_STATUSES = ['single', 'mfj', 'hoh']` (line 34, UI lines 286-296).
  - There is no "married filing separately". `TaxConfig.filing_status` is typed to the same three values (`app/src/types/db.ts:847`).
- **Home state:** a free-text `Field`, two letters, upper-cased, placeholder "TX" (lines 298-306).
  - Nothing is validated. Any two letters are accepted ("ZZ", "XX"). There is no list of states and no state names.
- **"Include state tax" checkbox:** lines 308-319.
- **Other inputs:** entity type, ownership %, S-Corp salary, payroll-handled flag, SEP contribution, health insurance.
- **Saving:** `handleSaveConfig()` (lines 225-245) writes `tax_config` only.
  - `state: draft.state.trim().toUpperCase() || 'TX'` (line 231): a blank field silently saves **TX**.

### Which states can be selected now

Any two letters can be typed. The engine only knows the states listed in the live `tax_year_data.state_tax` row. Every other code gets a flat 4.5% "rough estimate".

The live 2026 row is `docs/PENDING_SQL.md` §3b, lines ~130-136, applied:

- `no_tax`: TX, FL, TN, WA, NV, SD, WY, AK, NH (9).
- `flat`: NC 3.99%, GA 4.99%, UT 4.45%, OH 2.75%, IL 4.95%, PA 3.07% (6).
- `flat_adjustments`: OH `{exempt_below: 26050}`, MA `{surtax 4% over 1,000,000}`.
- `bracket`: CA only (FTB **2025** Schedules X/Y/Z).
- `fallback_effective_rate`: 0.045, for every other state. That is 35 jurisdictions, including NY, NJ, MN, OR, AZ, CO, IN, KY, MI, MA and DC.

### How state tax is computed today

The function is `calcStateTax()` in `app/src/tax/stateTax.ts:21-60`. It is called from `calcTaxEstimate()` at `app/src/tax/calcTaxEstimate.ts:59`.

1. If the checkbox is off or the state is empty, the result is 0 with label `none` (line 28).
2. The **base is the FEDERAL taxable income** (`calcTaxEstimate.ts:56-59`): owner share + spouse income − half SE tax − SEP − health, minus the **federal** standard deduction.
   - No state uses its own standard deduction, exemption or starting point.
3. The state is then handled by its bucket:
   - `no_tax` gives 0, labeled `exact` (lines 33-35).
   - `flat` gives base × rate, then the optional `exempt_below` and surtax adjustment, labeled `exact` (lines 37-51).
   - `bracket` runs the federal bracket loop over the state's table, labeled `exact` (lines 53-57).
   - Anything else gives base × 4.5%, labeled `estimate` (line 59).
4. State tax is added into `totalTax` (`calcTaxEstimate.ts:61`). That means it also flows into `quarterlyPayment`, `weeklyTaxReserve` and `effectiveRate` (lines 76-78).
   - These figures appear on the Tax Estimator and on Home. Other callers: `src/data/taxEstimate.ts:54-58`, `app/(tabs)/index.tsx`, `trucks.tsx`, `aiCoachSummary.ts`, `proactiveCoach.ts`, `dailyTips.ts`.
5. **Display:** one row (`tax-estimator.tsx:458-467`).
   - It is labeled "State Tax", or "State Tax (rough estimate, XX)" when the label is `estimate`.
   - It shows no state name, no year and no source. The `exact` label is never shown to the user, which is correct, because invariant #8 says "Estimated" everywhere.

### Problems found in today's data and code (reported, not fixed)

- **MA:** Massachusetts is not in the live `flat` map, so it falls to the 4.5% fallback. Its surtax entry in `flat_adjustments` is never reached.
  - The test fixture (`app/src/tax/__tests__/fixtures.ts:58`) has `MA: 0.05`, so the tests do not catch this.
  - `PENDING_SQL.md` around line 167 already says "add it when MA is fully verified".
- **OH:** the official 2026 draft booklet says the tax is **$332 + 2.75% of the excess over $26,050**. The live data computes 2.75% × (base − 26,050), with no $332, so Ohio is underestimated by about $332.
  - Ohio's starting point is also federal AGI with its own exemptions, not federal taxable income.
- **CA** still uses the 2025 schedules. FTB published 2026 schedules in October 2026.
- **The base is wrong for most taxing states.** Applying the federal standard deduction is right for a few states: CO, ND, ID, MT, IA and OR start from federal taxable income or match the federal deduction. It is wrong for the others.
  - Examples: IL's exemption is $2,925, VA's standard deduction is $8,750, PA and MA have no standard deduction.
- **35 jurisdictions get one invented-looking 4.5%.** That includes states with high top rates (NY, NJ, MN, OR, DC) and low ones (AZ 2.5%, IN 2.95%).
- **The home state lives in two places, and they can disagree:**
  - `profiles.home_state` (`docs/SCHEMA.sql:14`, default 'TX') and `tax_config.state` (`docs/SCHEMA.sql:112`, `not null default 'TX'`).
  - Settings writes both (`settings.tsx:230-241`) and onboarding writes both (`onboarding.tsx:169-172`). The **Tax Estimator writes only `tax_config.state`** (line 231).
  - Settings shows `profiles.home_state` first (`settings.tsx:181`). The engine reads `tax_config.state`.
  - The "home state not set" nudge reads `profiles.home_state` (`src/data/alerts.ts:160`, `src/alerts/missingDataNudges.ts:155`).
- **'TX' is a silent default everywhere:** the DB defaults, the UI placeholders, `|| 'TX'` on save in three screens, and the onboarding initial state (`onboarding.tsx:84`).
  - A user who never chose a state is estimated as a Texan, with $0 state tax.
  - This conflicts with the first standing rule in CLAUDE.md: no owner-specific defaults, new users start with zero data.
- **Unused key:** `dashboard.stateTaxEstimateNote` exists in `en.json` but no screen uses it.

### Tests that pin the numbers today

- `app/src/tax/__tests__/stateTax.test.ts`: 10 tests on fixture data. They cover no_tax, flat, the OH exemption (2 tests), the MA surtax (2 tests), CA brackets, a malformed bracket falling back, an unlisted state falling back, and the checkbox off.
- `app/src/tax/__tests__/calcTaxEstimate.test.ts`: the base input is `state: 'TX'` (line 8). Line 52 uses NC to check that total = SE + federal + state. The other tests pin SE tax, the S-Corp/LLC branches, quarterly, weekly and effective rate.
- `app/src/tax/__tests__/vehiclePurchase.test.ts`: uses `state: 'TX'` (line 28).
- `app/src/tax/__tests__/fixtures.ts:56-75`: the fixture `state_tax`. It is not identical to the live row (MA has a flat rate here) and has a made-up CA table.
- `federalTax.test.ts`, `seTax.test.ts` and `yearFallback.test.ts` pin the federal side and the year fallback.
- No golden-settlement test involves the tax estimate.

---

## 2. State rules researched (official sources)

### How this was researched

Research was done on 2026-11-24 with web search and fetch, by four research passes. Each figure cites the page it was read on.

- **"UNVERIFIED"** means the figure was not confirmed on an official page. Either it came from a secondary source or search snippet, or the official page was blocked.
- **"DRAFT", "ESTIMATED" or "INFERRED"** means an official but not final figure.
- I did not re-check every figure by hand. **Before anything is seeded, the admin re-verifies each state against its source**, as `docs/ADMIN_RUNBOOK.md` already requires for `state_tax`.

Abbreviations:
- S = single, J = married filing jointly, H = head of household, MFS = married filing separately.
- SD = standard deduction.
- Brackets are written as "rate up to threshold".

### Summary by category (tax year 2026 unless stated)

- **No tax on wages or self-employment income (9):** AK, FL, NV, NH, SD, TN, TX, WA, WY.
  - The live `no_tax` list already matches these 9.
- **Flat rate, or flat above a zero band (14):** AZ, CO, GA, ID, IL, IN, IA, KY, LA, MA, MI, MS, NC, OH, PA, UT.
  - MS and OH are effectively flat above an exempt band. ID is flat above a zero bracket.
- **Graduated brackets (28):** AL, AR, CA, CT, DE, DC, HI, KS, ME, MD, MN, MO, MT, NE, NJ, NM, NY, ND, OK, OR, RI, SC, VT, VA, WV, WI.

### Per state

**AL — brackets (TY2025, not indexed).**
- S, H and MFS share one table: 2% to $500, 4% to $3,000, 5% above. J: 2% to $1,000, 4% to $6,000, 5% above.
- The SD shrinks as AGI rises: S $3,000 falling to $2,500, J $8,500 falling to $5,000, H $5,200 falling to $2,500.
- Personal exemption: $1,500 for S/MFS, $3,000 for J/H.
- Alabama uses its own AGI. Federal income tax paid is deductible. SE tax is only an itemized deduction.
- Local occupational taxes exist (UNVERIFIED rates).
- Dependent exemption tiers: UNVERIFIED.
- Sources: https://www.revenue.alabama.gov/wp-content/uploads/2026/01/25stddeduction40.pdf ; https://www.revenue.alabama.gov/wp-content/uploads/2026/01/25f40bk.pdf

**AK — no tax.**
- Official wording UNVERIFIED (secondary sources only).
- Source: https://tax.alaska.gov/programs/index.aspx

**AZ — flat 2.5% (TY2025).**
- SD equals the federal amount (2025: $15,750 S, $31,500 J, $23,625 H).
- 2026 SD and the federal-AGI starting point: UNVERIFIED.
- Source: https://azdor.gov/forms/individual-income-tax-highlights

**AR — brackets, one table for all statuses.**
- The top rate was cut to 3.7%, retroactive to 1/1/2026 (H.B. 1001, 2026).
- Withholding table: 0% to $5,600, 2% to $11,200, 3% to $16,000, 3.4% to $26,400, 3.7% above. A phase-out of the low brackets applies around $94,700-$97,600.
- SD $2,470. Personal credit $29 per exemption.
- UNVERIFIED: the return brackets (the official DFA formula still shows 3.9%) and the J standard deduction.
- Sources: https://www.dfa.arkansas.gov/wp-content/uploads/whformula_2026.pdf (pre-cut) ; cross-check https://taxnews.ey.com/news/2026-1239-arkansas-law-lowers-top-individual-income-tax-rate-retroactive-to-january-1-2026

**CA — brackets, H has its own table (TY2026, FTB October 2026).**
- S, top of each bracket: 1% to $11,456, 2% to $27,157, 4% to $42,861, 6% to $59,498, 8% to $75,197, 9.3% to $384,109, 10.3% to $460,927, 11.3% to $768,213, 12.3% above.
- J: $22,912 / $54,314 / $85,722 / $118,996 / $150,394 / $768,218 / $921,854 / $1,536,426.
- H: $22,927 / $54,316 / $70,018 / $86,654 / $102,356 / $522,385 / $626,864 / $1,044,771.
- SD $5,900 for S/MFS, $11,800 for J/H.
- Exemption credits: $158 for S/H, $316 for J, $491 per dependent.
- An extra 1% Mental Health Services Tax applies over $1M.
- Source: https://www.ftb.ca.gov/about-ftb/newsroom/tax-news/2026/10.html

**CO — flat 4.4% (TY2025).**
- Starts from federal taxable income. No state SD.
- Adds back QBI above $500k (S) or $1M (J).
- The 2026 rate and the November 2026 ballot measure (Amendment 87, graduated from 2027) are UNVERIFIED.
- Local occupational privilege taxes exist (Denver, Aurora).
- Source: https://tax.colorado.gov/individual-income-tax-guide

**CT — brackets, H has its own table (TY2025).**
- S: 2% to $10k, 4.5% to $50k, 5.5% to $100k, 6% to $200k, 6.5% to $250k, 6.9% to $500k, 6.99% above.
- J: double the S thresholds.
- H: $16k / $80k / $160k / $320k / $400k / $800k.
- Starts from federal AGI. No SD.
- The personal exemption phases out: S $15,000 from AGI $30k, J $24,000 from $48k, H $19,000 from $38k.
- Also has a 2% phase-out add-back, benefit recapture, and a personal tax credit tied to AGI.
- Source: https://portal.ct.gov/-/media/drs/forms/2025/income/ct-1040-tcs_1225.pdf

**DE — brackets, one table (statutory).**
- 0% to $2k, 2.2% to $5k, 3.9% to $10k, 4.8% to $20k, 5.2% to $25k, 5.55% to $60k, 6.6% above.
- SD $3,250 for S/H, $6,500 for J. Personal credit $110 each. Starts from federal AGI.
- Wilmington has a city earned income / net profits tax (rate UNVERIFIED).
- Sources: https://delcode.delaware.gov/title30/c011/sc01/index.html ; https://revenuefiles.delaware.gov/2025/PITForms_Instructions/Instructions/PIT-RES_Instructions_2025-01.pdf

**DC — brackets, one table.**
- 4% to $10k, 6% to $40k, 6.5% to $60k, 8.5% to $250k, 9.25% to $500k, 9.75% to $1M, 10.75% above.
- SD tied to the federal amount: UNVERIFIED.
- **Self-employed:** the Unincorporated Business Franchise Tax applies when gross receipts are over $12,000. It is 8.25% after a 30% owner allowance and a $5,000 exemption, with a $250 minimum. How it interacts with the individual return is UNVERIFIED.
- Sources: https://otr.cfo.dc.gov/page/dc-individual-and-fiduciary-income-tax-rates ; https://otr.cfo.dc.gov/page/dc-business-franchise-tax-rates

**FL — no tax.**
- Florida's corporate tax does not apply to a sole proprietor or a default single-member LLC.
- Source: https://floridarevenue.com/faq/Pages/FAQDetails.aspx?FAQID=1466

**GA — flat 4.99% (TY2026).**
- SD $15,000 for S/H/MFS, $30,000 for J.
- UNVERIFIED: the bill citation, the $5,000 dependent exemption, and the federal-AGI start.
- Source: https://dor.georgia.gov/taxes/important-tax-updates

**HI — brackets, H has its own table (2025 brackets, also used for 2026).**
- S: 1.4% to $9,600, 3.2% to $14,400, 5.5% to $19,200, 6.4% to $24,000, 6.8% to $36,000, 7.2% to $48,000, 7.6% to $125,000, 7.9% to $175,000, 8.25% to $225,000, 9% to $275,000, 10% to $325,000, 11% above.
- J: double the S thresholds. H: 1.5 times the S thresholds.
- 2026 SD: $8,000 S, $16,000 J, $12,000 H. Exemption $1,144.
- Sources: https://files.hawaii.gov/tax/news/announce/ann24-03.pdf ; https://files.hawaii.gov/tax/forms/2025/n11_i.pdf

**ID — 5.3% above a zero bracket (TY2025 form; the rate is unchanged in 2026).**
- 2025: 5.3% × (taxable income − $4,811) for S, or − $9,622 for J/H.
- SD equals the federal amount.
- 2026 zero-bracket amounts: UNVERIFIED.
- Source: https://tax.idaho.gov/document-mngr/forms_EIN00046

**IL — flat 4.95%.**
- No SD. Exemption $2,925 per person for 2026. The exemption is lost above AGI of $250k (S) or $500k (J) (2025 limits).
- Sources: https://tax.illinois.gov/research/taxrates/income.html ; https://tax.illinois.gov/research/publications/bulletins/fy-2026-15.html

**IN — flat 2.95% (TY2026).**
- Starts from federal AGI. The $1,000 exemption is UNVERIFIED.
- **Every county levies a county income tax** (about 0.5-3%).
- Source: https://www.in.gov/dor/resources/tax-rates-and-reports/rates-fees-and-penalties/

**IA — flat 3.8% (TY2026).**
- Starts from federal taxable income.
- A school district surtax (up to 20% of state tax) and an EMS surtax exist.
- The exemption credit is UNVERIFIED.
- Sources: https://revenue.iowa.gov/press-release/2025-10-21/idr-announces-2026-individual-income-tax-and-interest-rates ; https://revenue.iowa.gov/iowa-tax-fee-descriptions-and-rates

**KS — brackets (rates TY2026, deductions TY2025).**
- S/H/MFS: 5.2% to $23,000, 5.58% above. J: 5.2% to $46,000, 5.58% above.
- SD: $3,605 S, $8,240 J, $6,180 H.
- Exemption allowance: $9,160 for S/H, $18,320 for J, plus $2,320 per dependent.
- 2026 deductions: UNVERIFIED.
- Sources: https://www.ksrevenue.gov/pdf/ip25.pdf ; https://ksrevenue.gov/taxnotices/notice25-06.pdf

**KY — flat 3.5% (TY2026).**
- SD $3,360. Starts from federal AGI.
- **Local occupational license taxes apply to SE net profits.**
- Source: https://revenue.ky.gov/News/Pages/Kentucky-DOR-Announces-2026-Standard-Deduction.aspx

**LA — flat 3% (from TY2025).**
- SD 2025: $12,500 for S/MFS, $25,000 for J/H. It is indexed for 2026, but the final 2026 amount is UNVERIFIED.
- No personal exemption.
- Sources: https://revenue.louisiana.gov/tax-education-and-faqs/faqs/income-tax-reform/what-are-the-individual-income-tax-rates-and-brackets/ ; https://dam.ldr.la.gov/lawspolicies/RIB-25-012-Louisiana-Individual-Income-Tax-Reform-1.pdf

**ME — brackets, H has its own table (TY2026).**
- S: 5.8% to $27,400, 6.75% to $64,850, 7.15% above.
- J: $54,850 / $129,750. H: $41,100 / $97,300.
- Exemption $5,300.
- The SD conflicts between sources ($15,300 or $15,700 for S) and phases out at high income.
- A new 2% surcharge applies over $1M.
- UNVERIFIED: the official PDF was blocked, so the tables came from a secondary source.
- Sources: https://www.maine.gov/revenue/sites/maine.gov.revenue/files/2026-05/ind_tax_rate_sched_2026_rev.pdf ; cross-check https://tax.thomsonreuters.com/news/maine-announces-individual-income-tax-rate-schedules-personal-exemption-standard-deduction-for-2026/

**MD — brackets; H shares the J table (TY2025 onward).**
- S: 2% to $1k, 3% to $2k, 4% to $3k, 4.75% to $100k, 5% to $125k, 5.25% to $150k, 5.5% to $250k, 5.75% to $500k, 6.25% to $1M, 6.5% above.
- J/H: the same to $3k, then $150k / $175k / $225k / $300k / $600k / $1.2M.
- SD 2025: $3,350 S, $6,700 J/H. The 2026 amount is UNVERIFIED. Exemption $3,200.
- **County income tax up to 3.30% for every resident.**
- Source: https://www.marylandcomptroller.gov/content/dam/mdcomp/md/state-payroll/memos/2026/2026-maryland-state-and-local-withholding-information.pdf

**MA — flat 5%, plus a 4% surtax over $1,107,750 (TY2026).**
- No SD. Exemption: $4,400 S, $8,800 J, $6,800 H.
- Massachusetts computes its own gross income.
- The figures came from snippets (mass.gov blocked direct fetch), so they are UNVERIFIED-official.
- Sources: https://www.mass.gov/info-details/4-surtax-on-taxable-income-over-1000000 ; https://www.mass.gov/info-details/view-massachusetts-personal-income-tax-exemptions

**MI — flat 4.25% (TY2026).**
- Exemption $5,900. No SD.
- **24 cities tax residents' wages and business profits** (Detroit and others).
- Source: https://www.michigan.gov/treasury/reference/taxpayer-notices/2026/04/15/425-income-tax-rate-for-individuals-and-fiduciaries-in-2026-tax-year

**MN — brackets, H has its own table (TY2026).**
- Rates: 5.35% / 6.80% / 7.85% / 9.85%.
- S: $33,310 / $109,430 / $203,150. J: $48,700 / $193,480 / $337,930. H: $41,010 / $164,800 / $270,060.
- SD: $15,300 S, $30,600 J, $23,000 H. The phase-out is UNVERIFIED.
- Source: https://www.revenue.state.mn.us/mndor-pp/21641?type=html

**MS — 0% on the first $10,000, then 4% (TY2026).**
- Exemption: $6,000 S, $12,000 J, $8,000 head of family.
- SD: $2,300 S, $4,600 J, $3,400 head of family.
- Source: https://www.dor.ms.gov/general-information

**MO — brackets, one table.**
- Withholding 2026: 0% to $1,348, then 2% to 4.5% in $1,348 steps, then 4.7% above $9,436.
- SD equals the federal amount.
- Kansas City and St. Louis levy a 1% earnings tax.
- The final 2026 return thresholds are UNVERIFIED.
- Sources: https://dor.mo.gov/taxation/individual/tax-types/income/year-changes/ ; https://dor.mo.gov/forms/4282_2026.pdf

**MT — brackets (TY2026).**
- 4.7%, then 5.65% above $47,500 S, $71,250 H, $95,000 J.
- Starts from federal taxable income. That there is no separate exemption is UNVERIFIED.
- Source: https://revenue.mt.gov/news/recent-news/HB-337

**NE — brackets, H has its own table (TY2026, official DRAFT).**
- S: 2.46% to $4,130, 3.51% to $24,760, 4.55% above.
- J: $8,250 / $49,530. H: $7,700 / $39,620.
- SD: $8,850 S, $17,700 J, $12,950 H. Exemption credit $176.
- Sources: https://revenue.nebraska.gov/sites/default/files/doc/tax-forms/drafts/2026_tax_calculation_schedule.pdf ; https://revenue.nebraska.gov/sites/default/files/doc/tax-forms/drafts/f_1040n.pdf

**NV — no tax.**
- Source: https://tax.nv.gov/about-nevada-department-of-taxation/income-tax-in-nevada

**NH — no tax on wages or SE income.**
- The interest and dividends tax was repealed from TY2025.
- The official page was blocked (403), so this is UNVERIFIED-official.
- Source: https://revenue.nh.gov/taxes-glance/interest-dividends-tax

**NJ — brackets ("2020 and after").**
- S: 1.4% to $20k, 1.75% to $35k, 3.5% to $40k, 5.525% to $75k, 6.37% to $500k, 8.97% to $1M, 10.75% above.
- J/H: 1.4% to $20k, 1.75% to $50k, 2.45% to $70k, 3.5% to $80k, 5.525% to $150k, 6.37% to $500k, 8.97% to $1M, 10.75% above.
- NJ uses its own gross income. No SD. Exemption $1,000 each.
- Source: https://nj.gov/treasury/taxation/pdf/current/njtaxratesch.pdf

**NM — brackets (from TY2025).**
- S: 1.5% to $5,500, 3.2% to $16,500, 4.3% to $33,500, 4.7% to $66,500, 4.9% to $210,000, 5.9% above.
- J/H: $8,000 / $25,000 / $50,000 / $100,000 / $315,000.
- That the SD equals the federal amount is UNVERIFIED. The rate table was read on an NBER mirror.
- Source: https://www.tax.newmexico.gov/individuals/personal-income-tax-information/

**NY — brackets, H has its own table (TY2026, Tax Law §601).**
- S: 3.9% to $8,500, 4.4% to $11,700, 5.15% to $13,900, 5.4% to $80,650, 5.9% to $215,400, 6.85% to $1,077,550, 9.65% to $5M, 10.3% to $25M, 10.9% above.
- J: $17,150 / $23,600 / $27,900 / $161,550 / $323,200 / $2,155,350.
- H: $12,800 / $17,650 / $20,900 / $107,650 / $269,300 / $1,616,450.
- SD 2025: $8,000 S, $16,050 J, $11,200 H. That 2026 is the same is UNVERIFIED.
- A supplemental recapture tax applies above $107,650 AGI.
- **NYC and Yonkers resident taxes, and the MCTMT on SE earnings over $50k.**
- Sources: https://www.nysenate.gov/legislation/laws/TAX/601 ; https://www.tax.ny.gov/pit/file/standard_deductions.htm

**NC — flat 3.99% (TY2026).**
- SD 2025: $12,750 S, $25,500 J, $19,125 H. That 2026 is the same is UNVERIFIED.
- Sources: https://ncdor.gov/taxes-forms/individual-income-tax/estimated-income-tax/2026-individual-income-tax-estimator-worksheet ; https://www.ncdor.gov/taxes-forms/individual-income-tax/filing-topics/north-carolina-standard-deduction-or-north-carolina-itemized-deductions

**ND — brackets with a 0% bracket (TY2026).**
- S: 0% to $49,575, 1.95% to $250,400, 2.5% above.
- J: $82,800 / $304,850. H: $66,400 / $277,600.
- Starts from federal taxable income.
- Source: https://www.tax.nd.gov/sites/www/files/documents/forms/individual/2025-iit/28709-form-nd-1es-2026.pdf

**OH — effectively flat (TY2026, official DRAFT).**
- $0 up to $26,050. Above that, $332 + 2.75% of the excess.
- **Business income deduction:** the first $250,000 of business income is deducted, and the rest is taxed at a flat 3%.
  - This is very important for owner-operators: most of their income is business income.
- The exemption depends on MAGI ($2,400 / $2,150 / $1,900).
- Municipal and school district income taxes apply to net profits.
- The $332 vs $360.69 base conflict is UNVERIFIED.
- Source: https://dam.assets.ohio.gov/image/upload/tax.ohio.gov/forms/DRAFTS/2026/it1040-booklet-draft.pdf

**OK — brackets (TY2026; thresholds INFERRED from the official table).**
- S: 0% to $3,750, 2.5% to $4,900, 3.5% to $7,200, 4.5% above.
- J/H: $7,500 / $9,800 / $14,400.
- SD: $6,350 S, $12,700 J, $9,350 H. Exemption $1,000.
- Source: https://oklahoma.gov/content/dam/ok/en/tax/documents/forms/software-developers/Dev511-Pkt-26.pdf

**OR — brackets (TY2026, the state's own ESTIMATED indexed figures).**
- S: 4.75% to $4,550, 6.75% to $11,400, 8.75% to $125,000, 9.9% above.
- J/H: $9,100 / $22,800 / $250,000.
- Starts from federal taxable income with modifications.
- SD: $2,900 S, $5,800 J, $4,650 H. Exemption credit $260.
- A federal tax subtraction of up to $8,750 applies.
- TriMet and Lane Transit SE taxes, Metro SHS and Multnomah PFA also exist.
- Source: https://www.oregon.gov/dor/forms/FormsPubs/publication-or-estimate_101-026_2026.pdf

**PA — flat 3.07%.**
- PA taxes its own income classes. No SD and no exemption.
- **Local EIT on net profits.** Philadelphia has its own tax.
- Source: https://www.pa.gov/en/agencies/revenue/resources/tax-rates.html

**RI — brackets, one table (TY2026).**
- 3.75% to $82,050, 4.75% to $186,450, 5.99% above.
- SD: $11,200 S, $22,400 J, $16,800 H. Exemption $5,250.
- Both phase out between $261,000 and $290,800 MAGI.
- Source: https://tax.ri.gov/sites/g/files/xkgbur541/files/2025-11/ADV_2025_22_Inflation_Adjustments.pdf

**SC — brackets, one table (TY2026, Act 110).**
- 1.99% to $29,999. From $30,000: 5.21% minus $966.
- Starts from federal AGI with a new SCIAD deduction: $15,000 S, $30,000 J, $22,500 H, phasing out by AGI.
- Whether the optional 3% active trade or business rate (I-335) still applies for 2026 is UNVERIFIED.
- Source: https://dor.sc.gov/sites/dor/files/policies/IL26-20.pdf

**SD — no tax.**
- The official page confirms only that there is no corporate tax. No personal tax is confirmed by secondary sources only (UNVERIFIED-official).
- Source: https://dor.sd.gov/businesses/taxes/

**TN — no tax.**
- The Hall tax was repealed from 2021. The franchise and excise tax applies to LLCs (not researched).
- Source: https://revenue.support.tn.gov/hc/en-us/sections/200489699-Hall-Income-Tax

**TX — no tax.**
- The franchise tax no-tax-due threshold is $2,650,000.
- That a sole proprietor is exempt while an LLC must file a report is UNVERIFIED.
- Source: https://comptroller.texas.gov/taxes/franchise/

**UT — flat 4.45% (TY2026, SB 60).**
- Starts from federal AGI. No SD.
- A taxpayer credit of 6% of the federal deduction is reduced by 1.3% above a base amount. 2025 bases: $18,213 S, $36,426 J, $27,320 H. The 2026 bases are UNVERIFIED.
- Sources: https://le.utah.gov/Session/2026/bills/enrolled/SB0060.pdf ; https://files.tax.utah.gov/tax/forms/current/tc-40.pdf

**VT — brackets, H has its own table (TY2025; no official 2026 schedule found).**
- S: 3.35% to $49,400, 6.60% to $119,700, 7.60% to $249,700, 8.75% above.
- J: $82,500 / $199,450 / $304,000. H: $66,200 / $171,000 / $276,850.
- SD: $7,650 S, $15,300 J, $11,450 H. Exemption $5,300.
- A 3%-of-AGI minimum tax applies above $150k.
- Source: https://tax.vermont.gov/sites/tax/files/documents/TaxRateSched-2025.pdf

**VA — brackets, one table.**
- 2% to $3,000, 3% to $5,000, 5% to $17,000, 5.75% above.
- SD 2026: $8,750 S, $17,500 J. That H uses the S amount is UNVERIFIED. Exemption $930.
- Sources: https://law.lis.virginia.gov/vacode/title58.1/chapter3/section58.1-320/ ; https://law.lis.virginia.gov/vacode/title58.1/chapter3/section58.1-322.03/

**WA — no tax on wages or SE income in 2026.**
- The capital gains excise does not reach wages or SE income.
- A 9.9% tax on income over $1M is planned from 2028 (ESSB 6346).
- The B&O gross receipts tax applies to businesses; its threshold is UNVERIFIED.
- Source: https://dor.wa.gov/taxes-rates/income-tax

**WV — brackets, one table (TY2026, SB 392).**
- 2.11% to $10k, 2.81% to $25k, 3.16% to $40k, 4.22% to $60k, 4.58% above.
- Exemption $2,000 (the 2026 amount is UNVERIFIED). No SD.
- Source: https://tax.wv.gov/Individuals/Pages/PersonalIncomeTaxReductionBill.aspx

**WI — brackets; S and H share Schedule A (TY2026).**
- S/H: 3.5% to $15,110, 4.4% to $51,950, 5.3% to $332,720, 7.65% above.
- J: $20,150 / $69,260 / $443,630.
- The sliding SD reaches 0 at $136,453 (S) and $159,690 (J). Exemption $700.
- Source: https://www.revenue.wi.gov/TaxForms2026/2026-Form1-ES-Inst.pdf

**WY — no tax.**
- Confirmed by secondary sources only (UNVERIFIED-official).
- Cross-check: https://www.aarp.org/money/taxes/states-without-an-income-tax/

### Not yet official or still open (Nov 2026)

- **DRAFT or ESTIMATED:** NE, OH and OR.
- **INFERRED:** the OK bracket cut points.
- **Return figures not yet published:** AR (rate cut), MO and LA. The only 2026 figures for these are from withholding.
- **Still on 2025 figures:** AL, AZ, CO, CT, DE, ID, KS (deductions), VT, and the NC/NY standard deductions.
- **Already scheduled for 2027 or later:** CO (ballot, 2027), HI (13% from 2027), WA (2028), the NY cuts (2027), and the NC cuts.

---

## 3. Proposed design

### Data model

The state rules stay **server-side** in `tax_year_data.state_tax` (invariant #6: no tax constant in app code). There is one row per tax year, as today, so this adds no new table.

The existing jsonb gains a versioned `states` map. The old keys stay readable during the transition, so the client works before and after the SQL.

```jsonc
"state_tax": {
  "version": 2,
  "states": {
    "OH": {
      "name": "Ohio",
      "kind": "flat",                     // none | flat | brackets
      "starts_from": "federal_agi",       // federal_agi | federal_taxable | own_income (approximated by federal_agi)
      "rate": 0.0275,                     // flat only
      "zero_band": { "single": 26050, "mfj": 26050, "hoh": 26050 },
      "band_base_tax": 332,               // tax owed at the top of the zero band (OH); optional
      "brackets": null,                   // brackets only: { single: [[lo, hi|null, rate], ...], mfj, hoh }
      "standard_deduction": { "single": 0, "mfj": 0, "hoh": 0 },
      "personal_exemption": { "single": 2400, "mfj": 4800, "hoh": 2400 }, // amount subtracted, simplified
      "simplified": ["business income deduction", "MAGI-tiered exemption", "municipal/school district taxes"],
      "figures_year": 2026,               // can be older than the row's tax year (e.g. VT 2025)
      "status": "draft",                  // official | draft | estimated | unverified
      "source_url": "https://dam.assets.ohio.gov/...it1040-booklet-draft.pdf",
      "checked_on": "2026-11-24"
    }
  }
}
```

Rules for this shape:

- **Filing status:** keep the three statuses the app has (single, mfj, hoh). Adding MFS is a separate decision, because it touches `tax_config`, the federal tables and the UI.
- **All 51 jurisdictions get an entry.** A code with no entry is not a valid choice in the picker. The engine then returns label `noData` and $0, with a visible "no state data for X" note. It is never a silent 4.5%.
- **`fallback_effective_rate` is retired** from new rows. A guessed number for 35 states breaks "never guess".

### Where the user picks the state, and the default

- **One shared picker component:** a `ModalSheet` listing the 51 full names ("Ohio (OH)"), with a search field.
  - It is used in three places: Tax Estimator > Filing status & home state, Settings > Business profile, and onboarding.
  - The 51 codes and names are geography, not tax constants, so they can live in app code (e.g. `src/lib/usStates.ts`). Every tax rule comes from the server.
- **One source of truth:** the engine keeps reading `tax_config.state`. Every screen that saves a state writes both `tax_config.state` and `profiles.home_state`.
  - This means the Tax Estimator gains the `profiles` write it lacks today.
- **Default: none.** Drop the `|| 'TX'` fallbacks and the "TX" placeholders.
  - When no state is set, the state line reads "Choose your home state" and shows a button. It adds $0 and gets a visible label.
  - The existing "home state not set" nudge keeps working.
- **Existing users keep their stored value.** Because the DB default is 'TX', "TX by default" and "TX chosen" cannot be told apart.
  - So the estimator always shows the state's full name next to the result ("Texas — no state income tax"). A wrong state is then visible at a glance.
  - Changing the DB column defaults to null is optional SQL for a later section. It must not run before the client handles null.

### How the result is shown

The result splits into a Federal block and a State block, with the same rows and colours as today.

- **Federal:**
  - SE tax.
  - Federal income tax.
  - These numbers are unchanged.
- **State — "<State name> (XX)", one of four cases:**
  - **No-tax state:** "No state income tax on wages or self-employment income — $0".
  - **Taxing state:**
    - "~ Estimated state income tax $X".
    - A muted line explaining the method in one sentence. Example: "Flat 2.75% above $26,050 · 2026 figures (draft)".
  - **`status` is not `official`, or `simplified` is not empty:**
    - The label says "rough estimate" in text, not just in colour.
    - The simplified items are listed: "Not included: business income deduction, city/school district taxes".
  - **No state set:** "Choose your home state" plus a button.
- **Total:** "~ Estimated total (federal + SE + state)". The quarterly and weekly lines stay totals.
  - Optionally, show the quarterly amount split into "to the IRS" and "to <state>" (one more display row). These are separate payments with separate due dates.

**"Estimate only" wording (invariant #8)**

- The existing footnote stays.
- Add a state footnote: "State estimate covers your home state's income tax only. It does not include city or county taxes, taxes of other states you drive through, or business taxes (e.g. DC UBT, Texas franchise tax). Verify with your CPA."

**Source note on each state**

- A muted line: "Source: <host of source_url> · figures for <figures_year> · checked <checked_on>". The host is tappable and opens the URL.
- When `figures_year` is older than the tax year: "Uses <year> figures — <year+1> not yet published".

### How the data is updated each year

1. **Keep a reviewable copy of the seed in the repo:** `docs/state-tax/<year>.json`. It is the same shape as above and holds all 51 entries. Each entry carries its own `source_url`, `status` and `checked_on`.
   - The app never imports this file. It is the admin's working copy, and a jest test validates it (section 5).
2. **Each December to February,** as states publish:
   - The admin re-checks each state against its official source.
   - They update `figures_year`, `status` and `checked_on`.
   - They write a PENDING_SQL section that upserts that year's `tax_year_data.state_tax`. The owner runs it.
   - This follows `docs/ADMIN_RUNBOOK.md`; add a "states" checklist there.
3. **Mid-year changes** (retroactive cuts like AR, UT, SC and WV in 2026): the same flow, applied as soon as they are seen.
4. **Year fallback:** unchanged. A missing year uses the latest published row with the existing banner. Inside a row, each state shows its own `figures_year`.

---

## 4. Scope options

### (A) One effective rate per state

- **What it is:** each taxing state gets one number × federal taxable income. That is today's model, but with 51 numbers instead of 1 fallback.
- **Cost:** small. About 51 numbers, the picker and the display, so about 1-2 days.
- **Risk:** high error and no citable source.
  - No state publishes an "effective rate". It depends on income and filing status, so every number would be our own guess. That conflicts with "never guess a number" and with the source note.
  - It is wrong in the direction that matters: too low at higher incomes in bracket states, and too high for low incomes.

### (B) Full model for every state

- **What it is:**
  - Exact brackets, deductions and exemptions per state.
  - The starting point per state.
  - Phase-outs: CT, AL, WI, SC, RI and MD.
  - Credits: UT, CA, NE and OR.
  - Recapture: NY and CT.
  - Surtaxes: MA, CA and ME.
  - The Ohio business income deduction and the DC UBT.
- **Cost:** high. Many state-specific code paths, plus a much larger yearly verification job.
- **Risk:** high complexity. Many 2026 figures are still draft or unverified (section 2). The more we model, the more precise-looking numbers can be wrong.

### (C) Hybrid — RECOMMENDED

**What it includes:**
- Every state gets its official kind:
  - none, flat, or brackets, with the full bracket table for each filing status;
  - the starting point;
  - one standard deduction and one personal exemption per filing status;
  - an optional zero band and base tax (OH, MS, ID).

**What it leaves out:**
- Phase-outs, credits, recapture, surtaxes and special business rules are not modelled.
- They are listed in `simplified`, and the UI shows them as "Not included".

**Cost:** medium.
- One generic engine path, reusing the existing bracket loop.
- 51 data entries.
- The picker and the display.

**Risk:** moderate and visible.
- No-tax states are exactly $0. Flat states come out close. Bracket states are near the right range for typical owner-operator incomes ($50k-$150k).
- Every state that is not exact says so on screen, and every number has a source.

**Why I recommend C:** it meets the owner's request:
- all 51 states can be picked;
- states without income tax are exactly right;
- every number is cited and dated;
- every simplification is visible.

It also avoids B's maintenance load. A single state can later be upgraded toward B where it matters most for users. Ohio is the first candidate, because its business income deduction can bring an owner-operator to about $0.

### Out of scope for a first version (any option)

- **Non-resident returns.** These are states a trucker only drives through or delivers in, plus apportionment and credits for taxes paid to other states.
  - Federal law (49 U.S.C. 14503) limits non-resident taxation of interstate motor carrier "employees". Whether it covers an owner-operator who is an independent contractor is UNVERIFIED here and is a CPA question.
- **Local, city, county and school district income taxes.**
  - IN counties, MD counties, OH municipal and school districts, PA EIT and Philadelphia, NYC and Yonkers, NY MCTMT, MI cities, KY occupational taxes, MO Kansas City and St. Louis, OR transit and Metro/Multnomah, Wilmington DE, AL occupational, CO occupational privilege.
- **Business-level taxes:** DC UBT, Texas franchise tax, WA B&O, TN franchise and excise.
- **Part-year residency**, or moving states mid-year.
- **Married filing separately**, itemized deductions, state credits (EITC, child credits) and S-Corp PTE elections.
- **State estimated-tax due dates.** The quarterly schedule stays federal.
- **Capital gains rules** (WA, MD, MT).

---

## 5. Keeping every federal number unchanged; tests

### Federal numbers stay unchanged

- Change **only** `stateTax.ts` and the state display.
  - `calcTaxEstimate.ts` keeps lines 39-58 as they are: profit share, SE tax, AGI, federal standard deduction, federal taxable income and federal tax.
  - The state function receives `agi` and `taxableIncome` as extra inputs instead of just `taxableIncome`. Nothing it returns feeds back into the federal values.
- `totalTax`, quarterly, weekly reserve and effective rate **will change for users in taxing states**, because their state part changes.
  - That is the intended result. It must be named in the ship list, and it needs the owner's approval before it ships.
  - For Texas and the other no-tax states, these numbers stay identical.

### Order of commits (one change each, tsc + full jest after each)

1. **Pin first.** Add a "federal invariance" test before any engine change.
   - A matrix of fixed inputs (net profit 0 / 45k / 90k / 180k × single/mfj/hoh × sole_prop/scorp/multi_member_llc).
   - It asserts the literal current values of `seTax`, `seTaxDeduction`, `agi`, `standardDeduction`, `taxableIncome` and `federalTax`.
   - It must pass on today's code. Every later commit keeps it green unchanged.
2. **Engine reads the v2 shape, with the old shape still supported.**
   - The existing 10 `stateTax.test.ts` tests stay green on the old fixture.
   - New v2 fixture tests are added.
3. **The shared state picker**, plus the `profiles.home_state` write in the Tax Estimator, plus removing the 'TX' fallbacks.
4. **The state block display** (name, method, source, "not included" list, footnote) in all 7 locales.
5. **Docs:** the seed JSON and the validation test, the PENDING_SQL section (NOT YET APPLIED), and the runbook checklist.

### New tests needed

- **Engine, v2:**
  - `none` returns $0.
  - `flat` with a zero band and base tax (OH example from the official booklet: income $50,000 gives $332 + 2.75% × 23,950).
  - `brackets` per filing status (hand-checked values: NY, CA and WI at $60k and $120k).
  - The starting point: `federal_taxable` uses the federal taxable income, and `federal_agi` subtracts the state's standard deduction and exemption.
  - A deduction larger than income gives $0, never a negative number.
  - A missing state gives label `notSet` and $0.
  - An unknown code gives label `noData` and $0, never 4.5%.
  - `status` other than official, or a non-empty `simplified`, gives label `estimate`.
- **Federal invariance:** for every state in the v2 fixture, the federal fields equal the values for state = TX and for includeStateTax = false.
- **Seed validation** (`docs/state-tax/<year>.json`):
  - exactly 51 codes, all 50 states plus DC;
  - each entry has an https `source_url`, a `status`, `checked_on` and `figures_year`;
  - rates are between 0 and 0.15;
  - brackets start at 0, are contiguous and ascending, end with `null`, and each filing status is present;
  - the no-tax set equals {AK, FL, NV, NH, SD, TN, TX, WA, WY}.
- **UI and logic:**
  - The picker lists 51 names.
  - Saving writes both `tax_config.state` and `profiles.home_state`.
  - No `|| 'TX'` remains (a source-check test, the same pattern as the dateOnly/number source checks).
- **i18n:** new keys in all 7 locales. The glossary test is unaffected. State names stay English, because they are proper names.

### Ship list for implementation (later, not now)

- **PENDING_SQL:**
  - one section upserting the 2026 `state_tax` v2 data;
  - optionally a later section changing the `tax_config.state` and `profiles.home_state` defaults to null.
- **Edge Functions:** none.
- **App delivery:** ships via `eas update`. No native build is needed.
