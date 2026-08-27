-- docs/PENDING_SQL.md §67 — ONE-TIME DATA REPAIR (not a schema change; no
-- ALTER TABLE). Re-classifies already-imported settlement-withheld
-- deduction rows still sitting in "Misc" (or with no category at all)
-- using the CORRECTED, now-unified classification rules from
-- app/src/import/category.ts's classifySettlementLine() — see CLAUDE.md's
-- own dated entry for this pass for the full rationale (classifySettlementLine()
-- and guessCategory() used to disagree on IRP/IFTA/HVUT/2290/ELD and 3
-- other shared categories; both now call the same shared isXxx()
-- functions, but a row imported BEFORE this fix landed is still stuck
-- with the old, wrong classification forever unless re-run through the
-- corrected rules once).
--
-- SCOPE, deliberately narrow: only rows where source = 'settlement' (a
-- carrier-withheld chargeback line — the exact case classifySettlementLine()
-- exists for) AND category is null or 'Misc' (never touches a row that
-- already has a real, possibly user-corrected category — including a
-- DIFFERENT valid category the AI already got right the first time).
-- Out-of-pocket 'Misc' rows are NOT touched here — those go through
-- guessCategory() (vendor/store name aware, not description-text-only)
-- at import time, a different classifier this migration doesn't attempt
-- to re-run retroactively.
--
-- SAFE TO RE-RUN: the UPDATE's own WHERE clause only ever matches rows
-- where the corrected classification would actually CHANGE the stored
-- value — a second run finds zero rows left to touch.
--
-- REVIEW BEFORE RUNNING: this was assembled by hand-translating the JS
-- regexes in app/src/import/category.ts into PostgreSQL POSIX-ERE syntax
-- (\b -> \y for word boundaries) — NOT executed against a live database
-- in this environment (no service_role/db credentials here). Run the
-- PREVIEW query first and read its output before running the UPDATE.

-- ============================================================
-- PREVIEW (read-only) — run this first. Shows old_category ->
-- new_category with row counts and dollar totals so you can sanity-check
-- the reclassification before committing to it.
-- ============================================================
select
  category as old_category,
  case
    when description ~* '\ylumper\y' then 'Lumper Fees'
    when description ~* '\yadvance\y|\yadv\y' then 'Advance Repayment'
    when description ~* 'perform\w*\s*bond|escrow|maint\w*\s*rese?rv\w*|tire\s*f(u|n)nd|emergency\s*f(u|n)nd' then 'Escrow & Deposits'
    when description ~* 'extended warranty|service contract|warranty (plan|purchase|contract)' then 'Warranty & Service Contracts'
    when description ~* 'trust service|\ybookkeep|legal|attorney|lawyer|llc filing|llc formation|registered agent|secretary of state|abacus|tax prep|\ycpa\y|drug (and alcohol )?consortium|drug testing consortium' then 'Legal & Professional Services'
    when description ~* '\ybt\W?dh\s*ins\y|\yphy\.?\s*dam(age)?\y|physical\s*damage|\yocc(up)?\.?\s*acc(ident)?\y|occupational\s*accident|\yworkers.?\s*comp(ensation)?\y|\ybobtail\y|\ycargo\y|\yinsurance\y|\ypremium\y|\ypolicy\y' then 'Insurance—Truck'
    when description ~* 'fed\.?\s*h?wy\.?\s*tax|federal highway (use )?tax|\ylicens\w*\y|\ypermits?\y|\yirp\y|\yifta\y|\yhvut\y|form\s*2290|\y2290\y|\yucr\y|dot number|mc number|boc-?3|\ycdl\y|dot physical|\ykyu\y|ny-?hut|nm-?wdt|weight.?mile tax' then 'Permits, Licenses & Road Taxes'
    when description ~* 'qual\w*\s*rental|geo\w*\s*rental|navigation charge|\yeld\y|communications?\s*charge|\yelog\y|motive|keeptruckin|samsara|omnitracs|peoplenet|qualcomm|e-?log device|trucker path|garmin|rand mcnally|hammer.?maps?|maps? (subscription|purchase|app)|gps (app|subscription|unit|device)|dat load|truckstop\.com|load board' then 'ELD & Communications'
    when description ~* 'prepass|pre-pass|drivewyze|\yscale\y|weigh station|ezpass|e-zpass' then 'Tolls & Scales'
    when description ~* 'company store' then 'Truck Supplies & Equipment'
    when description ~* 'bank fee|wire fee|merchant fee|processing fee|overdraft|nsf fee|card fee' then 'Bank & Merchant Fees'
    when description ~* '\yrestaurant\y|\ycafe\y|\ycaf[eé]\y|\ydiner\y|pizzeria|steakhouse|\ybuffet\y|bar\s*&\s*grill|\ygrill\s*(house|room|shack)\y|\ybbq\y|barbeque|\ytaco bell\y|\ysubway\y|\ymcdonald''?s?\y|burger king|wendy''?s|chili''?s|cracker barrel|waffle house|denny''?s|\yihop\y|popeyes|\ykfc\y|pizza hut|domino''?s|papa john''?s|starbucks|dunkin|food truck|drive-?thru|fast food|\ycatering\y|\yeatery\y|\ybistro\y' then 'Meals (per diem covered)'
    else category
  end as new_category,
  count(*) as row_count,
  sum(amount) as total_amount
