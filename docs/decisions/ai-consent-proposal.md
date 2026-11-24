# AI consent screen: proposal + owner decisions (2026-11-23)

## OWNER DECISIONS (2026-11-23, binding; supersede the proposal text below where they differ)

1. Consent is asked at first launch: a gate after ToS and before the tutorial (`app/app/ai-consent.tsx`). A just-in-time sheet (`app/src/components/AiConsentProvider.tsx`) appears when consent is missing. Existing users see the gate once at their next open.
2. One single consent covers every AI feature.
3. Owner and company name are no longer sent to the AI. The ai-advisor system prompt says "the owner-operator", and the consent text does not mention names.
4. ai-import and ai-advisor check consent on the server and answer `ai_consent_required`. The diagnose model check stays allowed. The code is in the repo, not deployed.
5. Consent text has **no** "does not train" sentence and **no** retention claim. It uses: "Anthropic processes it to answer this request. Details in the Privacy Policy." It keeps "We never sell your data." The data list says "your business numbers and charge descriptions". The in-app Privacy Policy and ToS follow the same rule until the attorney confirms.
6. Daily Tips do not use AI: `app/src/data/dailyTips.ts` makes no AI call, so they are not gated.

Rules and storage: `app/src/ai/aiConsent.ts`. Call gate: `app/src/ai/aiConsentGate.ts`. Columns: `docs/PENDING_SQL.md` §89.

**Ship order:** SQL §89 → `eas update` → wait until phones run it → redeploy ai-advisor and ai-import.

---

(Original proposal, kept for history. The wording rows in section 4 are superseded by decisions 3 and 5.)

**Goal.** Meet App Store guideline 5.1.2(i). Before personal data goes to a third-party AI, the app must say three things and get the user's explicit permission:

- what data is sent,
- who it is sent to,
- the user's explicit "yes".

**Status.** This file is a findings report plus a design table for the owner to approve. No code, SQL or text changed. Nothing below is built.

## 1. Every place user data goes to the AI

All AI calls go through two Edge Functions. Both call `https://api.anthropic.com/v1/messages` with the server's key:

- `supabase/functions/ai-import/index.ts:702`
- `supabase/functions/ai-import/reader/server.ts:121`
- `supabase/functions/ai-advisor/index.ts:176`

The model is `claude-sonnet-4-6` (`ai-import/index.ts:65`, `ai-advisor/index.ts:27`); the reader passes its own `req.model`. The app never calls Anthropic directly.

| # | Screen / trigger | App call (file:line) | What is sent to Anthropic | User action? |
|---|---|---|---|---|
| A1 | Import: PDF / file (the reader job) | `app/src/data/importJobs.ts:213-229` (`read_start`). The file is first uploaded to Storage (`:189`), then the server downloads it and sends it (`reader/server.ts:228`, `:121-133`) | The **whole document** (settlement PDF: name, unit, carrier, loads, amounts, sometimes driver names). Also: locale, the user's custom category names, learned keyword rules, carrier code maps | Yes, the user picks a file |
| A2 | Import: Read again / Resume / Answer | `importJobs.ts:330`, `:338`, `:348`, `:362` | The same stored document again; Answer also sends the owner's typed label/amount answers | Yes |
| A3 | Import: photo (receipt, fuel, maintenance...) | `app/app/(tabs)/import/index.tsx:801` → `app/src/data/aiImportCall.ts:194` (→ `:92`) | The **photo** (JPEG, base64), locale, custom categories, learned rules, carrier code maps | Yes, the user takes or picks a photo |
| A4 | Batch import / resume from the jobs chip | `importJobs.ts:279` (batch), `app/src/components/ImportJobsChip.tsx:6` (resume), `app/app/(tabs)/import/jobs.tsx:6` | Same as A1/A2 | Yes |
| B1 | **Home: AI Coach weekly review (AUTOMATIC)** | `app/src/data/proactiveCoach.ts:454` (prompt built by `app/src/stats/weeklyReview.ts:216`); runs from `useProactiveCoach()` on Home (`app/app/(tabs)/index.tsx:864`) and Alerts (`more/alerts.tsx:50`) | Week ending, revenue, net, RPM, CPM, deadhead %, fuel % of revenue, **biggest chargeback descriptions + amounts**, per diem days, YTD profit, settlement count, weekly goal progress | **No: it fires by itself** when a new settlement week exists |
| B2 | AI Coach: "Get briefing" | `app/app/(tabs)/more/ceo-mode.tsx:130` | This week's revenue/profit, goal %, counts of needs-review receipts, maintenance and compliance items due, unsorted documents | Yes (button) |
| B3 | AI Coach: "Ask a Question" chat | `ceo-mode.tsx:152` | The user's **free text** plus the chat history (last messages) | Yes |
| B4 | Maintenance: "Ask AI" patterns | `app/app/(tabs)/more/maintenance.tsx:178` | Per service type: count and total cost for the truck | Yes |
| B5 | Profit Analysis: "Ask AI" | `app/app/(tabs)/more/profit-analysis.tsx:157` | Period revenue, fuel and maintenance expense, net income, miles, benchmark ranges | Yes |
| B* | **Added by the server to every ai-advisor call (B1-B5)** | `supabase/functions/ai-advisor/index.ts:144-166` | **`owner_name` and `company_name`** from the profile, plus all-time revenue, deduction total, miles and settlement count (system prompt) | Same as the call |
| — | Settings > Diagnostics "model check" | `app/src/data/diagnoseCall.ts:11` → `ai-import/diagnose.ts:164-175` | A fixed test sentence only ("System check..."); **no user data** | Yes |

