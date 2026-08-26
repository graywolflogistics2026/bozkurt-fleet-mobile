import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getLanguageScreenSeen, setLanguageScreenSeen as persistLanguageScreenSeen } from '@/src/i18n/localeStorage';

type LanguageGateContextValue = {
  languageScreenSeen: boolean | null; // null = not yet resolved from AsyncStorage
  markLanguageScreenSeen: () => void;
};

const LanguageGateContext = createContext<LanguageGateContextValue | undefined>(undefined);

// FIRST-RUN LANGUAGE SCREEN (owner decision, LANGUAGE PICKER — FIVE
// LANGUAGES AT LAUNCH) — same "lift the flag into a shared context so the
// writer screen and RootLayoutNav's redirect effect can never read a stale
// separate value" pattern as IntroContext.tsx (see that file's own header
// comment for the real-device redirect-loop bug this pattern prevents).
// markLanguageScreenSeen() updates the in-memory flag SYNCHRONOUSLY, before
// the AsyncStorage write resolves, so the very next render already sees the
// change — this is what lets app/language.tsx rely purely on
// RootLayoutNav's own gate-recomputation to move on to whatever comes next
// (intro / sign-in / confirm-email / tos / tutorial / onboarding / tabs,
// depending on session state) instead of hardcoding a specific next route
// itself.
export function LanguageGateProvider({ children }: { children: ReactNode }) {
  const [languageScreenSeen, setLanguageScreenSeenState] = useState<boolean | null>(null);

  useEffect(() => {
    getLanguageScreenSeen()
      .then(setLanguageScreenSeenState)
      .catch((err) => {
        // A read failure must never hang the app on the loading screen
        // forever (RootLayoutNav waits for languageScreenSeen !== null) —
        // default to "unseen" so the user just sees the language screen
        // once more than strictly necessary, never a lock-out.
        console.error('[LanguageGateContext] Failed to read language-screen-seen flag — defaulting to unseen.', err);
        setLanguageScreenSeenState(false);
      });
  }, []);

  function markLanguageScreenSeen() {
    setLanguageScreenSeenState(true);
    persistLanguageScreenSeen().catch((err) => {
      // Never blocks the user past the language screen: worst case the
      // flag didn't save and it shows again next cold start.
      console.error('[LanguageGateContext] Failed to persist language-screen-seen flag (non-fatal).', err);
    });
  }

  return (
    <LanguageGateContext.Provider value={{ languageScreenSeen, markLanguageScreenSeen }}>
      {children}
    </LanguageGateContext.Provider>
  );
}

export function useLanguageGate() {
  const ctx = useContext(LanguageGateContext);
  if (!ctx) throw new Error('useLanguageGate must be used within LanguageGateProvider');
  return ctx;
}
