import { isScrolledNearBottom, isScrollGateSatisfied } from '@/src/legal/tosScrollGate';

describe('isScrolledNearBottom', () => {
  it('is false while there is meaningfully more content below the fold', () => {
    expect(isScrolledNearBottom({ layoutHeight: 600, contentOffsetY: 0, contentHeight: 2000 })).toBe(false);
  });

  it('is true once within the default 24px threshold of the bottom', () => {
    expect(isScrolledNearBottom({ layoutHeight: 600, contentOffsetY: 1400, contentHeight: 2000 })).toBe(true);
    expect(isScrolledNearBottom({ layoutHeight: 600, contentOffsetY: 1376, contentHeight: 2000 })).toBe(true);
    expect(isScrolledNearBottom({ layoutHeight: 600, contentOffsetY: 1375, contentHeight: 2000 })).toBe(false);
  });

  it('respects a custom threshold', () => {
    expect(isScrolledNearBottom({ layoutHeight: 600, contentOffsetY: 1350, contentHeight: 2000, thresholdPx: 50 })).toBe(true);
  });
});

describe('isScrollGateSatisfied (2026-07-30 tablet bug fix)', () => {
  it('is satisfied once the user has actually scrolled to the end, regardless of measured sizes', () => {
    expect(isScrollGateSatisfied({ scrolledToEnd: true, containerHeight: 0, contentHeight: 0 })).toBe(true);
  });

  it('is NOT satisfied before measurement resolves (both heights still 0)', () => {
    expect(isScrollGateSatisfied({ scrolledToEnd: false, containerHeight: 0, contentHeight: 0 })).toBe(false);
  });

  it('is satisfied when the content fits entirely within the viewport — the tablet case, no scroll event will ever fire', () => {
    expect(isScrollGateSatisfied({ scrolledToEnd: false, containerHeight: 2000, contentHeight: 1200 })).toBe(true);
    // Exactly equal counts as "fits".
    expect(isScrollGateSatisfied({ scrolledToEnd: false, containerHeight: 1200, contentHeight: 1200 })).toBe(true);
  });

  it('is NOT satisfied when content overflows the viewport and the user has not scrolled yet', () => {
    expect(isScrollGateSatisfied({ scrolledToEnd: false, containerHeight: 600, contentHeight: 2000 })).toBe(false);
  });
});
