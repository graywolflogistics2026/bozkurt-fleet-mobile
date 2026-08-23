import { TUTORIAL_SLIDES, tutorialSlideIndex } from '@/src/onboarding/tutorialSlides';

describe('TUTORIAL_SLIDES (owner decision 2026-08-05, FULL PARITY follow-up item I)', () => {
  it('has exactly 6 slides, per spec', () => {
    expect(TUTORIAL_SLIDES).toHaveLength(6);
  });

  it('has the exact slide order the spec names', () => {
    expect(TUTORIAL_SLIDES.map((s) => s.id)).toEqual([
      'snap',
      'aiReads',
      'confirm',
      'landsEverywhere',
      'documentsKept',
      'readyForAccountant',
    ]);
  });

  it('every slide has a unique id and non-empty i18n keys', () => {
    const ids = TUTORIAL_SLIDES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const slide of TUTORIAL_SLIDES) {
      expect(slide.titleKey.length).toBeGreaterThan(0);
      expect(slide.bodyKey.length).toBeGreaterThan(0);
    }
  });
});

describe('tutorialSlideIndex', () => {
  it('finds the correct index for a known slide id', () => {
    expect(tutorialSlideIndex('snap')).toBe(0);
    expect(tutorialSlideIndex('readyForAccountant')).toBe(5);
  });
});
