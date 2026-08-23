import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { useUpdateProfile } from '@/src/data/profile';
import { TutorialPager } from '@/src/components/TutorialPager';

// FIRST-RUN TUTORIAL (owner decision 2026-08-05, FULL PARITY follow-up
// item I) — shown once, gated between ToS acceptance and the onboarding
// wizard (app/src/navigation/rootRedirect.ts), and replayable afterward
// from Settings > "How it works" and every major empty state's "See how"
// link via `?replay=true`. The gated (first-run) path marks
// `tutorial_seen_at` and explicitly navigates to `/onboarding` (same
// explicit-navigate pattern as onboarding.tsx's own finishOnboarding(),
// rather than relying on the root-redirect effect to notice the profile
// change and re-route — faster, no extra render flash). The replay path
// never touches `tutorial_seen_at` again and just goes back to wherever
// the user came from.
export default function Tutorial() {
  const router = useRouter();
  const { replay } = useLocalSearchParams<{ replay?: string }>();
  const isReplay = replay === 'true';
  const { session } = useAuth();
  const updateProfile = useUpdateProfile();

  async function handleFinish() {
    if (isReplay) {
      router.back();
      return;
    }
    if (session) {
      try {
        await updateProfile.mutateAsync({ tutorial_seen_at: new Date().toISOString() });
      } catch {
        // Best-effort: even if this write fails, the root-redirect effect
        // will simply show the tutorial again next launch — never worth
        // blocking the user from moving on to onboarding right now.
      }
    }
    router.replace('/onboarding');
  }

  return <TutorialPager onFinish={handleFinish} />;
}
