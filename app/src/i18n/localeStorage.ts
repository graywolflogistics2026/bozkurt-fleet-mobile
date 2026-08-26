import AsyncStorage from '@react-native-async-storage/async-storage';
import { isEnabledLocale, type SupportedLocale } from '@/src/i18n/config';

// Local cache of the user's chosen language, read synchronously-ish at boot
// (before profiles.locale can be fetched over the network) and kept in sync
// whenever the user changes it in Settings or signs into a device where
// profiles.locale differs from this device's cache.
const LOCALE_CACHE_KEY = 'bozkurt-fleet-os-locale';

// Validated against isEnabledLocale(), not isSupportedLocale() — a value
// cached before a locale was disabled (or corrupted/stale data) must never
// silently reactivate a locale this build doesn't actually ship selectable
// right now; the caller falls back to device detection instead.
export async function getCachedLocale(): Promise<SupportedLocale | null> {
  const value = await AsyncStorage.getItem(LOCALE_CACHE_KEY);
  return isEnabledLocale(value) ? value : null;
}

export async function setCachedLocale(locale: SupportedLocale): Promise<void> {
  await AsyncStorage.setItem(LOCALE_CACHE_KEY, locale);
}

// Settings > Language > "Match device language" — clears the manual
// override so the device's own OS language takes over again.
export async function clearCachedLocale(): Promise<void> {
  await AsyncStorage.removeItem(LOCALE_CACHE_KEY);
}

// FIRST-RUN LANGUAGE SCREEN (owner decision, LANGUAGE PICKER — FIVE
// LANGUAGES AT LAUNCH) — a DEVICE-local, one-time flag distinct from the
// locale cache above: even when device auto-detect already lands on one of
// the 5 enabled languages, the language screen still must be shown once so
// the user explicitly confirms/changes it with one tap — reusing
// getCachedLocale() as an implicit "seen" signal would skip that tap
// whenever the device's own OS language already happens to match. Session-
// independent (unlike ToS/tutorial/onboarding, which are account-scoped
// profile columns) because it must work fully anonymously, before sign-in
// even exists — same "cache a flag locally" pattern as
// src/onboarding/introStorage.ts's INTRO_SEEN_KEY.
const LANGUAGE_SCREEN_SEEN_KEY = 'bozkurt-fleet-os-language-screen-seen';

export async function getLanguageScreenSeen(): Promise<boolean> {
  return (await AsyncStorage.getItem(LANGUAGE_SCREEN_SEEN_KEY)) === 'true';
}

export async function setLanguageScreenSeen(): Promise<void> {
  await AsyncStorage.setItem(LANGUAGE_SCREEN_SEEN_KEY, 'true');
}
