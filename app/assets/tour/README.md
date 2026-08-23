# First-Run Tutorial illustrations

Owner decision 2026-08-05, FULL PARITY follow-up item I.

Today every tutorial slide renders an **in-app `react-native-svg` scene**
(`app/src/onboarding/slideVisuals.tsx`) — simple line-art icons, no image
files required, works offline, scales to any screen size with zero asset
weight added to the app bundle.

If a future pass wants real illustrated artwork instead, drop PNG files
here using these exact names (one per slide, in tutorial order) and swap
`slideVisuals.tsx`'s `SLIDE_VISUALS` registry entries from the SVG
components to `<Image source={require('@/assets/tour/tour-0N-*.png')} />`
— that registry is the ONE place this swap needs to happen; the pager
component (`app/src/components/TutorialPager.tsx`) and every entry point
(first-run gate, Settings > "How It Works", Import's "See how" link) read
through the registry and never need to change.

Expected filenames, matching `app/src/onboarding/tutorialSlides.ts`'s
`TUTORIAL_SLIDES` order:

| File | Slide id | Title |
|---|---|---|
| `tour-01-snap.png` | `snap` | Snap It |
| `tour-02-ai-reads.png` | `aiReads` | AI Reads It |
| `tour-03-confirm.png` | `confirm` | You Confirm |
| `tour-04-lands-everywhere.png` | `landsEverywhere` | It Lands Everywhere |
| `tour-05-documents-kept.png` | `documentsKept` | Your Documents Are Kept |
| `tour-06-report.png` | `readyForAccountant` | Ready for Your Accountant |

Recommended size: roughly 800x800px (square), transparent or dark-theme-
matching background (`colors.bg`/`colors.card` from `app/src/theme.ts`)
so the illustration doesn't visually clash with the app's dark UI.