from deductions
where source = 'settlement'
  and (category is null or category = 'Misc')
  and description is not null
group by 1, 2
order by 2, 1;

-- ============================================================
-- UPDATE — the actual one-time re-classification. Only run after
-- reviewing the PREVIEW output above.
-- ============================================================
update deductions
set category = case
    when description ~* '\ylumper\y' then 'Lumper Fees'
    when description ~* '\yadvance\y|\yadv\y' then 'Advance Repayment'
    when description ~* 'perform\w*\s*bond|escrow|maint\w*\s*rese?rv\w*|tire\s*f(u|n)nd|emergency\s*f(u|n)nd' then 'Escrow & Deposits'
    when description ~* 'extended warranty|service contract|warranty (plan|purchase|contract)' then 'Warranty & Service Contracts'
    when description ~* 'trust service|\ybookkeep|legal|attorney|lawyer|llc filing|llc formation|registered agent|secretary of state|abacus|tax prep|\ycpa\y|drug (and alcohol )?consortium|drug testing consortium' then 'Legal & Professional Services'
    when description ~* '\ybt\W?dh\s*ins\y|\yphy\.?\s*dam(age)?\y|physical\s*damage|\yocc(up)?\.?\s*acc(ident)?\y|occupational\s*accident|\yworkers.?\s*comp(ensation)?\y|\ybobtail\y|\ycargo\y|\yinsurance\y|\ypremium\y|\ypolicy\y' then 'Insurance—Truck'
    when description ~* 'fed\.?\s*h?wy\.?\s*tax|federal highway (use )?tax|\ylicens\w*\y|\ypermits?\y|\yirp\y|\yifta\y|\yhvut\y|form\s*2290|\y2290\y|\yucr\y|dot number|mc number|boc-?3|\ycdl\y|dot physical|\ykyu\y|ny-?hut|nm-?wdt|weight.?mile tax' then 'Permits, Licenses & Road Taxes'
    when description ~* 'qual\w*\s*rental|geo\w*\s*rental|navigation charge|\yeld\y|communications?\s*charge|\yelog\y|motive|keeptruckin|samsara|omnitracs|peoplenet|qualcomm|e-?log device|trucker path|garmin|rand mcnally|hammer.?maps?|maps? (subscription|purchase|app)|gps (app|subscription|unit|device)|dat load|truckstop\.com|load board' then 'ELD & Communications'
    when description ~* 'prepass|pre-pass|drivewyze|\yscale\y|weigh station|ezpass|e-zpass' then 'Tolls & Scales'
    when description ~* 'company store' then 'Truck Supplies & Equipment'
    when description ~* 'bank fee|wire fee|merchant fee|processing fee|overdraft|nsf fee|card fee' then 'Bank & Merchant Fees'
    when description ~* '\yrestaurant\y|\ycafe\y|\ycaf[eé]\y|\ydiner\y|pizzeria|steakhouse|\ybuffet\y|bar\s*&\s*grill|\ygrill\s*(house|room|shack)\y|\ybbq\y|barbeque|\ytaco bell\y|\ysubway\y|\ymcdonald''?s?\y|burger king|wendy''?s|chili''?s|cracker barrel|waffle house|denny''?s|\yihop\y|popeyes|\ykfc\y|pizza hut|domino''?s|papa john''?s|starbucks|dunkin|food truck|drive-?thru|fast food|\ycatering\y|\yeatery\y|\ybistro\y' then 'Meals (per diem covered)'
    else category
  end
