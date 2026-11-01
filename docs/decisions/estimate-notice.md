# Estimates-only notice and acknowledgment (batch D item 10, 2026-10-30)

**DRAFT — ATTORNEY REVIEW REQUIRED.** The words below ship in the app now,
but they are the owner's draft, not reviewed legal text.

## Text (en.json `estimate.*`, translated in es/ru/tr/hi; ar/uk = English)

- Headline: "ESTIMATES ONLY - NOT TAX ADVICE."
- Body: "BOZKA TRUCKING AI is a record-keeping and estimating tool, not a tax
  preparer, accountant or law firm. Numbers are AI-generated estimates from
  your documents and can be wrong. Confirm everything with a licensed tax
  professional before you file or pay."
- Exports: "Prepared by the owner with AI-generated estimates. Not reviewed
  by a CPA." + a one-line footer on every page.
- Prime Inc Drivers report: "Record-keeping aid. Not an accounting or tax
  document." Cash Flow: "Forecast. Estimate only."
- Gate bullets: estimates only; not tax, legal or accounting advice; confirm
  with a licensed professional. Required "I understand" checkbox.

## Where

- Full banner (`app/src/components/EstimateBanner.tsx`, not dismissible):
  Tax Estimator, Accountant Package, Review and certify card, vehicle
  purchase tax treatment (Trucks form), For Prime Inc Drivers, Cash Flow.
- One-line strip that opens the full text: Home tax strip, AI weekly review
  on Home, AI Coach (CEO Mode) briefing and chat.
- Exports (`app/src/legal/estimateNotice.ts`): Accountant Package PDF and
  Excel, Prime Inc Drivers PDF/Excel, audit share text, import audit share
  text. There is no CSV export and no tax-estimate notification today; a new
  one must use the same module.
- Gate: `app/app/tos.tsx` "Before you start" on top of the Terms. Reuses
  `profiles.tos_accepted_at`/`tos_version` (no new SQL). `TOS_VERSION` was
  bumped to `draft-2026-10-31`, so every user sees it once more. Changing
  the notice text = bump `TOS_VERSION`. Same text under Settings -> Legal.
- Enforcement: `app/src/legal/__tests__/estimateNotice.test.ts` (contrast
  >= 4.5:1 light and dark, words, exports, screens, gate).

## Store-label notes (one line for the listing)

"BOZKA TRUCKING AI gives estimates only — not tax, legal or accounting
advice; every user acknowledges this before first use and the
acknowledgment (date + text version) is recorded."

## Needs the attorney

1. The headline/body/export wording and the three bullets (EN, plus whether
   the translations may ship before review).
2. Whether a checkbox + recorded `tos_accepted_at`/`tos_version` is a
   sufficient record of acknowledgment, or a separate log table is needed.
3. Whether the Terms (English-only today) must be shown translated.
4. The store-listing line above.
5. The "Prepared by the owner ... Not reviewed by a CPA." line on exports
   given to a third-party preparer.
