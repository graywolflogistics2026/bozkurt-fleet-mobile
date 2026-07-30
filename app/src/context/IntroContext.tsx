import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getIntroSeen, setIntroSeen as persistIntroSeen } from '@/src/onboarding/introStorage';

type IntroContextValue = {
  introSeen: boolean | null; // null = not yet resolved from AsyncStorage
  markIntroSeen: () => void;
};

const IntroContext = createContext<IntroContextValue | undefined>(undefined);

// Fixes a real-device redirect loop (2026-07-29): the intro screen used to
// call the storage-layer setIntroSeen() directly, then router.replace() —
// but RootLayoutNav's redirect effect read a SEPARATE, stale in-memory
// introSeen value (local useState, resolved once on mount) that never
// found out the flag had changed, so the very next render bounced the user
// straight back to /intro. Lifting the flag into this context means both
// the Intro screen (writer) and RootLayoutNav (reader) share the exact
// same in-memory value — markIntroSeen() updates it SYNCHRONOUSLY, before
// the AsyncStorage write even resolves, so the redirect effect sees the
// change on the very next render regardless of how long/whether the
// storage write itself succeeds.
export function IntroProvider({ children }: { children: ReactNode }) {
  const [introSeen, setIntroSeenState] = useState<boolean | null>(null);

  useEffect(() => {
    getIntroSeen()
      .then(setIntroSeenState)
      .catch((err) => {
        // A read failure here must never hang the app on the loading
        // screen forever (RootLayoutNav waits for introSeen !== null) —
        // default to "unseen" so the user just sees the intro once more
        // than strictly necessary, never a lock-out.
        console.error('[IntroContext] Failed to read intro-seen flag from AsyncStorage — defaulting to unseen.', err);
        setIntroSeenState(false);
      });
  }, []);

  function markIntroSeen() {
    // In-memory update first (this is what the redirect effect reads) —
    // the caller can navigate immediately after calling this, it never has
    // to await the persist below.
    setIntroSeenState(true);
    persistIntroSeen().catch((err) => {
      // Never swallowed, and never blocks the user past the intro screen:
      // worst case the flag didn't save and they see the intro again next
      // cold start, which is annoying but never a lock-out.
      console.error('[IntroContext] Failed to persist intro-seen flag (non-fatal — intro may show again next launch).', err);
    });
  }

  return <IntroContext.Provider value={{ introSeen, markIntroSeen }}>{children}</IntroContext.Provider>;
}

export function useIntro() {
  const ctx = useContext(IntroContext);
  if (!ctx) throw new Error('useIntro must be used within IntroProvider');
  return ctx;
}
