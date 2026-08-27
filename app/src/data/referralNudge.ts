import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useMyReferralCode, useMyReferrals } from '@/src/data/referral';
import { useProfile, useUpdateProfile } from '@/src/data/profile';
import { selectNudgesToShow, recordNudgesShown, type NudgeState } from '@/src/alerts/nudgeFrequency';
import {
  detectReferralNudge,
  hasQualifiedReferralRecently,
  computeReferralProgress,
  recordReferralNudgeDismissed,
  REFERRAL_NUDGE_COOLDOWN_MS,
  type ReferralNudgeTopic,
} from '@/src/referral/referralNudge';
import { buildReferralShareMessage } from '@/src/referral/shareMessage';
import { shareViaSystemSheet } from '@/src/referral/referralShare';
import { buildAuthRedirectUrl } from '@/src/auth/deepLinkRedirect';

// REFERRAL NUDGE — DATA WIRING (owner decision, Part 2 of the AI Coach
// daily-tips request: "surface at the RIGHT moments... Share button right
// there, pre-written message in their language, progress shown"). Same
// hook-fetches/pure-module-decides split as useDailyTip(). `metGoalThisWeek`
// is passed in by the caller (Home already computes proactive.goalProgress
// via useProactiveCoach() — reused here rather than a second goal-progress
// calculation).
export function useReferralNudge(metGoalThisWeek: boolean) {
  const { session } = useAuth();
  const code = useMyReferralCode();
  const referralsQuery = useMyReferrals();
  const profileQuery = useProfile();
  const updateProfile = useUpdateProfile();
  const [sharing, setSharing] = useState(false);

  const accountCreatedAt = session?.user?.created_at ?? null;
  const accountAgeDays = accountCreatedAt ? Math.floor((Date.now() - new Date(accountCreatedAt).getTime()) / 86400000) : 0;
  const referrals = referralsQuery.data ?? [];
  const rewardEligibleCount = referrals.filter((r) => r.status === 'qualified' || r.status === 'rewarded').length;
  const progress = computeReferralProgress(rewardEligibleCount);

  const candidate = detectReferralNudge({
    hasQualifiedReferralRecently: hasQualifiedReferralRecently(referrals),
    metGoalThisWeek,
    hasExportedAccountantPackage: !!profileQuery.data?.accountant_package_exported_at,
    accountAgeDays,
    referralProgress: progress,
  });

  const nudgeState: NudgeState<ReferralNudgeTopic> = (profileQuery.data?.nudge_state as NudgeState<ReferralNudgeTopic>) ?? {};
  const visible = candidate
    ? selectNudgesToShow([candidate], nudgeState, accountCreatedAt, new Date(), REFERRAL_NUDGE_COOLDOWN_MS)
    : [];
  const selected = visible[0] ?? null;

  const recordedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selected || !profileQuery.data) return;
    const key = `${selected.topic}:${new Date().toISOString().slice(0, 10)}`;
    if (recordedKeyRef.current === key) return;
    recordedKeyRef.current = key;
    const nextState = recordNudgesShown(nudgeState, [selected.topic], new Date());
    updateProfile.mutate(
      { nudge_state: nextState },
      {
        onError: (err) => {
          console.error('[useReferralNudge] failed to record nudge shown:', err);
          recordedKeyRef.current = null;
        },
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, profileQuery.data]);

  function dismiss() {
    if (!selected) return;
    updateProfile.mutate(
      { nudge_state: recordReferralNudgeDismissed(nudgeState, selected.topic, new Date()) },
      { onError: (err) => console.error('[useReferralNudge] failed to dismiss:', err) }
    );
  }

  async function share(t: (key: string, opts?: Record<string, unknown>) => string) {
    if (!code) return;
    setSharing(true);
    try {
      const message = buildReferralShareMessage({
        code,
        body: t('referral.shareBody'),
        deepLink: `${buildAuthRedirectUrl('sign-up')}?ref=${encodeURIComponent(code)}`,
      });
      await shareViaSystemSheet(message);
    } finally {
      setSharing(false);
    }
  }

  return { nudge: selected, progress, dismiss, share, sharing };
}
