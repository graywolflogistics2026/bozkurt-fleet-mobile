import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { supabase } from '@/src/lib/supabase';
import { Screen, ScreenTitle, Card, MutedText, SecondaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';
import { SUPPORTED_LOCALES, LOCALE_LABELS, type SupportedLocale } from '@/src/i18n/config';
import { setAppLocale, resetAppLocaleToDevice } from '@/src/i18n';
import { applyLocaleDirection } from '@/src/i18n/rtl';

function Pill({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: radii.sm,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
        backgroundColor: selected ? colors.accent : colors.card2,
        marginEnd: spacing.xs,
        marginBottom: spacing.xs,
      }}
    >
      <Text style={{ color: colors.text, fontSize: typography.size.sm, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export default function Settings() {
  const { t, i18n } = useTranslation();
  const { session, profile, signOut, refreshProfile } = useAuth();
  const router = useRouter();
  const userId = session?.user.id;
  const [savingLocale, setSavingLocale] = useState(false);
  const currentLocale = i18n.language as SupportedLocale;
  const hasManualLocale = !!profile?.locale;

  async function pickLocale(locale: SupportedLocale) {
    if (!userId || savingLocale) return;
    setSavingLocale(true);
    try {
      await setAppLocale(locale);
      const { error } = await supabase.from('profiles').update({ locale }).eq('user_id', userId);
      if (error) throw error;
      await refreshProfile();
      const { restartRequired } = applyLocaleDirection(locale);
      if (restartRequired) Alert.alert(t('settings.restartRequiredTitle'), t('settings.restartRequiredBody'));
    } catch (err) {
      Alert.alert(t('settings.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setSavingLocale(false);
    }
  }

  async function pickAutoLocale() {
    if (!userId || savingLocale) return;
    setSavingLocale(true);
    try {
      const detected = await resetAppLocaleToDevice();
      const { error } = await supabase.from('profiles').update({ locale: null }).eq('user_id', userId);
      if (error) throw error;
      await refreshProfile();
      const { restartRequired } = applyLocaleDirection(detected);
      if (restartRequired) Alert.alert(t('settings.restartRequiredTitle'), t('settings.restartRequiredBody'));
    } catch (err) {
      Alert.alert(t('settings.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setSavingLocale(false);
    }
  }

  return (
    <Screen>
      <ScreenTitle>{t('settings.title')}</ScreenTitle>
      <Card>
        <Text style={{ color: colors.text, fontSize: typography.size.md }}>{session?.user.email}</Text>
        <MutedText>
          {t('settings.tosAccepted', {
            date: profile?.tos_accepted_at ? new Date(profile.tos_accepted_at).toLocaleDateString() : '—',
            version: profile?.tos_version ?? '—',
          })}
        </MutedText>
      </Card>
      <Card>
        <Text style={{ color: colors.text, fontSize: typography.size.md, fontWeight: '600', marginBottom: spacing.xs }}>
          {t('settings.languageTitle')}
        </Text>
        <MutedText>{t('settings.languageNote')}</MutedText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm }}>
          <Pill label={t('settings.languageAutoLabel')} selected={!hasManualLocale} onPress={pickAutoLocale} />
          {SUPPORTED_LOCALES.map((locale) => (
            <Pill
              key={locale}
              label={LOCALE_LABELS[locale]}
              selected={hasManualLocale && currentLocale === locale}
              onPress={() => pickLocale(locale)}
            />
          ))}
        </View>
      </Card>
      <Card>
        <Text style={{ color: colors.text, fontSize: typography.size.md, fontWeight: '600' }}>{t('settings.dataTitle')}</Text>
        <MutedText>{t('settings.dataNote')}</MutedText>
        <SecondaryButton title={t('settings.importLegacyButton')} onPress={() => router.push('/(tabs)/more/import-legacy')} />
      </Card>
      <MutedText>{t('settings.comingSoonNote')}</MutedText>
      <SecondaryButton title={t('common.signOut')} onPress={signOut} />
    </Screen>
  );
}
