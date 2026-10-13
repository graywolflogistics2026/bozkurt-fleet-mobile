# I18n Languages

> Language picker: 5 enabled locales at launch (en, es, ru, tr, hi); ar/uk disabled, files kept.
> AI text language consistency, including the AI Coach cache-locale fix.
> Binding rules: invariants #11, #15, #16 in CLAUDE.md.

Moved verbatim from CLAUDE.md on 2026-10-13 (original file order).

- LANGUAGE PICKER — FIVE LANGUAGES AT LAUNCH + AI LANGUAGE CONSISTENCY
  (owner decision, supersedes the 2026-07-26 English-only LAUNCH SCOPE
  decision above in full for 5 of the 7 supported locales; no SQL —
  `profiles.locale` already existed). The app now ships selectable in
  English, Spanish, Russian, Turkish, and Hindi. Arabic and Ukrainian are
  DISABLED for v1, not deleted — every locale file, the glossary/parity
  test, and the RTL groundwork stay fully intact; re-enabling either
  later is a one-line array edit, never a rebuild.
  1. **`ENABLED_LOCALES` replaces `LANGUAGE_PICKER_ENABLED`**
     (`app/src/i18n/config.ts`): the old single boolean either showed
     ALL 7 locales or none — this pass needed a 5-of-7 subset, so it's
     replaced with `ENABLED_LOCALES: readonly SupportedLocale[] =
     ['en','es','ru','tr','hi']`, plus a new `isEnabledLocale()` (the
     STRICT gate every selection/detection surface now uses) alongside
     the pre-existing `isSupportedLocale()` (still recognizes all 7, for
     validating raw/stale data into the type). `detectDeviceLocale()`/
     `resolveInitialLocale()` (`src/i18n/index.ts`), the cached-locale
     reader (`src/i18n/localeStorage.ts`'s `getCachedLocale()`), the
     profile-locale cross-device sync
     (`AuthContext.tsx`'s `fetchProfile()`), and Settings' own language
     picker (`app/(tabs)/more/settings.tsx`) were all switched from
     `isSupportedLocale`/`SUPPORTED_LOCALES`/the old boolean to
     `isEnabledLocale`/`ENABLED_LOCALES` — a locale that's
     supported-but-disabled (ar/uk) can never be silently reactivated by
     stale cached/server data, it always falls back to detection/English
     instead. **No RTL surface ships in v1**, stated explicitly in
     `config.ts`'s own comment — Arabic is the ONLY RTL locale in the
     supported set, and it's disabled, so `isRTLLocale()` has no
     reachable `true` result from any real user's own locale choice;
     nobody should assume RTL has been exercised on a real device just
     because the groundwork exists.
  2. **First-run language screen** (`app/language.tsx`, gated via a new
     `LanguageGateContext.tsx` — same "lift a device-local flag into a
     shared context so the writer screen and the redirect effect can
     never read a stale separate value" pattern `IntroContext.tsx`
     already established, for the identical real-device redirect-loop
     reason documented on that file): shown before EVERYTHING else,
     including the intro slides and sign-in —
     `src/navigation/rootRedirect.ts`'s `languageScreenSeen` gate runs
     FIRST among every gate in the chain (`if (!languageScreenSeen)
     return onLanguageScreen ? null : '/language';`, a genuine
     short-circuit that blocks every later gate too, not just its own
     re-trigger — every other gate in this chain only guards ITSELF,
     this one has to guard everything downstream of it since none of
     those later checks know anything about the language gate). Each of
     the 5 enabled languages shown in its OWN script/name
     (`LOCALE_LABELS`, never translated — these are the languages' own
     names for themselves); the device-detected language is preselected
     automatically since `i18n.language` is already resolved to
     cached-or-detected by boot time (`initI18n()` runs before this
     screen or any provider even mounts). Genuinely ONE-TAP: tapping any
     option (including the already-highlighted default) immediately
     persists the choice (`setAppLocale()`, mirrored to
     `profiles.locale` for a signed-in user reaching this screen on a
     new device) and calls `markLanguageScreenSeen()` — no separate
     "Continue" button, no explicit navigate call needed from the screen
     itself, since flipping the gate makes `_layout.tsx`'s own redirect
     effect recompute and route to whatever's next (intro / sign-in /
     confirm-email / ToS / tutorial / onboarding / tabs) entirely on its
     own. Re-changeable any time from Settings > Language (now listing
     only the 5 enabled locales).
  3. **Full-flow audit — clean**: dispatched a research pass auditing
     auth screens, ToS, tutorial, onboarding, alerts/nudges, the
     Accountant Package PDF/Excel export template, and this pass's own
     two most recent screens (`trucks.tsx`'s Delete-Truck flow,
     `import/index.tsx`'s document-type-override selector) for any
     hardcoded English string bypassing `t()`. Found none — every one of
     those flows was already fully `t()`-driven (the one deliberate,
     confirmed-intentional exception being `tos.tsx`'s own legal body
     text, which CLAUDE.md's own standing rule keeps English-only until
     attorney review).
  4. **AI language discipline — already correct, verified not assumed**:
     every one of the 6 `callAiAdvisor()` call sites
     (`profit-analysis.tsx`, `proactiveCoach.ts`, `maintenance.tsx`,
     `ceo-mode.tsx`, `ai-advisor.tsx`, `weeklyReview.ts`'s own caller)
     and the `callAiImport()` call site already pass `i18n.language`
     explicitly (either via `useTranslation()`'s hook or the shared
     default `i18n` singleton import — confirmed both resolve to the
     SAME live instance) — the user's SELECTED app language, never the
     raw device locale and never the document's own language, per the
     pre-existing AI IN USER'S LANGUAGE invariant (#16). No code change
     was needed here; this pass's own work was verifying it end to end.
  5. **Glossary now reaches AI-generated text with the FULL list, not 3
     examples**: both `supabase/functions/ai-advisor/index.ts` and
     `supabase/functions/ai-import/index.ts` used to tell the model to
     keep "standard financial/trucking terms" in English with only 3
     illustrative examples ("per diem", "ELD", "IFTA") — replaced in
     both files with a new `GLOSSARY_TERMS_FOR_PROMPT` constant spelling
     out the ENTIRE docs/I18N_GLOSSARY.md list explicitly (plus "owner's
     draw"/"CPM"/"RPM" as free-text-only examples — see below), kept in
     sync by hand across both Deno files the same way their existing
     `LOCALE_LANGUAGE_NAME` maps already were (Deno can't share modules
     between these two functions or with `app/src`). **CPM and RPM added
     to the actual enforced UI-string glossary** (`docs/I18N_GLOSSARY.md`
     + `glossary.test.ts`'s `GLOSSARY_TERMS`) after confirming both were
     already kept in English everywhere except 2 strings, which were
     fixed to match rather than the rule relaxed: `ar.json`'s
     `acceptLoadsAboveCpm` had translated "CPM" away, and
     `settlementsScreen.avgRpmCaption` had been fully paraphrased in
     es/ru/ar/tr, dropping the literal "RPM" token — both fixed to embed
     the acronym. **"Owner's draw" deliberately NOT added to the
     enforced UI-string glossary** despite being named alongside
     CPM/RPM in the request — unlike every other glossary term, "owner
     draw" is ordinary English with a natural translation in every
     language (already correctly translated in es/ru/ar/tr, e.g. es
     "Retiros del dueño") and forcing it into English here would make
     already-good, already-shipped translations worse; it's still listed
     as a do-not-translate EXAMPLE in the two AI system prompts' own
     free-text instruction (prose guidance to the model, a looser,
     different mechanism than the mechanically-enforced UI-string test).
     New regression test, `src/i18n/__tests__/aiPromptGlossary.test.ts`
     — honestly scoped to what's actually achievable from this repo (no
     Deno runtime anywhere in this environment, so the real prompt-
     building function can't be executed and no live Anthropic call can
     be made to inspect real generated text): reads both Deno files'
     source text directly and verifies `GLOSSARY_TERMS_FOR_PROMPT`
     contains every one of the 34 glossary terms, that the language-
     instruction template actually interpolates that constant (not a
     shorter hardcoded list), and — the "sampling per locale" the spec
     asks for — that for every one of the 6 non-English locale codes
     `LOCALE_LANGUAGE_NAME` maps to a real language name, which
     deterministically takes the glossary-bearing instruction branch.
  6. **Hindi real translation — the actual bulk of this pass**: hi.json
     previously shipped as a byte-for-byte untranslated English copy of
     en.json (CLAUDE.md's own long-standing "hi/uk as untranslated
     English copies" language) — since Hindi is now one of the 5
     LAUNCH languages (not just infrastructure), it had to become real
     Hindi text, not English disguised as Hindi. All 1,855 leaf strings
     translated, key-for-key identical structure to en.json (verified by
     a direct recursive key-set diff: 1855/1855, zero missing, zero
     extra), every `{{interpolation}}` placeholder and `_one`/`_other`
     plural suffix preserved exactly, every DO-NOT-TRANSLATE glossary
     term kept in English/Latin script embedded in the Hindi sentence
     (caught and fixed 5 real leaks during this pass via the glossary
     test itself: "MC Number" had been rendered as "MC नंबर" in 3
     places, "Reefer" and "Factoring" had each been phonetically
     transliterated into Devanagari once — all fixed to keep the literal
     English term). Domain enum values that es/ru/ar/tr already leave in
     English (payment methods, etc.) were left in English in hi.json
     too, for the same consistency reason "owner's draw" was kept OUT of
     the enforced glossary above — never be the one locale that
     translates something every other locale deliberately doesn't.
     **PROCESS NOTE, stated honestly**: a background sub-agent was
     first dispatched to do this translation; after a very long run
     (28 minutes, ~511K tokens) it reported "completed" with a summary
     describing the ENTIRE surrounding pass's work rather than its own
     narrow assigned task — and `hi.json` itself was still, in fact,
     completely untranslated English when checked. Rather than retry
     the same delegation, the translation was done directly, section by
     section, verifying JSON validity after each batch.
  7. **Translation quality — honest breakdown, per the request's own
     item 6**: **none of the 5 shipping languages have been reviewed by
     a professional native-speaking human translator** — every one of
     them, including English's own UI copy, was authored by AI across
     this project's history. Specifically: **Spanish, Russian, and
     Turkish** were translated by the AI assistant in the original
     multi-language session (2026-07-09) and have since been
     incrementally maintained/patched string-by-string across roughly
     two months of subsequent feature passes (confirmed by this
     project's own extensive CLAUDE.md history) — the most battle-tested
     of the three, having been exercised against dozens of real feature
     additions, but still never formally proofread by a native speaker.
     **Hindi** was translated by the AI assistant in this single pass,
     all 1,855 strings at once, with none of that incremental
     real-world exposure the other three have had — the highest-risk of
     the five for an awkward phrase, an unnatural word choice, or a
     regional/dialect mismatch a native speaker would catch immediately.
     **Recommendation**: prioritize a native Hindi speaker's proofread
     first (freshest, least exercised, translated in one large batch
     rather than refined incrementally), then Spanish/Russian/Turkish
     as a lower-urgency but still-valuable pass whenever one is
     available — none of the three has ever had a real review despite
     being in production-adjacent use for months.
  Tests: 116 suites / 2934 tests pass (`config.test.ts` and
  `aiPromptGlossary.test.ts` new); `tsc --noEmit` clean. i18n: 3 new
  `languageScreen.*` keys across all 7 locale files (es/ru/tr/ar fully
  translated, hi now genuinely translated as its own 1,855-string
  effort rather than the usual few-key addition, uk as an untranslated
  English copy matching its own still-disabled status); `CPM`/`RPM`
  added to `docs/I18N_GLOSSARY.md` and `glossary.test.ts`'s
  `GLOSSARY_TERMS`, with the 2 pre-existing leaks (ar/es+ru+ar+tr) fixed
  to match. No SQL changes — `profiles.locale` already existed and
  needed no schema change. `supabase/functions/ai-advisor/index.ts` and
  `supabase/functions/ai-import/index.ts` were BOTH modified (the
  expanded glossary block) and **need redeploying**;
  `reset-data`/`delete-account`/`referral-sync` were NOT touched. No
  new native dependency — pure JS/TS plus two Edge Function prompt-text
  edits — ships via a normal `eas update` once the two Edge Functions
  above are redeployed.

- AI COACH TEXT IS ENGLISH IN EVERY LANGUAGE — cache-locale bug fix
  (owner decision, docs/PENDING_SQL.md §65, NOT YET APPLIED). Diagnosis
  first, per the report's own explicit ask, tracing all 4 named pieces
  to their exact origin before touching anything:
  1. **Weekly settlement review** (`proactive.weeklyReview`, rendered
     `app/(tabs)/index.tsx`'s `AiCoachSection`) — the ONE genuinely
     server-generated piece of the four. Client composes the prompt in
     `src/stats/weeklyReview.ts`'s `buildWeeklyReviewPrompt()`
     (deliberately English — it's a prompt TO the model, never shown to
     the user) and sends it via `callAiAdvisor()` in
     `src/data/proactiveCoach.ts`, already passing `i18n.language` as
     `locale` — confirmed correct, not the bug. **The actual root
     cause**: `shouldGenerateWeeklyReview()` never accounted for locale
     AT ALL — it only ever compared `week_ending` and a 7-day cooldown.
     A review generated once (in whatever language happened to be
     active) was cached and shown FOREVER, with literally no mechanism
     to invalidate it on a later language switch — exactly "not just
     Turkish... the text never goes through translation at all" for
     this specific piece: once cached in English, no amount of picking
     a different language would ever re-trigger a real request in that
     language.
  2. **Greeting line** (`🧑‍✈️ {t(greetingKey(hour), {name})}`,
     `app/(tabs)/index.tsx`), **profit-opportunity headline**
     (`t('ceoMode.recommendations.headerTitle'/'headerTitleZero', ...)`,
     same file), and the **3 recommendation rows**
     (`recommendationText(rec, t, moneyRounded)`,
     `src/stats/aiRecommendations.ts`) — all three are 100% CLIENT-SIDE,
     pure-template composition (`buildRecommendationCandidates()`/
     `selectTopRecommendations()` compute real numbers from account
     data; text is picked by `RecommendationType`, never generated by a
     model) already routed through `t()`, with every key
     (`dashboard.greeting.*`, `ceoMode.recommendations.*`) present and
     translated in all 5 enabled locale files. **No hardcoded English
     template was found for these three** — audited the actual render
     code line by line, not assumed. Stated honestly: if these three
     specifically are STILL showing English on a real device after
     confirming the latest `eas update` has landed, that's a different,
     not-yet-reproduced bug this pass did not find — the fix below is
     scoped to what was actually confirmed broken (item 1).
  3. **Client-side fix (item 2 of the request)**: nothing to move —
     confirmed no hardcoded template exists for the 3 client pieces.
  4. **Server-side verification (item 3)**: confirmed in code — every
     one of the 6 `callAiAdvisor()` call sites across the app
     (`profit-analysis.tsx`, `proactiveCoach.ts`, `maintenance.tsx`,
     `ceo-mode.tsx`'s own `handleGetBriefing()`, `ai-advisor.tsx`) already
     passes `i18n.language` explicitly, and `supabase/functions/
     ai-advisor/index.ts`'s system prompt already appends a "Respond in
     {language}" instruction whenever a locale is provided — this part
     of the mechanism was correct before this pass and needed no server
     change. **What needs a redeploy vs. what doesn't, stated plainly
     since the CLI is currently blocked**: the locale-instruction
     mechanism itself is ALREADY LIVE in whatever `ai-advisor` version is
     currently deployed (it's predated this conversation entirely,
     2026-07-10) — only the PREVIOUS session's glossary-list expansion
     inside that same file is still sitting undeployed. This pass's own
     fix (items 4-5 below) is 100% client-side — new `profiles` column +
     `src/stats/weeklyReview.ts` + `src/data/proactiveCoach.ts` +
     `app/(tabs)/index.tsx` — and ships via a normal `eas update` alone,
     with NO Edge Function redeploy required for any of it to take
     effect.
  5. **Fallback while the redeploy is blocked (item 4)** — never show
     unverified server text: `isCachedReviewUsable()` (new,
     `weeklyReview.ts`) gates whether `proactive.weeklyReview` is even
     returned non-null — requires BOTH a real cached string AND its
     tagged locale (see item 5's new column) to match the CURRENT
     locale. A SECOND, narrower defense, `looksLikeExpectedScript()`:
     for the two non-Latin-script enabled locales specifically
     (Russian/Cyrillic, Hindi/Devanagari — the only two where this is
     cheap and reliable to check without false positives), a cached
     response containing ZERO characters in the expected Unicode block
     is treated as suspect even when its locale TAG matches — this is
     what catches "the currently-deployed server ignored the requested
     locale and returned English anyway," which a tag-comparison alone
     can't detect. Honestly scoped: no equivalent check exists for
     Spanish/Turkish (Latin script, same alphabet as English — no cheap
     reliable heuristic), so for those two locales specifically, full
     correctness genuinely depends on the pending redeploy; the
     locale-tag check (item 5) still protects against STALE cache for
     them regardless. Whenever `weeklyReview` is null (unverified,
     unavailable, or never generated), the UI now shows
     `weeklyReviewFallback` instead — a NEW, deterministic,
     GUARANTEED-correctly-localized template (`buildWeeklyReviewFallbackText()`,
     `weeklyReview.ts`) built from the EXACT SAME real inputs the AI
     prompt uses, composed entirely via `t()` calls (new
     `ceoMode.weeklyReviewFallback.*` keys, all 7 locale files) — same
     "plain i18n template instead of a second AI call" pattern this app
     already uses for periodic coach nudges
     (`periodicCoachNudges.ts`'s `coachNudgeText()`).
  6. **Cache invalidation on language switch (item 5)** — new
     `profiles.ai_weekly_review_locale` column (docs/PENDING_SQL.md
     §65) tags every cached review with the exact locale it was
     requested in. `shouldGenerateWeeklyReview()` gained `cachedLocale`/
     `currentLocale` params — a mismatch now forces regeneration
     immediately, DELIBERATELY bypassing the existing 7-day cooldown
     (a language switch is a rare, deliberate user action, not
     something worth rate-limiting the same way "another settlement
     imported this week" is). The generation effect's own dedupe key in
     `proactiveCoach.ts` was extended from just `week_ending` to
     `` `${week_ending}:${locale}` `` so a language switch can trigger a
     fresh attempt even for a week this session already successfully
     reviewed under the old language. The freshly-cached row is tagged
     with the locale that was ACTUALLY REQUESTED at call time (captured
     before the async call, never re-read from `i18n.language` after —
     the user could have switched languages again mid-flight).
     `reset-data`'s existing `ai_weekly_review*` CLEARED bucket gained
     this new sibling column, same treatment as its 3 existing
     neighbors.
  Tests: `src/stats/__tests__/weeklyReview.test.ts` gained coverage for
  every new function (`shouldGenerateWeeklyReview`'s 4 new locale-
  mismatch cases, `isCachedReviewUsable`, `looksLikeExpectedScript`'s
  script-detection both directions for ru/hi and the no-op passthrough
  for es/tr/en, and `buildWeeklyReviewFallbackText`'s full key/param
  coverage via a fake `t()` that records exactly what it was called
  with). Full suite: 116 suites / 2981 tests pass; `tsc --noEmit`
  clean; all 7 locales confirmed key-parity (9 new
  `ceoMode.weeklyReviewFallback.*` keys — es/ru/tr/hi/ar fully
  translated, uk as an untranslated English copy matching its own
  still-disabled status; glossary test re-passed clean — "per diem"/
  "Deadhead" correctly kept in Latin script in every translation).
  `docs/PENDING_SQL.md` §65 (`profiles.ai_weekly_review_locale text`,
  mirrored as `pending_65.sql` at the repo root) is **NOT YET
  APPLIED** — the new column must exist before this pass's client code
  can read/write it; until it's run, `profileQuery.data?.
  ai_weekly_review_locale` simply reads `undefined`/falls through
  `?? null`, so the app degrades gracefully (every cached review is
  treated as locale-unverified, meaning the fallback template shows
  instead of a possibly-wrong-language cached string — never a crash,
  never a worse outcome than before this pass) rather than breaking
  until the migration runs. No Edge Function was modified this pass —
  `ai-advisor`/`ai-import`/`reset-data`(config-only column-list
  change)/`delete-account`/`referral-sync` all NOT touched in a way
  that needs redeploying, confirmed: `reset-data`'s own edit is a plain
  JS object literal addition, no behavior change to test/redeploy
  urgency beyond normal — ships whenever convenient, not blocking this
  fix. Every other change in this pass is pure client-side JS/TS and
  ships via a normal `eas update` alone.