Calls that do NOT go to the AI: `delete-account`, `reset-data`, `referral-sync` (`app/src/data/*Call.ts`).

Also stored by us after an AI call (not sent anywhere else):

- `documents.parsed_json`, the raw extraction (invariant #14);
- `import_jobs` rows and the uploaded file in the `documents` bucket;
- `profiles.ai_weekly_review*`, the cached review text;
- `ai_usage_log`, token counts per call (`ai-advisor/index.ts:90`).

## 2. Does a consent or disclosure already exist?

**No AI consent exists.** I searched for `consent` and any AI disclosure flag in `app/src` and `app/app` and found none: no profiles column, no AsyncStorage key, no Settings toggle.

What does exist:

- **ToS + "Estimates only" gate:**
  - screen: `app/app/tos.tsx`;
  - stored as `profiles.tos_accepted_at` / `tos_version` (`app/src/context/AuthContext.tsx:255`), version `TOS_VERSION = 'draft-2026-10-31'` (`app/src/config/termsOfUse.ts:9`);
  - re-shown when the version changes (`AuthContext.tsx:277-287`).
  - It is one acceptance for the whole ToS. It is **not** a separate, explicit AI permission, and it does not say what data goes to whom.
- **ToS text:** the in-app text says "a third-party AI service" without a name (`termsOfUse.ts:24-25`). The draft names Anthropic (`docs/TERMS_OF_USE_DRAFT.md:48-55`).
- **Order of first-run screens:** ToS → tutorial → onboarding (`AuthContext.tsx:289-293`). There is no AI step.

## 3. What the Privacy Policy / ToS say about Anthropic and retention

- **In-app Privacy Policy, §5** (`app/src/config/privacyPolicy.ts:26-27`): "Documents you photograph or upload are sent to Anthropic's API for AI-assisted data extraction. We do not sell your data to anyone."
  - It says **nothing** about AI Coach, the chat, Ask AI or the automatic weekly review (B1-B5).
  - It says nothing about owner/company name being sent.
- **Draft, §5** (`docs/PRIVACY_POLICY_DRAFT.md:58-63`) adds: "it is not used to train Anthropic's models per Anthropic's own API data-use terms at the time of writing."
  - This sentence is **not** in the in-app text.
- **Retention, §6** (`privacyPolicy.ts:29-30`, draft `:65-70`): covers only OUR deletion (Delete Account removes records, files and login).
  - **Nothing** says how long Anthropic keeps API inputs and outputs.
  - I did not look up Anthropic's current retention terms. The exact retention wording must come from Anthropic's current commercial/API terms, checked by the owner or an attorney. I am not guessing a number of days.
- **Both texts** are marked "DRAFT — ATTORNEY REVIEW REQUIRED" (`privacyPolicy.ts:12`, `TERMS_OF_USE_DRAFT.md:7`).

## 4. Design table (proposal, owner approval needed)

| Item | Proposal |
|---|---|
| **When it appears** | **(1) First launch:** a new "AI permission" screen right after the ToS gate and before the tutorial (same gate pattern as `tos.tsx`). This is needed because B1 fires automatically on Home, so consent must be decided before Home ever renders. **(2) Just in time:** if consent is missing (said No, or withdrew), any AI action (Import, Get briefing, Ask, Ask AI) opens the same text as a sheet with Allow / Cancel, instead of failing. |
| **Buttons** | Two equal buttons: **Allow** and **Not now**. No pre-ticked box. "Not now" never blocks the app. |
| **Wording, EN** (title) | **Allow AI features?** |
| **Wording, EN** (body) | To read your documents and give coaching, this app sends data to **Anthropic** (the maker of the Claude AI), through our server:<br>• the photos and PDFs you import<br>• your business numbers (revenue, expenses, miles, goals) and your name and company name<br>• questions you type to AI Coach<br>Anthropic uses it only to answer this request and does not train its models on it. We never sell your data. You can turn this off anytime in Settings. **[Privacy Policy]** |
| **Wording, TR** (title) | **Yapay zekâ özelliklerine izin veriyor musunuz?** |
| **Wording, TR** (body) | Belgelerinizi okumak ve size koçluk yapmak için uygulama, sunucumuz üzerinden **Anthropic**'e (Claude yapay zekâsının yapımcısı) veri gönderir:<br>• içe aktardığınız fotoğraf ve PDF'ler<br>• işletme rakamlarınız (gelir, gider, mil, hedef), adınız ve şirket adınız<br>• AI Coach'a yazdığınız sorular<br>Anthropic bu veriyi sadece isteği yanıtlamak için kullanır ve modellerini bununla eğitmez. Verilerinizi asla satmayız. Bu izni istediğiniz zaman Settings'ten kapatabilirsiniz. **[Gizlilik Politikası]** |
| **Wording caveat** | The "does not train" and retention sentences must match Anthropic's current terms; owner or attorney to confirm before shipping. Other locales (es, ru, hi; ar/uk English) follow the i18n rule, en first. |
| **Where the choice is stored** | `profiles.ai_consent_at timestamptz null` and `profiles.ai_consent_version text null` (new PENDING_SQL section). Allow writes both; Not now / withdraw sets both to null. The version is bumped when the list of what is sent changes, which re-asks (same as `tos_version`). Invariant #24 bucket: **KEPT** (a preference like `tos_accepted_at`; Reset All Data does not re-ask). |
| **Server check (recommended)** | `ai-import` and `ai-advisor` read the caller's `ai_consent_at`/`ai_consent_version` and refuse with a clear error (e.g. `ai_consent_required`) when missing. The app also checks first, so the user normally sees the sheet, not the error. The diagnose model check (no user data) can stay allowed. Needs a redeploy of both functions after the SQL runs. |
| **If the user says No** | **Still works:**<br>• manual entry everywhere (fuel, maintenance, tolls, deductions, loads, capital, compliance...);<br>• every screen and report computed on the device: Home figures, Settlements, Scorecard, Cash Flow, Tax Estimator, Accountant Package, Operating P&L, Truck Comparison, Truck Health;<br>• Documents list, export, Settings.<br>On Home, the AI Coach section shows the existing non-AI fallback review (`proactive.weeklyReviewFallback`, `app/app/(tabs)/index.tsx:482`).<br>**Off:**<br>• Import reading (A1-A4: no PDF or photo is sent; the Import button opens the consent sheet);<br>• AI Coach briefing and chat (B2, B3);<br>• the automatic weekly AI review (B1);<br>• Maintenance and Profit Analysis "Ask AI" (B4, B5).<br>Not checked here: whether Daily Tips use AI. They are built by `app/src/data/dailyTips.ts`, which I did not read for this. |
| **Withdraw in Settings** | Settings > Privacy: a row "AI features: On / Off". Turning it off asks once ("AI reading and AI Coach will stop. Your saved data stays."), then clears `ai_consent_at`/`version`. Turning it on shows the same consent text and Allow. Already-saved data and extractions stay; only new sending stops. |
| **Delete Account must also remove** | **Already covered** by the tested delete-account (2026-11-23):<br>• the `profiles` row (so the consent columns go with it);<br>• `documents` rows and their `parsed_json`;<br>• Storage files (`documents`, `backups`);<br>• `import_jobs` and `ai_usage_log` (by cascade);<br>• the cached `ai_weekly_review*` columns (on `profiles`).<br>**New work:** none, as long as the consent lives on `profiles`.<br>**Not in our control:** data already processed by Anthropic follows Anthropic's own retention. The Privacy Policy must say so in plain words. |
| **Policy texts to update (same task)** | In-app `privacyPolicy.ts` §5 and the draft §5: list A + B (not just documents), name Anthropic, mention that name and company name are sent, add the no-training and retention sentences (after checking the terms), and point to Settings > Privacy. ToS §3 in-app: name Anthropic (the draft already does). Bump `PRIVACY_VERSION`. |
| **Optional data reduction** | Stop sending `owner_name`/`company_name` in the advisor system prompt (`ai-advisor/index.ts:144,153-154`) and use "the owner-operator" instead. Then the consent text no longer needs "your name and company name". Owner decision. |

## Open questions for the owner

1. Consent at first launch (proposed) or only just in time? First launch is needed unless B1 (automatic weekly review) is also changed to wait for consent.
2. One consent for all AI (proposed), or two (Import reading / AI Coach)?
3. Keep sending owner and company name to the AI, or drop them (row above)?
4. Server-side enforcement (recommended), or app-only?
5. Who confirms Anthropic's retention and no-training wording (attorney / owner)?

## Ship impact if approved (estimate, nothing done)

- New PENDING_SQL section with two `profiles` columns.
- New gate screen + Settings row + i18n keys in all 7 locales.
- Policy text updates.
- Redeploy of `ai-import` (via `scripts/deploy-ai-import.ps1`) and `ai-advisor` if the server check is added.
- Ships with `eas update`; no native module.
- Per working rule 9, this would be separate commits, one change each.
