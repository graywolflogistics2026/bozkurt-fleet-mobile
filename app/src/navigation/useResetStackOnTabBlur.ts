import { useEffect } from 'react';
import { useNavigation, StackActions } from '@react-navigation/native';

// BETA FEEDBACK ROUND 2 (owner decision 2026-07-31, device tester report:
// "pressing back lands on the SETTLEMENTS screen instead of Home" — the
// prior backBehavior="initialRoute" fix did not resolve it). ROOT CAUSE,
// confirmed by reading the installed expo-router/react-navigation source
// (node_modules/@react-navigation/routers/src/StackRouter.tsx, node_modules/
// expo-router/build/global-state/routing.js), not guessed: every screen
// under app/(tabs)/more/ shares ONE nested Stack navigator
// (more/_layout.tsx). A cross-tab navigation into it (Home cards, the
// Reports hub, CEO Mode recommendations, Scorecard, ...) via
// router.push() dispatches a PUSH action against that Stack's OWN
// existing state — StackRouter's PUSH handler always appends to
// state.routes; there is no implicit reset for an already-mounted nested
// navigator. Across a session, visiting different cards from Home
// (cash-flow, then later settlements, then later tax-estimator, ...)
// without returning all the way to Home in between left the "more"
// stack silently several screens deep — so back popped through THAT
// accumulated history, landing on whatever unrelated screen happened to
// still be sitting there (e.g. Settlements), never Home.
// backBehavior="initialRoute" (app/(tabs)/_layout.tsx) only governs what
// happens once a TAB's own stack is already empty — it does nothing to
// stop the stack from accumulating in the first place, which is why it
// didn't fix the reported symptom.
//
// Fix: call this hook once, from the ALWAYS-mounted root screen of the
// shared stack (more/index.tsx) — it resets that stack back to just its
// root every time the OWNING TAB loses focus (the user switches to a
// different tab), so re-entering it from ANY origin always starts clean:
// exactly [index, target], never a stale accumulation. This makes back
// deterministic and bounded — at most 2 presses to reach Home (target ->
// more/index -> Home, the last hop via backBehavior="initialRoute") —
// instead of unbounded and unpredictable. Applies identically to the
// in-app header back arrow and the Android hardware back button, since
// both dispatch through the same navigator tree this hook operates on.
// See src/navigation/backIntent.ts for the full per-route back-target
// table this guarantees, and docs/DATA_FLOW.md for the "how routes must
// be opened from now on" rule.
export function useResetStackOnTabBlur() {
  const navigation = useNavigation();

  useEffect(() => {
    const parent = navigation.getParent();
    if (!parent) return;
    return parent.addListener('blur', () => {
      navigation.dispatch(StackActions.popToTop());
    });
  }, [navigation]);
}
