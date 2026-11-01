# Automatic document scanner (batch E, 2026-10-31)

The camera finds the paper or receipt, flattens it and crops only that
area, like a scanner app. NATIVE change: it reaches a device only through
`eas build`, never `eas update`.

## Library check (E1)

Chosen: `react-native-document-scanner-plugin` 2.0.4 (MIT, last release
2026-01). Android = Google ML Kit Document Scanner, iOS = Apple VisionKit,
so iOS works later without a second library. It is a TurboModule; this
project is Expo SDK 54 / React Native 0.81.5 with the New Architecture on
(the SDK 54 default, no `newArchEnabled: false` anywhere). Ships an Expo
config plugin (`app.plugin.js`, sets the iOS camera text). `npx expo install`
accepted it; `expo-doctor` 17/18 — the one failing check is older patch
mismatches (expo 54.0.35 vs 54.0.37, expo-constants, expo-file-system,
expo-updates, @react-navigation/native minor), not this library.
Not chosen: `expo-document-scanner` 1.0.0 (one week old, needs
react-native-nitro-modules); `@dariyd/react-native-document-scanner` 2.2.0
(fine, but smaller user base). Android needs Google Play services and about
1.7 GB RAM; ML Kit's own UI asks for the camera permission.
PDF merge: `pdf-lib` 1.17.1 (MIT, pure JS, stable since 2022, runs on the
device, embeds the JPEG bytes unchanged so the size is predictable).

## How it works (E2-E3)

- `app/src/scan/scanDocument.ts` `captureDocument()` — the ONE helper.
  Used by Import "Scan document", the Deductions receipt and For Prime Inc
  Drivers. Unsupported (old binary, Expo Go, no Play services), denied or
  failed -> the plain camera (Import: its existing camera screen). Cancel
  -> nothing. "Plain photo", "From gallery" and "PDF" stay as buttons.
- Maintenance, tolls, equipment, vehicle purchase documents and Documents
  have no photo button of their own today (they come in through Import),
  so they get the scanner through Import.
- `app/src/scan/scanCore.ts` (pure, tested): JPEG 85%, long edge <= 2,200
  px; at most 10 pages on both platforms (extra pages are deleted and the
  user is told); 1 page -> the JPEG, 2-10 pages -> ONE PDF -> the existing
  resumable page-by-page background import; over 10 MB -> recompress
  (0.70/2000, 0.60/1700, 0.50/1400 px), still over -> "scan fewer pages",
  never a silent cut.
- The native module is required lazily inside try/catch
  (`app/src/scan/scanDeps.ts`): its module file throws at import time on a
  binary without it.

## Privacy (E4)

The scan runs on the device; nothing is uploaded until the user starts the
import or attaches the file (the same moment a plain photo was uploaded
before). There is no separate "AI consent" screen in the app today — the
first upload point is the import/attach action itself. Temp files are
deleted after the upload, on reset/cancel of the import, and when a scan is
cancelled or too large.

Store-label line (draft, attorney): "On-device document scanning (Google ML
Kit Document Scanner on Android, Apple VisionKit on iOS); images stay on the
device until you import."

CHECK BEFORE FILING:
- Google Play Data Safety form: read Google's CURRENT statement on what ML
  Kit (the Document Scanner API via Google Play services) collects.
- Apple App Privacy: User Content "Photos or Videos" (verify on Apple's
  current page) when the iOS build ships.

## EAS (E5)

`version` 1.1.0 (was 1.0.0), Android `versionCode` 2, iOS `buildNumber` 2.
With `runtimeVersion: appVersion`, JS published for 1.1.0 never reaches a
1.0.0 binary that lacks the module. No iOS build now (Apple Developer
account and D-U-N-S still missing).
