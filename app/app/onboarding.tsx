import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useUpdateProfile } from '@/src/data/profile';
import { useUpdateTaxConfig } from '@/src/data/taxConfig';
import { useInsertTruck, useUpdateTruck } from '@/src/data/trucks';
import { useMaintenanceIntervals, useUpdateMaintenanceInterval } from '@/src/data/maintenanceIntervals';
import { HEALTH_CATEGORIES, HEALTH_CATEGORY_ICON, type HealthCategory } from '@/src/truck/categories';
import { Screen, ScreenTitle, Card, MutedText, LegalFootnote, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';
import type { Profile } from '@/src/types/db';

// lease_operator (owner decision 2026-07-13, device feedback round 2):
// leases a truck from another operator/carrier rather than owning it —
// treated identically to owner_operator for every module/tax code path
// today (CLAUDE.md invariant #18: only company_driver_w2 branches
// rendering). Kept as its own distinct value, not folded into
// owner_operator, so a future carrier-lease-specific feature has
// something to key off without a migration.
const ROLES: NonNullable<Profile['role']>[] = ['owner_operator', 'lease_operator', 'company_driver_w2', 'contractor_1099', 'trainee'];
const STEP_COUNT = 9;

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

// Expanded first-launch onboarding wizard (PROMPTS.md Session 9b item 7,
// CLAUDE.md invariant #18, owner decision 2026-07-10 — PRODUCT DECISION,
// supersedes the shorter 2026-07-09 spec). Runs once, after sign-up + ToS
// acceptance (app/_layout.tsx's RootLayoutNav redirects here whenever
// AuthContext's needsOnboarding is true), gated by
// profiles.onboarding_completed_at (null = show it). New users still start
// with ZERO data and no owner-specific defaults anywhere — every field
// here defaults blank/0, never a placeholder company/truck.
//
// Steps 5 ("Truck info") and 7 ("Current odometer") from the original
// PROMPTS.md numbered list are merged into one "Truck Info" step here
// (odometer collected alongside unit/year/make/model) per that spec's own
// "reconcile rather than asking twice" instruction — the other 8 items
// map 1:1 to the steps below.
//
// Each step saves progressively (not one giant save at the end) so a user
// who backs out mid-wizard doesn't lose earlier answers — every field is
// also editable later in Settings/Trucks/Truck Health.
export default function Onboarding() {
  const { t } = useTranslation();
  const router = useRouter();
  const { profile } = useAuth();
  const { refreshTrucks } = useActiveTruck();
  const updateProfile = useUpdateProfile();
  const updateTaxConfig = useUpdateTaxConfig();
  const insertTruck = useInsertTruck();
  const updateTruck = useUpdateTruck();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [truckId, setTruckId] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState('');
  const [homeState, setHomeState] = useState('TX');
  const [dotNumber, setDotNumber] = useState('');
  const [mcNumber, setMcNumber] = useState('');
  const [role, setRole] = useState<NonNullable<Profile['role']>>('owner_operator');
  const [unitNumber, setUnitNumber] = useState('');
  const [truckYear, setTruckYear] = useState('');
  const [truckMake, setTruckMake] = useState('');
  const [truckModel, setTruckModel] = useState('');
  const [odometer, setOdometer] = useState('');
  const [trailerUnit, setTrailerUnit] = useState('');
  const [trailerVin, setTrailerVin] = useState('');
  const [trailerYear, setTrailerYear] = useState('');
  const [trailerMake, setTrailerMake] = useState('');
  const [trailerModel, setTrailerModel] = useState('');
  const [openingBalance, setOpeningBalance] = useState('0');
  const [taxYear, setTaxYear] = useState(String(new Date().getFullYear()));

  const [intervalDrafts, setIntervalDrafts] = useState<Record<string, { value: string; enabled: boolean }>>({});
  const intervalsQuery = useMaintenanceIntervals(truckId);
  const updateInterval = useUpdateMaintenanceInterval();

  const intervals = useMemo(
    () =>
      [...(intervalsQuery.data ?? [])].sort(
        (a, b) => HEALTH_CATEGORIES.indexOf(a.category as HealthCategory) - HEALTH_CATEGORIES.indexOf(b.category as HealthCategory)
      ),
    [intervalsQuery.data]
  );

  // Hydrates once the seed_maintenance_intervals-created rows actually
  // arrive (react-query fetch is async, and the query only enables once
  // truckId is set) — not fired imperatively on step transition, which
  // could run before the fetch resolves and leave drafts empty forever.
  useEffect(() => {
    if (!intervalsQuery.data || Object.keys(intervalDrafts).length > 0) return;
    const drafts: Record<string, { value: string; enabled: boolean }> = {};
    for (const iv of intervalsQuery.data) {
      drafts[iv.id] = {
        value: String(iv.tracking_mode === 'hours' ? (iv.interval_hours ?? '') : (iv.interval_miles ?? '')),
        enabled: iv.enabled,
      };
    }
    setIntervalDrafts(drafts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalsQuery.data]);

  async function finishOnboarding() {
    await updateProfile.mutateAsync({ onboarding_completed_at: new Date().toISOString() });
    router.replace('/(tabs)');
  }

  async function handleSkipAll() {
    setSaving(true);
    try {
      await finishOnboarding();
    } catch (err) {
      Alert.alert(t('onboarding.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSaving(false);
    }
  }

  async function goNext(action?: () => Promise<void>) {
    setSaving(true);
    try {
      if (action) await action();
      if (step === STEP_COUNT - 1) {
        await finishOnboarding();
        return;
      }
      setStep(step + 1);
    } catch (err) {
      Alert.alert(t('onboarding.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSaving(false);
    }
  }

  function goBack() {
    if (step > 0) setStep(step - 1);
  }

  async function saveCompanyName() {
    await updateProfile.mutateAsync({ company_name: companyName.trim() || null });
  }

  async function saveHomeState() {
    const state = homeState.trim().toUpperCase() || 'TX';
    await updateProfile.mutateAsync({ home_state: state });
    await updateTaxConfig.mutateAsync({ state });
  }

  async function saveDotMc() {
    await updateProfile.mutateAsync({ dot_number: dotNumber.trim() || null, mc_number: mcNumber.trim() || null });
  }

  async function saveRole() {
    await updateProfile.mutateAsync({ role });
  }

  async function saveTruckInfo() {
    const userId = profile?.user_id;
    if (!userId) return;
    const values = {
      unit_number: unitNumber.trim() || null,
      year: truckYear.trim() ? Number(truckYear) || null : null,
      make: truckMake.trim() || null,
      model: truckModel.trim() || null,
      current_odometer: odometer.trim() ? Number(odometer) || null : null,
    };
    // No truck info entered at all and none created yet — nothing to save,
    // subsequent steps just show their own "no truck yet" empty state.
    const hasAnyValue = Object.values(values).some((v) => v != null);
    if (!hasAnyValue && !truckId) return;

    if (truckId) {
      await updateTruck.mutateAsync({ id: truckId, values });
    } else if (hasAnyValue) {
      // Fires trg_seed_maintenance_intervals (CLAUDE.md invariant #4) —
      // this truck's maintenance_intervals rows exist by the time the
      // Maintenance Schedule step reads them below.
      const created = await insertTruck.mutateAsync({ user_id: userId, ...values });
      setTruckId(created.id);
    }
    await refreshTrucks();
  }

  async function saveTrailerInfo() {
    if (!truckId) return;
    const values = {
      trailer_unit_number: trailerUnit.trim() || null,
      trailer_vin: trailerVin.trim() || null,
      trailer_year: trailerYear.trim() ? Number(trailerYear) || null : null,
      trailer_make: trailerMake.trim() || null,
      trailer_model: trailerModel.trim() || null,
    };
    const hasAnyValue = Object.values(values).some((v) => v != null);
    if (!hasAnyValue) return;
    await updateTruck.mutateAsync({ id: truckId, values });
  }

  async function saveMaintenanceSchedule() {
    if (!truckId) return;
    const changed = intervals.filter((iv) => {
      const draft = intervalDrafts[iv.id];
      if (!draft) return false;
      const numericValue = Number(draft.value) || 0;
      const valueChanged = iv.tracking_mode === 'hours' ? numericValue !== iv.interval_hours : numericValue !== iv.interval_miles;
      return valueChanged || draft.enabled !== iv.enabled;
    });
    await Promise.all(
      changed.map((iv) => {
        const draft = intervalDrafts[iv.id];
        const numericValue = Number(draft.value) || 0;
        return updateInterval.mutateAsync({
          id: iv.id,
          values: iv.tracking_mode === 'hours' ? { interval_hours: numericValue, enabled: draft.enabled } : { interval_miles: numericValue, enabled: draft.enabled },
        });
      })
    );
  }

  async function saveOpeningBalance() {
    await updateProfile.mutateAsync({ business_balance: Number(openingBalance) || 0 });
  }

  async function saveTaxYear() {
    await updateTaxConfig.mutateAsync({ tax_year: Number(taxYear) || new Date().getFullYear() });
  }

  const STEP_ACTIONS = [saveCompanyName, saveHomeState, saveDotMc, saveRole, saveTruckInfo, saveTrailerInfo, saveMaintenanceSchedule, saveOpeningBalance, saveTaxYear];

  function renderStep() {
    switch (step) {
      case 0:
        return (
          <>
            <Text style={styles.stepTitle}>{t('onboarding.steps.companyName.title')}</Text>
            <MutedText>{t('onboarding.steps.companyName.subtitle')}</MutedText>
            <Field value={companyName} onChangeText={setCompanyName} placeholder={t('onboarding.steps.companyName.placeholder')} />
          </>
        );
      case 1:
        return (
          <>
            <Text style={styles.stepTitle}>{t('onboarding.steps.homeState.title')}</Text>
            <MutedText>{t('onboarding.steps.homeState.subtitle')}</MutedText>
            <Field
              value={homeState}
              onChangeText={(v) => setHomeState(v.toUpperCase().slice(0, 2))}
              placeholder="TX"
              autoCapitalize="characters"
              maxLength={2}
            />
          </>
        );
      case 2:
        return (
          <>
            <Text style={styles.stepTitle}>{t('onboarding.steps.dotMc.title')}</Text>
            <MutedText>{t('onboarding.steps.dotMc.subtitle')}</MutedText>
            <MutedText style={{ marginTop: spacing.sm }}>{t('onboarding.steps.dotMc.dotLabel')}</MutedText>
            <Field value={dotNumber} onChangeText={setDotNumber} keyboardType="numeric" />
            <MutedText>{t('onboarding.steps.dotMc.mcLabel')}</MutedText>
            <Field value={mcNumber} onChangeText={setMcNumber} keyboardType="numeric" />
          </>
        );
      case 3:
        return (
          <>
            <Text style={styles.stepTitle}>{t('onboarding.steps.role.title')}</Text>
            <MutedText>{t('onboarding.steps.role.subtitle')}</MutedText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm }}>
              {ROLES.map((r) => (
                <Pill key={r} label={t(`onboarding.roles.${r}`)} selected={role === r} onPress={() => setRole(r)} />
              ))}
            </View>
          </>
        );
      case 4:
        return (
          <>
            <Text style={styles.stepTitle}>{t('onboarding.steps.truck.title')}</Text>
            <MutedText>{t('onboarding.steps.truck.subtitle')}</MutedText>
            <MutedText style={{ marginTop: spacing.sm }}>{t('onboarding.steps.truck.unitLabel')}</MutedText>
            <Field value={unitNumber} onChangeText={setUnitNumber} />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <MutedText>{t('onboarding.steps.truck.yearLabel')}</MutedText>
                <Field keyboardType="numeric" value={truckYear} onChangeText={setTruckYear} />
              </View>
              <View style={{ flex: 2 }}>
                <MutedText>{t('onboarding.steps.truck.makeLabel')}</MutedText>
                <Field value={truckMake} onChangeText={setTruckMake} />
              </View>
            </View>
            <MutedText>{t('onboarding.steps.truck.modelLabel')}</MutedText>
            <Field value={truckModel} onChangeText={setTruckModel} />
            <MutedText>{t('onboarding.steps.truck.odometerLabel')}</MutedText>
            <Field keyboardType="numeric" value={odometer} onChangeText={setOdometer} />
          </>
        );
      case 5:
        return (
          <>
            <Text style={styles.stepTitle}>{t('onboarding.steps.trailer.title')}</Text>
            <MutedText>{t('onboarding.steps.trailer.subtitle')}</MutedText>
            {!truckId ? (
              <MutedText style={{ marginTop: spacing.sm }}>{t('onboarding.noTruckYet')}</MutedText>
            ) : (
              <>
                <MutedText style={{ marginTop: spacing.sm }}>{t('onboarding.steps.trailer.unitLabel')}</MutedText>
                <Field value={trailerUnit} onChangeText={setTrailerUnit} />
                <MutedText>{t('onboarding.steps.trailer.vinLabel')}</MutedText>
                <Field value={trailerVin} onChangeText={setTrailerVin} />
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <MutedText>{t('onboarding.steps.trailer.yearLabel')}</MutedText>
                    <Field keyboardType="numeric" value={trailerYear} onChangeText={setTrailerYear} />
                  </View>
                  <View style={{ flex: 2 }}>
                    <MutedText>{t('onboarding.steps.trailer.makeLabel')}</MutedText>
                    <Field value={trailerMake} onChangeText={setTrailerMake} />
                  </View>
                </View>
                <MutedText>{t('onboarding.steps.trailer.modelLabel')}</MutedText>
                <Field value={trailerModel} onChangeText={setTrailerModel} />
              </>
            )}
          </>
        );
      case 6:
        return (
          <>
            <Text style={styles.stepTitle}>{t('onboarding.steps.maintenance.title')}</Text>
            <MutedText>{t('onboarding.steps.maintenance.subtitle')}</MutedText>
            {!truckId ? (
              <MutedText style={{ marginTop: spacing.sm }}>{t('onboarding.noTruckYet')}</MutedText>
            ) : intervals.length === 0 ? (
              <MutedText style={{ marginTop: spacing.sm }}>{t('common.loading')}</MutedText>
            ) : (
              intervals.map((iv, i) => {
                const draft = intervalDrafts[iv.id] ?? { value: '', enabled: iv.enabled };
                return (
                  <View key={iv.id} style={[{ marginTop: spacing.sm, paddingTop: spacing.sm }, i > 0 && styles.rowBorder]}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: colors.text, fontWeight: '600' }}>
                        {HEALTH_CATEGORY_ICON[iv.category as HealthCategory] ?? '🔧'} {t(`truckHealth.categories.${iv.category}`)}
                      </Text>
                      <Pressable
                        onPress={() => setIntervalDrafts((prev) => ({ ...prev, [iv.id]: { ...draft, enabled: !draft.enabled } }))}
                        style={{
                          paddingHorizontal: spacing.sm,
                          paddingVertical: 4,
                          borderRadius: radii.sm,
                          borderWidth: 1,
                          borderColor: draft.enabled ? colors.accent : colors.border,
                          backgroundColor: draft.enabled ? colors.accent : colors.card2,
                        }}
                      >
                        <Text style={{ color: colors.text, fontSize: typography.size.xs, fontWeight: '600' }}>
                          {draft.enabled ? t('truckHealth.enabled') : t('truckHealth.disabled')}
                        </Text>
                      </Pressable>
                    </View>
                    <Field
                      keyboardType="numeric"
                      value={draft.value}
                      onChangeText={(v) => setIntervalDrafts((prev) => ({ ...prev, [iv.id]: { ...draft, value: v } }))}
                      placeholder={iv.tracking_mode === 'hours' ? t('truckHealth.intervalHoursLabel') : t('truckHealth.intervalMilesLabel')}
                    />
                  </View>
                );
              })
            )}
          </>
        );
      case 7:
        return (
          <>
            <Text style={styles.stepTitle}>{t('onboarding.steps.openingBalance.title')}</Text>
            <MutedText>{t('onboarding.steps.openingBalance.subtitle')}</MutedText>
            <Field keyboardType="numeric" value={openingBalance} onChangeText={setOpeningBalance} placeholder="0.00" />
          </>
        );
      case 8:
        return (
          <>
            <Text style={styles.stepTitle}>{t('onboarding.steps.taxYear.title')}</Text>
            <MutedText>{t('onboarding.steps.taxYear.subtitle')}</MutedText>
            <Field keyboardType="numeric" value={taxYear} onChangeText={setTaxYear} maxLength={4} />
            <LegalFootnote />
          </>
        );
      default:
        return null;
    }
  }

  const isOptionalStep = step === 2 || step === 5 || step === 7;
  const isLastStep = step === STEP_COUNT - 1;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <ScreenTitle>{t('onboarding.title')}</ScreenTitle>
          {step === 0 && (
            <Pressable onPress={handleSkipAll} hitSlop={8}>
              <MutedText>{t('onboarding.skipSetup')}</MutedText>
            </Pressable>
          )}
        </View>

        <MutedText style={{ marginBottom: spacing.sm }}>
          {t('onboarding.stepOf', { current: step + 1, total: STEP_COUNT })}
        </MutedText>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${((step + 1) / STEP_COUNT) * 100}%` }]} />
        </View>

        <Card>{renderStep()}</Card>

        <PrimaryButton
          title={isLastStep ? `✅ ${t('onboarding.finish')}` : t('onboarding.next')}
          onPress={() => goNext(STEP_ACTIONS[step])}
          loading={saving}
        />
        {isOptionalStep && <SecondaryButton title={t('onboarding.skipStep')} onPress={() => goNext()} />}
        {step > 0 && <SecondaryButton title={t('onboarding.back')} onPress={goBack} />}
      </ScrollView>
    </Screen>
  );
}

const styles = {
  stepTitle: {
    color: colors.text,
    fontSize: typography.size.lg,
    fontWeight: '700' as const,
    marginBottom: spacing.xs,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.card2,
    overflow: 'hidden' as const,
    marginBottom: spacing.md,
  },
  progressFill: {
    height: '100%' as const,
    backgroundColor: colors.accent,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
};
