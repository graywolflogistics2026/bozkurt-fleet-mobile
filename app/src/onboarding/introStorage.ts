import AsyncStorage from '@react-native-async-storage/async-storage';

// First-launch brand intro slides (Session 9e-B9) — shown once per device
// before sign-up/sign-in, same "cache a flag locally" pattern as
// src/i18n/localeStorage.ts. Signing out does NOT re-show it — this is a
// one-time first-impression, not a re-acceptance flow like Terms of Use.
const INTRO_SEEN_KEY = 'bozkurt-fleet-os-intro-seen';

export async function getIntroSeen(): Promise<boolean> {
  return (await AsyncStorage.getItem(INTRO_SEEN_KEY)) === 'true';
}

export async function setIntroSeen(): Promise<void> {
  await AsyncStorage.setItem(INTRO_SEEN_KEY, 'true');
}
