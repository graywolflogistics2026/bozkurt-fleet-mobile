// Terms of Use "scroll to the bottom before Accept enables" gate,
// extracted into pure, testable functions (2026-07-30 tablet bug fix —
// same "silent dead button" family as the sign-up validation gate and
// the intro-slides redirect loop).
//
// Root cause this fixes: the gate only ever flipped true from an onScroll
// event. On a tablet's much taller viewport, this screen's fixed small
// body text can fit ENTIRELY within the visible ScrollView with nothing
// left to scroll — no scroll event ever fires, so the gate stayed false
// forever and Accept looked permanently, silently broken.
export function isScrolledNearBottom(params: {
  layoutHeight: number;
  contentOffsetY: number;
  contentHeight: number;
  thresholdPx?: number;
}): boolean {
  const threshold = params.thresholdPx ?? 24;
  return params.layoutHeight + params.contentOffsetY >= params.contentHeight - threshold;
}

// The gate is satisfied either because the user scrolled to (near) the
// bottom, OR because the content fits entirely within the viewport in
// the first place — there's nothing to scroll to, so requiring a scroll
// event that will never happen would be the bug, not a safeguard.
export function isScrollGateSatisfied(params: { scrolledToEnd: boolean; containerHeight: number; contentHeight: number }): boolean {
  if (params.scrolledToEnd) return true;
  if (params.containerHeight <= 0 || params.contentHeight <= 0) return false;
  return params.contentHeight <= params.containerHeight;
}
