// BETA FEEDBACK ROUND 2 (owner decision 2026-07-31): the navigation
// intent table for "where does back go" — one pure function every route
// in the app is classified by, instead of the answer living only in
// developers' heads. See useResetStackOnTabBlur.ts for the mechanism
// that GUARANTEES this table is accurate (without it, a screen nested
// under /(tabs)/more/ could accumulate stale history and land somewhere
// other than 'moreIndex').
export type BackTarget = 'home' | 'moreIndex';

// A route nested under /(tabs)/more/ (any screen but more/index itself)
// lives in the one shared Stack navigator (app/(tabs)/more/_layout.tsx)
// — back from it lands on more/index first (exactly 1 hop, guaranteed by
// useResetStackOnTabBlur resetting that stack to just [index, thisRoute]
// on every fresh entry), then a second back press reaches Home via the
// Tabs navigator's backBehavior="initialRoute"
// (app/(tabs)/_layout.tsx). Every other route is its own top-level tab
// (or the tabs root itself, or more/index) — back reaches Home directly,
// in one press.
export function backTargetFor(href: string): BackTarget {
  const isMoreDetailScreen = href.startsWith('/(tabs)/more/');
  return isMoreDetailScreen ? 'moreIndex' : 'home';
}
