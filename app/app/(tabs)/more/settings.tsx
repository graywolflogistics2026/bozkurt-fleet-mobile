import { useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { useAuth } from '@/src/context/AuthContext';
import { supabase } from '@/src/lib/supabase';
import { useProfile, useUpdateProfile } from '@/src/data/profile';
import { useAiCoachSummary } from '@/src/data/aiCoachSummary';
import { trailingAverageNet } from '@/src/stats/goalProgress';
import { useAiUsageDisplay } from '@/src/data/aiUsageDisplay';
import { CREDIT_PACK_OFFERS } from '@/src/usage/aiUsage';
import { useFormatters } from '@/src/i18n/format';
import { useTaxConfig, useUpdateTaxConfig } from '@/src/data/taxConfig';
import { callDeleteAccount } from '@/src/data/deleteAccountCall';
import { callResetData } from '@/src/data/resetDataCall';
import { fetchAllUserData } from '@/src/data/exportAllData';
import { invalidateFinancialData, removeFinancialDataFromCache } from '@/src/data/queryInvalidation';
import type { EntityType } from '@/src/tax/types';
import { Screen, ScreenTitle, Card, MutedText, Field, PrimaryButton, SecondaryButton, ModalSheet, SheetTitle } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';
import { SUPPORTED_LOCALES, LOCALE_LABELS, LANGUAGE_PICKER_ENABLED, type SupportedLocale } from '@/src/i18n/config';
import { setAppLocale, resetAppLocaleToDevice } from '@/src/i18n';
import { getBuildInfo, formatBuildInfoLine } from '@/src/lib/buildInfo';
import { isOwnerGrantedPlan } from '@/src/entitlement/hasFullAccess';
import { buildSupportMailtoUrl } from '@/src/lib/supportEmail';
import { SUPPORT_EMAIL } from '@/src/brand';
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
  const { money } = useFormatters();
  const moneyRounded = (n: number) => money(n, { maximumFractionDigits: 0 });
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
  const [weeklyGoalInput, setWeeklyGoalInput] = useState('');
  const [businessHydrated, setBusinessHydrated] = useState(false);
  const [savingBusiness, setSavingBusiness] = useState(false);

  // WEEKLY GOAL DRIVES THE COACH (owner decision 2026-08-24, FIVE ADDITIONS
  // pass, PART 3 item 4) — "Editable from the AI Coach block AND Settings"
  // — same field (profiles.weekly_goal), same trailing-4-week-average
  // prefill as ceo-mode.tsx, so the two screens can never suggest a
  // different starting number.
  const coach = useAiCoachSummary();
  const suggestedWeeklyGoal = useMemo(() => trailingAverageNet(coach.weeklyTrend), [coach.weeklyTrend]);
  const aiUsage = useAiUsageDisplay();

  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [exportingData, setExportingData] = useState(false);
  const [resetConfirming, setResetConfirming] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resetting, setResetting] = useState(false);

  // One-time hydration once both queries resolve (same pattern as
  // tax-estimator.tsx) — never re-hydrates over a user's in-progress
  // edits on subsequent refetches.
  useEffect(() => {
    if (businessHydrated || !profileQuery.data || !taxConfigQuery.data) return;
    setCompanyName(profileQuery.data.company_name ?? '');
    setDotNumber(profileQuery.data.dot_number ?? '');
    setMcNumber(profileQuery.data.mc_number ?? '');
    setHomeState(profileQuery.data.home_state ?? taxConfigQuery.data.state ?? 'TX');
    setEntityType(taxConfigQuery.data.entity_type);
    setWeeklyGoalInput(profileQuery.data.weekly_goal != null ? String(profileQuery.data.weekly_goal) : '');
    setBusinessHydrated(true);
  }, [businessHydrated, profileQuery.data, taxConfigQuery.data]);

  // Prefill (never overwrite an in-progress edit or an already-saved goal)
  // once the trailing average is available — same guarded pattern as
  // ceo-mode.tsx's own prefill effect.
  useEffect(() => {
    if (businessHydrated && profileQuery.data?.weekly_goal == null && weeklyGoalInput === '' && suggestedWeeklyGoal != null && suggestedWeeklyGoal > 0) {
      setWeeklyGoalInput(String(Math.round(suggestedWeeklyGoal)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessHydrated, suggestedWeeklyGoal]);

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
      const weeklyGoalValue = Number(weeklyGoalInput);
      await Promise.all([
        updateProfile.mutateAsync({
          company_name: companyName.trim() || null,
          dot_number: dotNumber.trim() || null,
          mc_number: mcNumber.trim() || null,
          home_state: state,
          weekly_goal: weeklyGoalInput.trim() && weeklyGoalValue > 0 ? weeklyGoalValue : null,
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

  // SUPPORT EMAIL (owner decision 2026-08-05, FULL PARITY follow-up item
  // J) — a plain mailto: URL (Linking.openURL, no new native dependency)
  // prefilled with build/platform/user-id context, never financial data.
  async function openSupportEmail(subject: string) {
    const url = buildSupportMailtoUrl({
      subject,
      buildInfo: getBuildInfo(),
      platform: Platform.OS,
      userId,
    });
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(t('settings.noMailAppTitle'), t('settings.noMailAppBody', { email: SUPPORT_EMAIL }));
    }
  }
  function handleContactSupport() {
    openSupportEmail(t('settings.contactSupportSubject'));
  }
  function handleReportProblem() {
    openSupportEmail(t('settings.reportProblemSubject'));
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
      // removeFinancialDataFromCache() first (owner decision 2026-08-02):
      // deletes these queries from the persisted AsyncStorage cache
      // immediately, not just marks them stale — see its own comment.
      removeFinancialDataFromCache(queryClient);
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

        {/* LIFETIME / COMPLIMENTARY ACCOUNTS (owner decision 2026-08-24,
            PART 2, item L2) — reads the FULL profiles row (useProfile(),
            not AuthContext's own narrower Profile type, which doesn't
            select `plan`). isOwnerGrantedPlan() — not hasFullAccess() —
            is deliberately used here: a future real 'paid' subscriber
            should see normal billing/renewal UI once that exists, never
            this "granted for free" badge. */}
        {isOwnerGrantedPlan(profileQuery.data) && (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Text style={{ fontSize: 18 }}>✨</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>
                  {profileQuery.data?.plan === 'lifetime' ? t('settings.lifetimeAccessBadge') : t('settings.complimentaryAccessBadge')}
                </Text>
                {!!profileQuery.data?.plan_note && <MutedText style={{ marginTop: 2 }}>{profileQuery.data.plan_note}</MutedText>}
              </View>
            </View>
          </Card>
        )}

        {/* USAGE LIMITS BY FLEET SIZE + CREDIT PACKS (owner decision
            2026-08-24, FIVE ADDITIONS pass, PART 5 items 4-5) — "Show both
            plainly in Settings: AI imports this month: 34 of 180 (3
            trucks) · Extra credits: 275, with the reset date." Display
            only — the server (ai-import/index.ts) is the sole enforcement
            point. */}
        <Text style={styles.sectionTitle}>{t('settings.aiUsageTitle')}</Text>
        <Card>
          {aiUsage.isLoading ? (
            <MutedText>{t('common.loading')}</MutedText>
          ) : (
            <>
              <Text style={{ color: colors.text, fontWeight: '600' }}>
                {t('settings.aiUsageSummary', {
                  used: aiUsage.usageStatus.used,
                  allowance: aiUsage.usageStatus.allowance,
                  trucks: aiUsage.activeTruckCount,
                })}
              </Text>
              {aiUsage.availableCredits > 0 && (
                <MutedText style={{ marginTop: 2 }}>
                  {t('settings.aiUsageExtraCredits', { credits: aiUsage.availableCredits })}
                </MutedText>
              )}
              <MutedText style={{ marginTop: 2 }}>
                {t('settings.aiUsageResetsOn', { date: aiUsage.resetDate.toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' }) })}
              </MutedText>
              {aiUsage.usageStatus.softLimitReached && !aiUsage.usageStatus.hardLimitReached && (
                <MutedText style={{ color: colors.orange, marginTop: spacing.xs }}>{t('settings.aiUsageSoftLimitNotice')}</MutedText>
              )}
              {aiUsage.usageStatus.hardLimitReached && aiUsage.availableCredits <= 0 && (
                <MutedText style={{ color: colors.red, marginTop: spacing.xs }}>{t('settings.aiUsageHardLimitNotice')}</MutedText>
              )}
              {(aiUsage.usageStatus.softLimitReached || aiUsage.usageStatus.hardLimitReached) && (
                <View style={{ marginTop: spacing.sm }}>
                  <MutedText>{t('settings.aiUsageCreditPacksIntro')}</MutedText>
                  {CREDIT_PACK_OFFERS.map((pack) => (
                    <Text key={pack.id} style={{ color: colors.text, marginTop: spacing.xs }}>
                      • {t(`settings.creditPack.${pack.id}`, { credits: pack.credits, price: pack.priceUsd })}
                    </Text>
                  ))}
                  <MutedText style={{ marginTop: spacing.xs }}>{t('settings.aiUsageCreditPacksContact')}</MutedText>
                </View>
              )}
            </>
          )}
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

          <MutedText>{t('settings.weeklyGoalLabel')}</MutedText>
          <Field value={weeklyGoalInput} onChangeText={setWeeklyGoalInput} keyboardType="numeric" placeholder="0.00" />
          {profileQuery.data?.weekly_goal == null && suggestedWeeklyGoal != null && suggestedWeeklyGoal > 0 && (
            <MutedText style={{ marginTop: 2 }}>
              {t('settings.weeklyGoalSuggestedNote', { amount: moneyRounded(suggestedWeeklyGoal) })}
            </MutedText>
          )}

          <PrimaryButton title={t('common.save')} onPress={handleSaveBusinessProfile} loading={savingBusiness} />
        </Card>

        {LANGUAGE_PICKER_ENABLED && (
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
        )}

        <Card>
          <Text style={{ color: colors.text, fontSize: typography.size.md, fontWeight: '600' }}>{t('settings.dataTitle')}</Text>
          {/* exportAllDataNote (pre-launch hardening, owner decision
              2026-08-02): accurate scope text for the export itself —
              dataNote below describes the legacy-import button, not this
              one, and neither used to say the original uploaded photos/
              PDFs aren't bundled into the export. */}
          <MutedText>{t('settings.exportAllDataNote')}</MutedText>
          <PrimaryButton title={`⬇️ ${t('settings.exportAllDataButton')}`} onPress={handleExportAllData} loading={exportingData} />
          <MutedText style={{ marginTop: spacing.sm }}>{t('settings.dataNote')}</MutedText>
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

        {/* SUPPORT EMAIL (owner decision 2026-08-05, FULL PARITY follow-up
            item J) — prefilled with app version/EAS update id/commit
            hash/platform/user id, NEVER financial data. */}
        <Text style={styles.sectionTitle}>{t('settings.supportTitle')}</Text>
        <Card>
          {/* FIRST-RUN TUTORIAL (owner decision 2026-08-05, FULL PARITY
              follow-up item I) — replayable any time, ?replay=true so
              tutorial.tsx never re-touches tutorial_seen_at again. */}
          <SecondaryButton title={t('tutorial.howItWorksButton')} onPress={() => router.push('/tutorial?replay=true' as Href)} />
          <MutedText>{t('settings.supportNote')}</MutedText>
          <SecondaryButton title={t('settings.contactSupportButton')} onPress={handleContactSupport} />
          <SecondaryButton title={t('settings.reportProblemButton')} onPress={handleReportProblem} />
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

        {/* RUNTIME VISIBILITY (owner decision 2026-07-30): "which JS is
            on this device" should never be a guess — same buildInfo.ts
            module ScreenErrorBoundary reads from, so the two can never
            disagree about the format. */}
        <Text style={{ color: colors.muted, fontSize: typography.size.xs, textAlign: 'center', marginTop: spacing.lg }}>
          {formatBuildInfoLine(getBuildInfo())}
        </Text>
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
