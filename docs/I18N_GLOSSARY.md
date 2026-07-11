# i18n DO-NOT-TRANSLATE glossary

Owner decision, extends CLAUDE.md invariant #16 ("standard financial/
trucking terms may stay English when there's no natural equivalent").
These terms are industry-standard in trucking/tax English and stay in
ENGLISH in every locale — in UI strings (`app/src/i18n/locales/*.json`)
AND in AI-generated free text (`ai-import`/`ai-advisor` responses, see
invariant #16). This is stricter than invariant #16's original
case-by-case judgment call: for this specific list, there is no
case-by-case judgment — the term is never translated, full stop.

## The glossary

per diem · coolant · DPF · DEF · ELD · IFTA · IRP · HVUT/2290 · settlement
(and its plural, "settlements") · linehaul · fuel surcharge · detention ·
layover · lumper · bobtail · deadhead · reefer · APU · CDL · DOT ·
MC number · escrow · factoring · Schedule C · 1099 · W-2 · K-1 · S-Corp ·
LLC

## How to apply it in a translated string

The glossary term itself stays in English (Latin script, exact casing
below); everything else around it translates normally. This produces
intentionally mixed-language strings — that's correct, not a bug:

- Turkish: `"DPF Temizliği"` (DPF stays, "Cleaning" translates),
  `"APU Servisi"`, `"Coolant Uzatıcı"`, `"Settlement'tan Kesilen"`
  (Turkish suffixes attach to the English loanword with an apostrophe).
- Arabic: `"تنظيف DPF"`, `"خدمة APU"`, `"مطيل عمر Coolant"` — the English
  term is written in Latin script embedded in the RTL sentence, exactly
  like the app already does for DOT/IRP/HVUT/W-2/1099/S-Corp/ELD.
- Spanish/Russian: same pattern — `"Extensor de Coolant"`,
  `"Deducción de Per Diem"`, `"Продлитель Coolant"`, `"Вычет Per Diem"`.

Canonical casing to use when embedding: `Per Diem`, `Coolant`, `DPF`,
`DEF`, `ELD`, `IFTA`, `IRP`, `HVUT`, `2290`, `Settlement`/`Settlements`,
`Linehaul`, `Fuel Surcharge`, `Detention`, `Layover`, `Lumper`,
`Bobtail`, `Deadhead`, `Reefer`, `APU`, `CDL`, `DOT`, `MC Number`,
`Escrow`, `Factoring`, `Schedule C`, `1099`, `W-2`, `K-1`, `S-Corp`,
`LLC`.

## Verification

`app/src/i18n/__tests__/glossary.test.ts` asserts every glossary term
that appears in `en.json` also appears (byte-identical, case-sensitive,
word-boundary matched) in the corresponding key of every other locale
file. This is enforced by `npx jest` — a translation pass that
accidentally translates a glossary term fails CI, not just review.

## Binding on future work

**Session 9c** (Hindi/Ukrainian real translation, replacing the current
English-copy placeholders) MUST treat this glossary as a binding review
item: every glossary term in `hi.json`/`uk.json` stays in English exactly
like it does in `es`/`ru`/`ar`/`tr`, verified by the same
`glossary.test.ts` before that session is considered done. Any future
session that adds a NEW UI string containing one of these terms must
keep the term in English in `en.json` and every other locale's
translation of that string — do not wait for a dedicated glossary pass
to catch it later.

If a new industry-standard term needs to be added to this list, add it
here AND to the `GLOSSARY_TERMS` array in `glossary.test.ts` in the same
change — the doc and the test must never drift apart.
