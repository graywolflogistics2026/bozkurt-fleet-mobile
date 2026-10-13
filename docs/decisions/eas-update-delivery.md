# Eas Update Delivery

> Why EAS updates did not reach the device (2026-08-28) and the diagnostics added.
> runtimeVersion policy appVersion (1.0.0), preview channel/branch, cold-start checks; build-info footer + manual check button.
> Both diagnostics need a native build to reach a device that receives no OTA updates.

Moved verbatim from CLAUDE.md on 2026-10-13 (original file order).

- EAS UPDATE NOT REACHING THE DEVICE — DIAGNOSIS + THE ONE THING FIXABLE
  FROM THIS ENVIRONMENT (owner decision 2026-08-28, device report:
  Settings' own build-info footer read "vunknown · embedded build (no OTA
  update)" — meaning no EAS Update has EVER applied to that device, not
  "the latest one didn't," calling into question every "fixed and shipped
  via `eas update`" claim made earlier the same day). **Hard limitation,
  stated up front**: this sandbox has no `eas` CLI and no EAS
  credentials (`eas --version`/`eas whoami` both fail — confirmed by
  running them, not assumed) — nothing here can query
  `eas build:list`/`eas update:list`/`eas channel:view` to see what the
  EAS servers actually recorded for the last build or the last publish.
  Everything below is either (a) confirmed directly from the repo's own
  config files, or (b) a diagnostic the OWNER must run themselves,
  handed over as exact commands — never guessed at or asserted as fact
  without that distinction being explicit.
  1. **Runtime version policy, confirmed from `app.config.js`**:
     `runtimeVersion: { policy: 'appVersion' }` — the runtime version
     used to match an OTA update to a native build is computed as
     literally the `expo.version` string, currently `'1.0.0'` (also
     confirmed — this has never been bumped anywhere in this project's
     history). Since both the native build and every `eas update`
     publish compute their own runtime version from THIS SAME policy at
     their own respective times, a mismatch would only arise if (a) the
     LAST native build was made before `runtimeVersion`/`updates.url`
     were added to `app.config.js` at all (a materially older build,
     predating EAS Update being configured for this project in any
     form), or (b) `version` was different at build time than it is now
     (ruled out — confirmed via `git log` that `1.0.0` has been the only
     value used). **What I cannot tell you**: what runtime version the
     actual last build was tagged with by the EAS servers, or what the
     most recent `preview`-branch publishes were tagged with — run `eas
     build:list --platform android --limit 3` and `eas update:list
     --branch preview --limit 5` yourself and compare their own
     `runtimeVersion` columns directly.
  2. **Channel configuration, confirmed from `eas.json`**: the `preview`
     build profile has `"channel": "preview"` — this is what gets baked
     into a NATIVE BUILD made with `eas build --profile preview`, and is
     the channel every `eas update --branch preview` command this
     session has been running should be reaching. **What I cannot
     verify**: whether the EAS project's own channel→branch mapping
     actually routes the "preview" channel to the "preview" branch (this
     mapping lives on Expo's servers, not in this repo) — a channel
     pointed at the wrong branch, or unmapped entirely, would silently
     swallow every update this session published with zero error on the
     publishing side. Run `eas channel:view preview` to see exactly what
     branch(es) that channel currently resolves to.
  3. **What to do, precisely, once you have the two commands' output
     above**: (a) if `eas channel:view preview` shows it's NOT pointing
     at the `preview` branch — fix the mapping (`eas channel:edit`, or
     republish to whatever branch it actually points to) — **no rebuild
     needed**, this is a server-side routing fix. (b) if the channel
     mapping IS correct but `eas build:list`'s last build predates
     `runtimeVersion`/`updates.url` existing in `app.config.js` (i.e. it
     was built before EAS Update was ever wired into this project) —
     **one rebuild IS required**, since a build's OTA-update capability
     (which URL to poll, which channel to report) is baked into the
     native binary at build time and cannot be retrofitted by any
     `eas update` — every fix "shipped" via `eas update` since that
     build genuinely never had a chance to reach it. (c) if BOTH check
     out — channel correctly mapped, build genuinely EAS-Update-capable
     — and the device STILL shows `embedded build (no OTA update)`,
     the next things to check are: was `eas update` ever actually run
     against a build with a MATCHING runtime version (an update
     published for `runtimeVersion: 1.0.0` is invisible to a build
     whose own runtime version is anything else), and does the device
     actually have network connectivity / has the app been fully
     restarted (not just backgrounded) since the update was published —
     `expo-updates` checks for a new update on cold start, not on
     resume.
  4. **The one thing actually fixable from this sandbox — item 4's own
     ask, "a visible way to confirm this without guessing again"**:
     `getBuildInfo()` (`app/src/lib/buildInfo.ts`) already captured
     `Updates.channel` but the shared formatter,
     `formatBuildInfoLine()` (`app/src/lib/buildInfoFormat.ts`), never
     actually rendered it — which is why the device's own diagnostic
     line showed no channel info at all, the exact gap this item is
     about. Fixed two ways: (a) `channel` is now always appended to the
     line (`channel preview` / `channel none` — a NULL channel here is
     itself the single most decisive signal there is, since
     `expo-updates`' own docs state this is always `null` for Expo Go
     and a development-client build, meaning such a build can never
     receive an OTA update no matter what's published, full stop, no
     further investigation needed); (b) a brand-new `runtimeVersion`
     field (`Updates.runtimeVersion`, never previously captured at all)
     is now also always appended (`runtime 1.0.0` / `runtime unknown`)
     so the runtime-version-mismatch hypothesis from item 1 can be
     checked directly against `eas update:view <id>`'s own reported
     runtime version, without needing to reconstruct it from
     `app.config.js` by hand. Both appear on the SAME footer line
     Settings already showed (and `ScreenErrorBoundary`'s crash screen
     shares verbatim) — no new screen, no new tap target, the existing
     triple-tap-for-daily-tip-diagnostics gesture on this same line is
     unchanged. **Circularity, stated plainly**: since this device is
     not receiving OTA updates AT ALL (that's the finding this whole
     entry is about), this diagnostic improvement itself cannot reach
     the device via `eas update` either — it will only become visible
     after the next NATIVE BUILD, same as the runtime-version-mismatch
     scenario in item 3(b) above.
  5. **Re-verification of earlier "fixed and shipped" claims, per the
     user's own explicit instruction**: every fix reported as "shipped"
     via `eas update` earlier the same day (2026-08-28 — the AI Coach
     chat reachability fix, the Prime operating-statement reconciliation,
     the sub-ledger accounting verification, the Profit Analysis window
     fix, and the Dashboard Net Profit unification) was verified CORRECT
     IN THE REPOSITORY (committed, pushed, tests passing) but its
     actual presence ON THE DEVICE cannot be confirmed from this
     environment and must be re-checked once OTA delivery is confirmed
     working (or after the next native build, whichever resolves this).
     None of that code is suspect — only whether it has ever actually
     executed on the reporting device.
  Tests: `buildInfoFormat.test.ts` gained coverage for the new
  channel/runtime-version segments (always shown, never omitted, unlike
  the commit segment) including a dedicated case reproducing the exact
  literal device string from the report. Full suite: 130 suites / 3561
  tests pass (+3); `tsc --noEmit` clean. No SQL/Edge Function changes —
  this is a pure client-side diagnostic addition. Per point 4's own
  circularity note, this specific change needs a native rebuild to
  actually reach the reporting device, unlike every other fix shipped
  today.

- EAS UPDATE NOT REACHING THE DEVICE, ROUND 2 — A MANUAL "CHECK FOR
  UPDATE NOW" (owner decision 2026-08-28, follow-up to the same-day
  round-1 diagnostic-visibility entry above). The user re-asked all four
  diagnostic questions after the round-1 fix (channel/runtime-version now
  shown in Settings' footer) couldn't yet have reached their device
  itself — expected, per that entry's own stated circularity: a device
  receiving zero OTA updates can't receive the fix that would prove it.
  Items 1-3 and 5 are UNCHANGED from the round-1 entry (same confirmed
  `runtimeVersion: {policy: 'appVersion'}`, same `1.0.0` never bumped,
  same `preview` channel in `eas.json`, same "run these exact commands
  yourself" limitation — this sandbox still has no `eas`
  CLI/credentials, confirmed again by re-running `eas --version`) — not
  repeated here, see that entry.
  **Item 4, actually answered this time**: audited every file under
  `app/` for a manual `Updates.checkForUpdateAsync()`/
  `fetchUpdateAsync()`/`reloadAsync()` call — none exist anywhere
  (confirmed by grep). This app has ALWAYS relied entirely on
  `expo-updates`' own automatic background check, which — per
  `expo-updates`' own `UpdatesCheckAutomaticallyValue` docs
  (`node_modules/expo-updates/build/Updates.types.d.ts`) — defaults to
  `ON_LOAD` ("checks for updates whenever the app is loaded... the
  default setting") when `app.config.js` sets no override (confirmed:
  it doesn't). So `checkAutomatically` is not misconfigured to disable
  checking — but an automatic, silent, cold-start-only check has no way
  to SURFACE its own result (found vs. not-found vs. a genuine fetch
  error) to the user, ever, by design. That's the actual gap item 4 was
  circling — not a swallowed error in app code (there was none to find,
  since there was no app code doing the checking at all) but the total
  ABSENCE of any observable, on-demand check.
  **The fix**: `app/src/lib/checkForUpdateFormat.ts` (pure,
  zero-`expo-updates`-import, tested — same
  `buildInfo.ts`/`buildInfoFormat.ts` pure/impure split this codebase
  already established for exactly this "native module vs. testable
  logic" reason) + `app/src/lib/checkForUpdate.ts` (the thin
  orchestrator — calls the real `Updates.isEnabled`/
  `checkForUpdateAsync()`/`fetchUpdateAsync()`/`reloadAsync()`, hands the
  raw outcome to the pure mapper). Wired into Settings
  (`app/app/(tabs)/more/settings.tsx`) as a new, ALWAYS-VISIBLE "Check
  for Update" card (deliberately NOT triple-tap-gated like the Daily Tip
  Diagnostics panel next to it — this is a real, everyday action a user
  should be able to reach without knowing a secret gesture) sitting
  directly above the existing build-info footer line: a "Check for
  Update Now" button calls `checkForUpdateNow()` and shows one of four
  outcomes inline, in real language, with the raw underlying message
  always visible underneath (never summarized away) — 🟠 **disabled**
  (`Updates.isEnabled === false` — this build cannot receive an OTA
  update AT ALL, full stop, regardless of channel/branch/runtime-version
  investigation, since this is true for Expo Go and any development-
  client build by `expo-updates`' own design); 🔴 **error** (the exact
  caught exception message from `checkForUpdateAsync()` — a network
  failure, a manifest/runtime-version mismatch, or a server error each
  produce distinct real text here, never a generic "something went
  wrong"); 🟢 **update-available** (with a "Download & Restart" button
  that calls `downloadAndApplyUpdate()` — `fetchUpdateAsync()` then
  `reloadAsync()` — right there, no waiting for the next cold start
  either); and **up-to-date** (checked successfully, nothing new for
  this build/channel/runtime-version combination). This answers "is OTA
  delivery broken, and why" from the DEVICE ITSELF, on demand, which is
  the one piece of this whole investigation that's answerable from a
  real device but NOT from a dev sandbox with no EAS CLI/credentials.
  **Item 6, satisfied by this same change**: the build-info footer line
  from round 1 (channel/runtime-version, always visible, no tap needed)
  already covers "a real, always-visible version/commit indicator" —
  this pass adds the missing ACTIVE half: a button that actually
  exercises the update-check path on demand and reports exactly what
  happened, so a failed/blocked update is never invisible again on
  EITHER axis (what's currently running, AND whether checking for
  something new even works).
  **Same circularity as round 1, stated again plainly**: since the
  reporting device isn't receiving OTA updates, this new button — like
  round 1's diagnostic line — cannot reach that device via `eas update`
  either. It needs a native rebuild to actually appear. Once it does,
  though, it becomes the definitive, permanent answer to "is my update
  mechanism healthy right now" for every future device, with zero
  dependency on this sandbox's own missing EAS CLI access.
  Tests: `checkForUpdateFormat.test.ts` (new, 5 tests) — the disabled
  state wins regardless of what outcome accompanies it, the error
  message passes through verbatim, both branches of "available" (with
  and without a manifest id), and the up-to-date case. Full suite: 132
  suites / 3577 tests pass (+5); `tsc --noEmit` clean; all 7 locales
  confirmed key-parity (`settings.checkForUpdate*`/`applyUpdate*` — es/
  ru/tr/hi/ar fully translated, uk as an untranslated English copy per
  invariant #11). No SQL/Edge Function changes — pure client-side JS/TS.
  Ships via a normal `eas update` for every device that's already
  receiving them; needs a native rebuild for the one that isn't, per the
  circularity note above.
