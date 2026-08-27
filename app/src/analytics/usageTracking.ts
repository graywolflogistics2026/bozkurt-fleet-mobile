// USAGE ANALYTICS (owner decision, privacy-safe, owner-only, docs/PENDING_SQL.md
// §71) — "so I can learn which screens are actually used before deciding
// what to simplify." Records ONLY the event itself: which screen was
// opened, which action was started/completed, when, and by which user id —
// NEVER a financial value, a description, a document's contents, or
// anything else about what the user actually did on that screen. Stored in
// `app_usage_events`, which has NO select policy for a normal
// authenticated/anon user at all (see the SQL) — only the service_role or
// the Supabase SQL Editor's own postgres role (which bypasses RLS as the
// table owner) can ever read it back; a regular user can INSERT their own
// rows and nothing else.
//
// PURE half — the actual network write (usageTrackingClient.ts) is a thin,
// always-best-effort wrapper around these builders/gates, same
// "hook fetches, pure module decides" split as dailyTips.ts/proactiveCoach.ts.

export type AppUsageEventKind = 'screen' | 'action';
export type AppUsageEventStatus = 'started' | 'completed';

export type AppUsageEventInsert = {
  user_id: string;
  kind: AppUsageEventKind;
  name: string;
  status: AppUsageEventStatus | null;
  created_at: string;
};

export function buildScreenOpenEvent(userId: string, screenName: string, now: Date = new Date()): AppUsageEventInsert {
  return { user_id: userId, kind: 'screen', name: normalizeScreenName(screenName), status: null, created_at: now.toISOString() };
}

export function buildActionEvent(userId: string, actionName: string, status: AppUsageEventStatus, now: Date = new Date()): AppUsageEventInsert {
  return { user_id: userId, kind: 'action', name: actionName, status, created_at: now.toISOString() };
}

// Client-side short-circuit — the REAL, authoritative privacy guarantee is
// the server-side RLS insert policy itself (it re-checks
// profiles.usage_analytics_opt_out on every insert, straight from the live
// row, never a value the client could have cached stale) — this exists
// only so an opted-out device doesn't bother making the network call at
// all. `optedOut` is `null`/`undefined` (profile not loaded yet, or the
// column not yet migrated) treated as "tracking on" — matching the
// column's own `default false` semantics.
export function shouldTrack(optedOut: boolean | null | undefined): boolean {
  return optedOut !== true;
}

// expo-router's usePathname() is already normalized for this app's routes,
// but this stays a real, separate, testable function rather than assuming
// that forever — strips a trailing slash on anything longer than the bare
// root ('/'), so a route reached two different ways can never silently
// double-count as two different screen names.
export function normalizeScreenName(pathname: string): string {
  if (!pathname) return '/';
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}
