// FIRST-RUN TUTORIAL (owner decision 2026-08-05, FULL PARITY follow-up
// item I) — the 6-slide illustrated walkthrough shown after signup + ToS
// acceptance and before the setup wizard, and replayable from Settings >
// "How it works" and every major empty state's "See how" link. This is
// the ONE shared slide list every entry point reads from — a pure data
// module, no React/native imports, so it's trivially unit-testable and
// can never drift between the first-run flow and the replay flow.
export type TutorialSlideId = 'snap' | 'aiReads' | 'confirm' | 'landsEverywhere' | 'documentsKept' | 'readyForAccountant';

export type TutorialSlide = {
  id: TutorialSlideId;
  titleKey: string;
  bodyKey: string;
};

export const TUTORIAL_SLIDES: TutorialSlide[] = [
  { id: 'snap', titleKey: 'tutorial.slides.snap.title', bodyKey: 'tutorial.slides.snap.body' },
  { id: 'aiReads', titleKey: 'tutorial.slides.aiReads.title', bodyKey: 'tutorial.slides.aiReads.body' },
  { id: 'confirm', titleKey: 'tutorial.slides.confirm.title', bodyKey: 'tutorial.slides.confirm.body' },
  { id: 'landsEverywhere', titleKey: 'tutorial.slides.landsEverywhere.title', bodyKey: 'tutorial.slides.landsEverywhere.body' },
  { id: 'documentsKept', titleKey: 'tutorial.slides.documentsKept.title', bodyKey: 'tutorial.slides.documentsKept.body' },
  { id: 'readyForAccountant', titleKey: 'tutorial.slides.readyForAccountant.title', bodyKey: 'tutorial.slides.readyForAccountant.body' },
];

export function tutorialSlideIndex(id: TutorialSlideId): number {
  return TUTORIAL_SLIDES.findIndex((s) => s.id === id);
}
