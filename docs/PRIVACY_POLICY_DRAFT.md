# Privacy Policy (DRAFT — attorney review required)

**This is a working draft, not a final legal document.** Mirrors
`docs/TERMS_OF_USE_DRAFT.md`'s status — see that file for the pairing
convention (Settings > Legal shows both together, PROMPTS.md Session 10).

Written to satisfy CLAUDE.md invariants #12 (no location) and #13 (user
data is private) as PRODUCT DECISIONS (owner, 2026-07-10), not just
aspirational copy — the two required plain-language statements below are
binding, not marketing language to be softened later.

## 1. What we collect

Bozkurt Fleet OS stores the business data you enter or import: settlements,
loads, fuel purchases, maintenance records, deductions, compliance items,
truck/driver information, and the documents (photos/PDFs) you upload for
AI-assisted extraction. This data is stored in Supabase (our database and
file storage provider).

## 2. We do not collect or track your location

**We do not collect or track your location.** This app never requests
location permission on iOS or Android, never reads GPS data, and never
stores a location value derived from a device sensor. Odometer and mileage
figures come exclusively from documents you upload (settlement PDFs,
maintenance invoices) — never from GPS.

## 3. Your financial data is yours

**Your financial data is yours — we don't access it without your
permission.** The operator of this app (Bozkurt Fleet OS) does not view an
individual user's settlements, deductions, or other financial records
except (a) with your explicit consent for a specific support request, or
(b) where legally required (e.g. a valid subpoena). We only collect
aggregate, anonymized product metrics for operating the service — user
counts, feature-usage counts, import volumes, error rates — never a query
scoped to your own data for product-analytics purposes.

## 4. Third-party processing

Documents you photograph or upload are sent to Anthropic's API for
AI-assisted data extraction (reading amounts, dates, categories, etc. off
the document). Anthropic processes this content to return the extracted
data to the app; it is not used to train Anthropic's models per Anthropic's
own API data-use terms at the time of writing. We do not sell your data to
anyone.

## 5. Data retention & deletion

You may delete your account and all associated data at any time from
Settings > Delete Account & Data. This permanently removes your database
records, uploaded documents/files, and your login — this action cannot be
undone.

## 6. Security

Every database table is protected by row-level security scoped to your own
account; only you (and, in the narrow support/legal circumstances above,
the operator) can access your data.

## 7. Changes to this policy

We may update this policy as the app evolves. Material changes will be
reflected here with an updated date. [Placeholder — formal versioning/
re-notice process pending attorney review, same as Terms of Use.]

## 8. Contact

[Placeholder — support contact address pending attorney review.]

---

*Draft version: `draft-2026-07-12`. Full text also shown in-app at
Settings > Legal > Privacy Policy.*
