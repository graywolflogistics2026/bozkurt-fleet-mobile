import { useState } from 'react';

// BETA FEEDBACK ROUND: "collapse state remembered per screen for the
// session." A plain useState in the screen component would reset on
// every unmount (e.g. navigating away and back), which reads as "it
// forgot" to a user even within the same app session. A module-level Map
// — NOT AsyncStorage, NOT a saved profile field — is deliberately the
// right amount of persistence here: it survives remounts for as long as
// the JS process is alive (the actual "session"), and resets on a real
// app restart, exactly matching "for the session," not "forever."
// Keyed by `${screenKey}:${monthKey}` so every screen's month collapse
// state is independent — collapsing July on Settlements never affects
// July on Deductions.
const sessionCollapseState = new Map<string, boolean>();

function keyFor(screenKey: string, monthKey: string): string {
  return `${screenKey}:${monthKey}`;
}

// `defaultCollapsed(monthKey)` decides the first-ever-seen state for a
// month this session (current month expanded, everything else collapsed
// — the screen passes in `monthKey !== currentMonthKey`). Once a user
// has touched a month's collapse state, that choice sticks regardless of
// what defaultCollapsed would now say.
export function useMonthCollapse(screenKey: string, defaultCollapsed: (monthKey: string) => boolean) {
  const [, setTick] = useState(0);

  function isCollapsed(monthKey: string): boolean {
    const key = keyFor(screenKey, monthKey);
    if (!sessionCollapseState.has(key)) {
      sessionCollapseState.set(key, defaultCollapsed(monthKey));
    }
    return sessionCollapseState.get(key)!;
  }

  function toggle(monthKey: string) {
    const key = keyFor(screenKey, monthKey);
    sessionCollapseState.set(key, !isCollapsed(monthKey));
    setTick((n) => n + 1);
  }

  return { isCollapsed, toggle };
}
