import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { useAuth } from '@/src/context/AuthContext';
import { supabase } from '@/src/lib/supabase';
import { useProfile, useUpdateProfile } from '@/src/data/profile';
import { useTaxConfig, useUpdateTaxConfig } from '@/src/data/taxConfig';
import { callDeleteAccount } from '@/src/data/deleteAccountCall';
import { callResetData } from '@/src/data/resetDataCall';
import { fetchAllUserData } from '@/src/data/exportAllData';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import type { EntityType } from '@/src/tax/types';
import { Screen, ScreenTitle, Card, MutedText, Field, PrimaryButton, SecondaryButton, ModalSheet, SheetTitle } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';
import { SUPPORTED_LOCALES, LOCALE_LABELS, type SupportedLocale } from '@/src/i18n/config';
import { setAppLocale, resetAppLocaleToDevice } from '@/src/i18n';
import { applyLocaleDirection } from '@/src/i18n/rtl';
import { formatDate } from '@/src/i18n/format';

const ENTITY_TYPES: EntityType[] = ['sole_prop', 'smllc', 'multi_member_llc', 'scorp'];
const DELETE_CONFIRM_WORD = 'DELETE';
const RESET_CONFIRM_WORD = 'RESET';

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
  const queryClient = useQueryClient();
  const userId = session?.user.id;
  const [savingLocale, setSavingLocale] = useState(false);
  const currentLocale = i18n.language as SupportedLocale;
  const hasManualLocale = !!profile?.locale;

  const profileQuery = useProfile();
  const updateProfile = useUpdateProfile();
  const taxConfigQuery = useTaxConfig();
  const updateTaxConfig = useUpdateTaxConfig();

  const [companyName, setCompanyName] = useState('');
  const [dotNumber, setDotNumber] = useState('');
  const [mcNumber, setMcNumber] = useState('');
  const [homeState, setHomeState] = useState('');
  const [entityType, setEntityType] = useState<EntityType>('sole_prop');
  const [businessHydrated, setBusinessHydrated] = useState(false);
  const [savingBusiness, setSavingBusiness] = useState(false);

  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [exportingData, setExportingData] = useState(false);
  const [resetConfirming, setResetConfirming] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resetting, setResetting] = useState(false);

  // One-time hydration once both queries resolve (same pattern as
  // dashboard-customize.tsx/tax-estimator.tsx) — never re-hydrates over a
  // user's in-progress edits on subsequent refetches.
  useEffect(() => {
    if (businessHydrated || !profileQuery.data || !taxConfigQuery.data) return;
    setCompanyName(profileQuery.data.company_name ?? '');
    setDotNumber(profileQuery.data.dot_number ?? '');
    setMcNumber(profileQuery.data.mc_number ?? '');
    setHomeState(profileQuery.data.home_state ?? taxConfigQuery.data.state ?? 'TX');
    setEntityType(taxConfigQuery.data.entity_type);
    setBusinessHydrated(true);
  }, [businessHydrated, profileQuery.data, taxConfigQuery.data]);

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

  async function handleSaveBusinessProfile() {
    setSavingBusiness(true);
    try {
      const state = homeState.trim().toUpperCase() || 'TX';
      await Promise.all([
        updateProfile.mutateAsync({
          company_name: companyName.trim() || null,
          dot_number: dotNumber.trim() || null,
          mc_number: mcNumber.trim() || null,
          home_state: state,
        }),
        updateTaxConfig.mutateAsync({ state, entity_type: entityType }),
      ]);
      Alert.alert(t('settings.businessProfileSavedTitle'));
    } catch (err) {
      Alert.alert(t('settings.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setSavingBusiness(false);
    }
  }

  // Full-account JSON export (Session 9b parity-gap decision #1) —
  // mirrors legacy exportData(), one row per user-owned table, excludes
  // nothing. Same File/Paths/Sharing pattern as the Accountant Package's
  // JSON export, just a full raw dump instead of a curated Schedule C
  // rollup.
  async function handleExportAllData() {
    if (!userId) return;
    setExportingData(true);
    try {
      const data = await fetchAllUserData(userId);
      const payload = { exportedAt: new Date().toISOString(), data };
      const file = new File(Paths.cache, 'bozkurt-fleet-os-export.json');
      if (file.exists) file.delete();
      file.create();
      file.write(JSON.stringify(payload, null, 2));

      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert(t('settings.shareNotAvailable'));
        return;
      }
      await Sharing.shareAsync(file.uri);
    } catch (err) {
      Alert.alert(t('settings.exportFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setExportingData(false);
    }
  }

  function handleDeletePress() {
    Alert.alert(t('settings.deleteConfirm1Title'), t('settings.deleteConfirm1Body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.deleteContinue'),
        style: 'destructive',
        onPress: () => {
          setDeleteConfirmText('');
          setDeleteConfirming(true);
        },
      },
    ]);
  }

  async function handleConfirmDelete() {
    if (deleteConfirmText.trim().toUpperCase() !== DELETE_CONFIRM_WORD) return;
    setDeleting(true);
    try {
      const result = await callDeleteAccount();
      if (!result.success) {
        Alert.alert(t('settings.deleteFailedTitle'), result.error || t('deductions.genericRetry'));
        return;
      }
      setDeleteConfirming(false);
      await signOut();
    } catch (err) {
      Alert.alert(t('settings.deleteFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setDeleting(false);
    }
  }

  // Reset All Data (device feedback round 2, owner decision 2026-07-13) —
  // distinct from Delete Account: wipes every business row + Storage file
  // but KEEPS the account/profile, so the user stays signed in to a
  // zeroed account afterward (no signOut() call, unlike delete).
  function handleResetPress() {
    Alert.alert(t('settings.resetConfirm1Title'), t('settings.resetConfirm1Body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.resetContinue'),
        style: 'destructive',
        onPress: () => {
          setResetConfirmText('');
          setResetConfirming(true);
        },
      },
    ]);
  }

  async function handleConfirmReset() {
    if (resetConfirmText.trim().toUpperCase() !== RESET_CONFIRM_WORD) return;
    setResetting(true);
    try {
      const result = await callResetData();
      if (!result.success) {
        Alert.alert(t('settings.resetFailedTitle'), result.error || t('deductions.genericRetry'));
        return;
      }
      setResetConfirming(false);
      await refreshProfile();
      await invalidateFinancialData(queryClient);
      Alert.alert(t('settings.resetSuccessTitle'));
    } catch (err) {
      Alert.alert(t('settings.resetFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setResetting(false);
    }
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xl }}>
        <ScreenTitle>{t('settings.title')}</ScreenTitle>
        <Card>
          <Text style={{ color: colors.text, fontSize: typography.size.md }}>{session?.user.email}</Text>
        </Card>

        <Text style={styles.sectionTitle}>{t('settings.businessProfileTitle')}</Text>
        <MutedText>{t('settings.businessProfileSubtitle')}</MutedText>
        <Card>
          <MutedText>{t('settings.companyNameLabel')}</MutedText>
          <Field value={companyName} onChangeText={setCompanyName} placeholder={t('settings.companyNamePlaceholder')} />

          <MutedText>{t('settings.homeStateLabel')}</MutedText>
          <Field value={homeState} onChangeText={(v) => setHomeState(v.toUpperCase().slice(0, 2))} placeholder="TX" autoCapitalize="characters" maxLength={2} />

          <MutedText>{t('settings.dotNumberLabel')}</MutedText>
          <Field value={dotNumber} onChangeText={setDotNumber} keyboardType="numeric" />

          <MutedText>{t('settings.mcNumberLabel')}</MutedText>
          <Field value={mcNumber} onChangeText={setMcNumber} keyboardType="numeric" />

          <MutedText>{t('settings.entityTypeLabel')}</MutedText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {ENTITY_TYPES.map((et) => (
              <Pill key={et} label={t(`taxEstimator.entityType.${et}`)} selected={entityType === et} onPress={() => setEntityType(et)} />
            ))}
          </View>
          {(entityType === 'multi_member_llc' || entityType === 'scorp') && (
            <MutedText style={{ marginTop: spacing.xs }}>{t('settings.entityTypeMoreFieldsNote')}</MutedText>
          )}

          <PrimaryButton title={t('common.save')} onPress={handleSaveBusinessProfile} loading={savingBusiness} />
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
          <PrimaryButton title={`⬇️ ${t('settings.exportAllDataButton')}`} onPress={handleExportAllData} loading={exportingData} />
          <SecondaryButton title={t('settings.importLegacyButton')} onPress={() => router.push('/(tabs)/more/import-legacy')} />
        </Card>

        <Text style={styles.sectionTitle}>{t('settings.legalTitle')}</Text>
        <Card>
          <MutedText>
            {t('settings.tosAccepted', {
              date: profile?.tos_accepted_at ? formatDate(profile.tos_accepted_at, i18n.language) : '—',
              version: profile?.tos_version ?? '—',
            })}
          </MutedText>
          <SecondaryButton title={t('settings.viewTerms')} onPress={() => router.push('/(tabs)/more/terms-of-use')} />
          <SecondaryButton title={t('settings.viewPrivacy')} onPress={() => router.push('/(tabs)/more/privacy-policy')} />
        </Card>

        <Text style={[styles.sectionTitle, { color: colors.red }]}>{t('settings.dangerZoneTitle')}</Text>
        <Card>
          <MutedText>{t('settings.resetAllDataNote')}</MutedText>
          <Pressable onPress={handleResetPress} style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}>
            <Text style={{ color: colors.orange, fontWeight: '700', fontSize: typography.size.sm }}>{t('settings.resetAllDataButton')}</Text>
          </Pressable>
        </Card>
        <Card>
          <MutedText>{t('settings.deleteAccountNote')}</MutedText>
          <Pressable onPress={handleDeletePress} style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}>
            <Text style={{ color: colors.red, fontWeight: '700', fontSize: typography.size.sm }}>{t('settings.deleteAccountButton')}</Text>
          </Pressable>
        </Card>

        <SecondaryButton title={t('common.signOut')} onPress={signOut} />
      </ScrollView>

      <ModalSheet visible={deleteConfirming} onClose={() => setDeleteConfirming(false)}>
        <SheetTitle>{t('settings.deleteConfirm2Title')}</SheetTitle>
        <MutedText>{t('settings.deleteConfirm2Body')}</MutedText>
        <MutedText style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
          {t('settings.deleteTypeToConfirm', { word: DELETE_CONFIRM_WORD })}
        </MutedText>
        <Field
          value={deleteConfirmText}
          onChangeText={setDeleteConfirmText}
          placeholder={DELETE_CONFIRM_WORD}
          autoCapitalize="characters"
        />
        <PrimaryButton
          title={t('settings.deletePermanently')}
          onPress={handleConfirmDelete}
          loading={deleting}
          disabled={deleteConfirmText.trim().toUpperCase() !== DELETE_CONFIRM_WORD}
        />
        <SecondaryButton title={t('common.cancel')} onPress={() => setDeleteConfirming(false)} />
      </ModalSheet>

      <ModalSheet visible={resetConfirming} onClose={() => setResetConfirming(false)}>
        <SheetTitle>{t('settings.resetConfirm2Title')}</SheetTitle>
        <MutedText>{t('settings.resetConfirm2Body')}</MutedText>
        <MutedText style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
          {t('settings.resetTypeToConfirm', { word: RESET_CONFIRM_WORD })}
        </MutedText>
        <Field
          value={resetConfirmText}
          onChangeText={setResetConfirmText}
          placeholder={RESET_CONFIRM_WORD}
          autoCapitalize="characters"
        />
        <PrimaryButton
          title={t('settings.resetPermanently')}
          onPress={handleConfirmReset}
          loading={resetting}
          disabled={resetConfirmText.trim().toUpperCase() !== RESET_CONFIRM_WORD}
        />
        <SecondaryButton title={t('common.cancel')} onPress={() => setResetConfirming(false)} />
      </ModalSheet>
    </Screen>
  );
}

const styles = {
  sectionTitle: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
};
