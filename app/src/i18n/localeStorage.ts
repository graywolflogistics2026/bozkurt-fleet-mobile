import AsyncStorage from '@react-native-async-storage/async-storage';
import { isSupportedLocale, type SupportedLocale } from '@/src/i18n/config';

// Local cache of the user's chosen language, read synchronously-ish at boot
// (before profiles.locale can be fetched over the network) and kept in sync
// whenever the user changes it in Settings or signs into a device where
// profiles.locale differs from this device's cache.
const LOCALE_CACHE_KEY = 'bozkurt-fleet-os-locale';

export async function getCachedLocale(): Promise<SupportedLocale | null> {
  const value = await AsyncStorage.getItem(LOCALE_CACHE_KEY);
  return isSupportedLocale(value) ? value : null;
}

export async function setCachedLocale(locale: SupportedLocale): Promise<void> {
  await AsyncStorage.setItem(LOCALE_CACHE_KEY, locale);
}

// Settings > Language > "Match device language" — clears the manual
// override so the device's own OS language takes over again.
export async function clearCachedLocale(): Promise<void> {
  await AsyncStorage.removeItem(LOCALE_CACHE_KEY);
}
