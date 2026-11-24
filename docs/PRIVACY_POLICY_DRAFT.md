# Privacy Policy (DRAFT — attorney review required)

**This is a working draft, not a final legal document.** Mirrors
`docs/TERMS_OF_USE_DRAFT.md`'s status — see that file for the pairing
convention (Settings > Legal shows both together, PROMPTS.md Session 10).

Written to satisfy CLAUDE.md invariants #12 (no location) and #13 (user
data is private) as PRODUCT DECISIONS (owner, 2026-07-10), not just
aspirational copy — the two required plain-language statements below are
binding, not marketing language to be softened later.

## 1. What we collect

BOZKA TRUCKING AI stores the business data you enter or import: settlements,
loads, fuel purchases, maintenance records, deductions, compliance items,
truck/driver information, and the documents (photos/PDFs) you upload for
AI-assisted extraction. This data is stored in Supabase (our database and
file storage provider).

**Estimates-only acknowledgment (added 2026-10-31, draft):** the App gives estimates only; we record the date you acknowledged this and the version of the text you saw (`profiles.tos_accepted_at`, `profiles.tos_version`).

## 2. We do not collect or track your location

**We do not collect or track your location.** This app never requests
location permission on iOS or Android, never reads GPS data, and never
stores a location value derived from a device sensor. Odometer and mileage
figures come exclusively from documents you upload (settlement PDFs,
maintenance invoices) — never from GPS.

## 3. Your financial data is yours

**Your financial data is yours — we don't access it without your
permission.** The operator of this app (BOZKA TRUCKING AI) does not view an
individual user's settlements, deductions, or other financial records
except (a) with your explicit consent for a specific support request, or
(b) where legally required (e.g. a valid subpoena). We only collect
aggregate, anonymized product metrics for operating the service — user
counts, feature-usage counts, import volumes, error rates — never a query
scoped to your own data for product-analytics purposes.

## 4. Usage analytics

To understand which parts of the app are actually used (so we know what to
build and simplify), we record which screens you open and which actions you
take — the screen or action name and a timestamp, tied to your account.
This NEVER includes any financial value, description, document content, or
anything else about what you entered — only the bare fact that a screen was
opened or an action was started/completed. This data is not readable by any
user, including you, through the app itself; only backend administrative
access can read it, for product-decision purposes only. You can turn this
off entirely at any time in Settings > Data > Usage Analytics — no
explanation needed, and nothing else about the app changes when you do.

## 5. Third-party processing

**On-device document scanning (added 2026-10-31, draft):** On-device document scanning (Google ML Kit Document Scanner on Android, Apple VisionKit on iOS); images stay on the device until you import. See docs/decisions/document-scanner.md.

**AI features (updated 2026-11-23, draft; owner decision, AI consent):**
AI features use Anthropic (the maker of the Claude AI). Only after you
allow AI features (a consent screen at first launch, and again before an AI
feature if you said "Not now"), the app sends through our server: the
photos and PDFs you import (to read amounts, dates, categories, etc. off
the document), your business numbers and charge descriptions (for AI Coach
and the AI insights), and the questions you type to AI Coach. Your name and
company name are not sent. Anthropic processes it to answer each request.
You can turn AI features off at any time in Settings > Privacy; manual
entry and all reports keep working. We do not sell your data to anyone.

(ATTORNEY: the earlier sentence about Anthropic not training on this data
was removed on purpose, and no retention period for Anthropic is stated,
until Anthropic's current terms are confirmed — owner decision 2026-11-23.)

## 6. Data retention & deletion

You may delete your account and all associated data at any time from
Settings > Delete Account & Data. This permanently removes your database
records, uploaded documents/files, and your login — this action cannot be
undone.

## 7. Security

Every database table is protected by row-level security scoped to your own
account; only you (and, in the narrow support/legal circumstances above,
the operator) can access your data.

## 8. Changes to this policy

We may update this policy as the app evolves. Material changes will be
reflected here with an updated date. [Placeholder — formal versioning/
re-notice process pending attorney review, same as Terms of Use.]

## 9. Contact

Questions about this policy or your data: bozkatruckingai@gmail.com
(owner decision 2026-08-05, `app/src/brand.ts`'s `SUPPORT_EMAIL` —
[final formal legal-notice address pending attorney review]).

---

*Draft version: `draft-2026-08-27`. Full text also shown in-app at
Settings > Legal > Privacy Policy.*