where source = 'settlement'
  and (category is null or category = 'Misc')
  and description is not null
  and (case
    when description ~* '\ylumper\y' then 'Lumper Fees'
    when description ~* '\yadvance\y|\yadv\y' then 'Advance Repayment'
    when description ~* 'perform\w*\s*bond|escrow|maint\w*\s*rese?rv\w*|tire\s*f(u|n)nd|emergency\s*f(u|n)nd' then 'Escrow & Deposits'
    when description ~* 'extended warranty|service contract|warranty (plan|purchase|contract)' then 'Warranty & Service Contracts'
    when description ~* 'trust service|\ybookkeep|legal|attorney|lawyer|llc filing|llc formation|registered agent|secretary of state|abacus|tax prep|\ycpa\y|drug (and alcohol )?consortium|drug testing consortium' then 'Legal & Professional Services'
    when description ~* '\ybt\W?dh\s*ins\y|\yphy\.?\s*dam(age)?\y|physical\s*damage|\yocc(up)?\.?\s*acc(ident)?\y|occupational\s*accident|\yworkers.?\s*comp(ensation)?\y|\ybobtail\y|\ycargo\y|\yinsurance\y|\ypremium\y|\ypolicy\y' then 'Insurance—Truck'
    when description ~* 'fed\.?\s*h?wy\.?\s*tax|federal highway (use )?tax|\ylicens\w*\y|\ypermits?\y|\yirp\y|\yifta\y|\yhvut\y|form\s*2290|\y2290\y|\yucr\y|dot number|mc number|boc-?3|\ycdl\y|dot physical|\ykyu\y|ny-?hut|nm-?wdt|weight.?mile tax' then 'Permits, Licenses & Road Taxes'
    when description ~* 'qual\w*\s*rental|geo\w*\s*rental|navigation charge|\yeld\y|communications?\s*charge|\yelog\y|motive|keeptruckin|samsara|omnitracs|peoplenet|qualcomm|e-?log device|trucker path|garmin|rand mcnally|hammer.?maps?|maps? (subscription|purchase|app)|gps (app|subscription|unit|device)|dat load|truckstop\.com|load board' then 'ELD & Communications'
    when description ~* 'prepass|pre-pass|drivewyze|\yscale\y|weigh station|ezpass|e-zpass' then 'Tolls & Scales'
    when description ~* 'company store' then 'Truck Supplies & Equipment'
    when description ~* 'bank fee|wire fee|merchant fee|processing fee|overdraft|nsf fee|card fee' then 'Bank & Merchant Fees'
    when description ~* '\yrestaurant\y|\ycafe\y|\ycaf[eé]\y|\ydiner\y|pizzeria|steakhouse|\ybuffet\y|bar\s*&\s*grill|\ygrill\s*(house|room|shack)\y|\ybbq\y|barbeque|\ytaco bell\y|\ysubway\y|\ymcdonald''?s?\y|burger king|wendy''?s|chili''?s|cracker barrel|waffle house|denny''?s|\yihop\y|popeyes|\ykfc\y|pizza hut|domino''?s|papa john''?s|starbucks|dunkin|food truck|drive-?thru|fast food|\ycatering\y|\yeatery\y|\ybistro\y' then 'Meals (per diem covered)'
    else category
  end) is distinct from category;
