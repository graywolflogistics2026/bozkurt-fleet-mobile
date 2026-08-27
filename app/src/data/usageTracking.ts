import { useAuth } from '@/src/context/AuthContext';
import { useProfile } from '@/src/data/profile';
import { supabase } from '@/src/lib/supabase';
import { buildActionEvent, buildScreenOpenEvent, shouldTrack, type AppUsageEventInsert, type AppUsageEventStatus } from '@/src/analytics/usageTracking';

// USAGE ANALYTICS — DATA WIRING (owner decision, docs/PENDING_SQL.md §71).
// Always fire-and-forget: a failed/slow analytics write must never throw,
// never block, and never be visible to the real feature the user is
// actually using — same "never let a side channel affect the main flow"
// principle as buildAndUploadBackupSnapshot()/recordExportedForReferralNudge()
// elsewhere in this app. Writes directly via the caller's own JWT-scoped
// client (RLS enforces both `user_id = auth.uid()` and the opt-out check
// server-side) — no Edge Function needed, there's no money/atomicity
// concern here at all.
async function insertEvent(event: AppUsageEventInsert): Promise<void> {
  try {
    const { error } = await supabase.from('app_usage_events').insert(event);
    if (error) console.error('[usageTracking] failed to record event (non-fatal):', error);
  } catch (err) {
    console.error('[usageTracking] failed to record event (non-fatal):', err);
  }
}

// One hook, used identically everywhere a screen or action needs to log an
// event — binds the current user id + their live opt-out preference once,
// so call sites never have to thread either through by hand.
// react-query dedupes concurrent useProfile() calls by query key, so
// calling this from several mounted screens at once (e.g. the root layout
// AND the current screen) never issues extra network requests.
export function useUsageTracking() {
  const { session } = useAuth();
  const profileQuery = useProfile();
  const userId = session?.user.id ?? null;
  const optedOut = profileQuery.data?.usage_analytics_opt_out;

  function trackScreenOpen(screenName: string) {
    if (!userId || !shouldTrack(optedOut)) return;
    void insertEvent(buildScreenOpenEvent(userId, screenName));
  }

  function trackAction(actionName: string, status: AppUsageEventStatus) {
    if (!userId || !shouldTrack(optedOut)) return;
    void insertEvent(buildActionEvent(userId, actionName, status));
  }

  return { trackScreenOpen, trackAction };
}
