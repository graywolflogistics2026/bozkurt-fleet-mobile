import { I18nManager } from 'react-native';
import { isRTLLocale, type SupportedLocale } from '@/src/i18n/config';

// React Native only picks up I18nManager.forceRTL/allowRTL on the NEXT
// native reload — there is no way to flip live layout direction from JS.
// Native itself already defaults isRTL to the device OS's own language on
// first-ever launch (nothing to do there); we only need to call this when
// the user manually overrides to/from Arabic in Settings, and tell them a
// restart is needed for the layout direction (not the text) to catch up.
export function applyLocaleDirection(locale: SupportedLocale): { restartRequired: boolean } {
  const needsRTL = isRTLLocale(locale);
  if (needsRTL === I18nManager.isRTL) return { restartRequired: false };
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(needsRTL);
  return { restartRequired: true };
}
