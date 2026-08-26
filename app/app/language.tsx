import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useLanguageGate } from '@/src/context/LanguageGateContext';
import { setAppLocale } from '@/src/i18n';
import { applyLocaleDirection } from '@/src/i18n/rtl';
import { supabase } from '@/src/lib/supabase';
import { ENABLED_LOCALES, LOCALE_LABELS, type SupportedLocale } from '@/src/i18n/config';
import { Screen, MutedText } from '@/src/components/ui';
import { BrandLogo } from '@/src/components/BrandLogo';
import { colors, radii, spacing, typography } from '@/src/theme';

// FIRST-RUN LANGUAGE SCREEN (owner decision, LANGUAGE PICKER — FIVE
// LANGUAGES AT LAUNCH) — shown before EVERYTHING else, including the intro
// slides and sign-in (src/navigation/rootRedirect.ts's own `languageScreenSeen`
// gate runs first among every gate). Each of the 5 launch-enabled languages
// is shown in its OWN script/name (LOCALE_LABELS — never translated, these
// are the languages' own names for themselves). The device-detected
// language is preselected (highlighted) when it's one of the 5, English
// otherwise — but per the product spec this is a genuine ONE-TAP flow:
// tapping ANY option (including the already-highlighted one) immediately
// confirms that choice and moves on, there is no separate "Continue"
// button to miss. Changeable any time afterward from Settings > Language.
//
// No navigation call happens here — setting languageScreenSeen (via
// LanguageGateContext, same pattern as IntroContext's markIntroSeen())
// flips the gate synchronously, and app/_layout.tsx's own redirect effect
// recomputes and navigates to whatever comes next (intro / sign-in /
// confirm-email / ToS / tutorial / onboarding / tabs) on its own — this
// screen never has to know or guess which of those is correct.
export default function LanguageScreen() {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const { markLanguageScreenSeen } = useLanguageGate();

  async function choose(locale: SupportedLocale) {
    await setAppLocale(locale);
    applyLocaleDirection(locale);
    // A signed-in user reaching this screen (e.g. a fresh device/build on
    // an existing account) should have their choice mirrored to
    // profiles.locale too, same cross-device-sync convention as Settings'
    // own pickLocale() — best-effort, never blocks the flow forward on a
    // network hiccup.
    if (session?.user.id) {
      try {
        await supabase.from('profiles').update({ locale }).eq('user_id', session.user.id);
      } catch (err) {
        console.error('[LanguageScreen] Failed to sync locale to profiles.locale (non-fatal).', err);
      }
    }
    markLanguageScreenSeen();
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
        <View style={{ alignItems: 'center', marginBottom: spacing.xl }}>
          <BrandLogo size={64} />
        </View>
        <Text
          style={{
            color: colors.text,
            fontSize: typography.size.xl,
            fontWeight: '800',
            textAlign: 'center',
            marginBottom: spacing.sm,
          }}
        >
          {t('languageScreen.title')}
        </Text>
        <MutedText style={{ textAlign: 'center', marginBottom: spacing.xl }}>{t('languageScreen.subtitle')}</MutedText>

        <View style={{ gap: spacing.sm }}>
          {ENABLED_LOCALES.map((locale) => {
            // i18n.language is already the resolved boot-time locale
            // (cached choice, or else the device-detected one when it's
            // among the 5 enabled languages, English otherwise —
            // src/i18n/index.ts's resolveInitialLocale()) — so this IS the
            // "device-detected preselected if among the five, English
            // otherwise" rule, with no separate lookup needed here.
            const selected = locale === (i18n.language as SupportedLocale);
            return (
              <Pressable
                key={locale}
                onPress={() => choose(locale)}
                style={{
                  paddingVertical: spacing.md,
                  paddingHorizontal: spacing.lg,
                  borderRadius: radii.md,
                  borderWidth: 1,
                  borderColor: selected ? colors.accent : colors.border,
                  backgroundColor: selected ? colors.accent : colors.card,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Text style={{ color: colors.text, fontSize: typography.size.lg, fontWeight: '700' }}>{LOCALE_LABELS[locale]}</Text>
                {selected && <Text style={{ color: colors.text, fontSize: typography.size.lg }}>✓</Text>}
              </Pressable>
            );
          })}
        </View>

        <MutedText style={{ textAlign: 'center', marginTop: spacing.xl }}>{t('languageScreen.changeLaterNote')}</MutedText>
      </ScrollView>
    </Screen>
  );
}
