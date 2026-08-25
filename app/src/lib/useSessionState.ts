import { useState } from 'react';

// DEDUCTIONS & SETTLEMENTS — TOTALS + CHARTS (owner decision, "period
// tabs" pass) — "remembered for the session" (spec item 2b). Same pattern
// src/components/monthGroups/useMonthCollapse.ts already established for
// exactly this class of requirement: a plain component-level useState
// would reset on every unmount (navigating away and back reads as "it
// forgot" within the same app session); a module-level Map — NOT
// AsyncStorage, NOT a saved profile field — survives remounts for as long
// as the JS process is alive (the real "session") and resets on an actual
// app restart, matching "for the session," not "forever." Generic (unlike
// useMonthCollapse, which is month-collapse-specific) so both the
// Deductions and Settlements screens' own period-tab selection can each
// use it under their own distinct key without a second bespoke module.
const sessionState = new Map<string, unknown>();

export function useSessionState<T>(key: string, initial: T): [T, (value: T) => void] {
  if (!sessionState.has(key)) sessionState.set(key, initial);
  const [, setTick] = useState(0);

  function setValue(next: T) {
    sessionState.set(key, next);
    setTick((n) => n + 1);
  }

  return [sessionState.get(key) as T, setValue];
}
