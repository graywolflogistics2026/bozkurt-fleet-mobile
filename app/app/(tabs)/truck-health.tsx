import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useTrucksList, useUpdateTruck } from '@/src/data/trucks';
import { useMaintenanceRecords, useInsertMaintenanceRecord } from '@/src/data/maintenanceRecords';
import { useMaintenanceIntervals, useUpdateMaintenanceInterval } from '@/src/data/maintenanceIntervals';
import { useTruckHealthConfig } from '@/src/data/truckHealthConfig';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { calcTruckHealth, type HealthResult, type HealthOverrides } from '@/src/truck/health';
import { HEALTH_CATEGORIES, HEALTH_CATEGORY_ICON, type HealthCategory } from '@/src/truck/categories';
import {
  getNotificationPermissionStatus,
  requestNotificationPermission,
  scheduleHealthNotification,
  type NotificationPermissionStatus,
} from '@/src/notifications/truckHealthNotifications';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, ModalSheet, SheetTitle, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';
import type { MaintenanceInterval } from '@/src/types/db';

function statusColor(status: HealthResult['status']): string {
  if (status === 'overdue') return colors.red;
  if (status === 'due_soon') return colors.orange;
  if (status === 'ok') return colors.green;
  return colors.muted;
}

function MarkAsDoneAction({ t, onPress }: { t: TFunction; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={{ alignSelf: 'flex-start', marginTop: spacing.sm }}>
      <Text style={{ color: colors.accent, fontSize: typography.size.sm, fontWeight: '700' }}>
        ✅ {t('truckHealth.markAsDone')}
      </Text>
    </Pressable>
  );
}

function CategoryCard({
  result,
  t,
  formatters,
  onMarkDone,
}: {
  result: HealthResult;
  t: TFunction;
  formatters: ReturnType<typeof useFormatters>;
  onMarkDone: (result: HealthResult) => void;
}) {
  const { number, date } = formatters;
  const icon = HEALTH_CATEGORY_ICON[result.category as HealthCategory] ?? '🔧';
  const label = t(`truckHealth.categories.${result.category}`);
  const unit = result.trackingMode === 'hours' ? t('truckHealth.hoursUnit') : t('truckHealth.milesUnit');

  if (result.status === 'no_data') {
    return (
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
          <Text style={{ fontSize: 18, marginEnd: spacing.sm }}>{icon}</Text>
          <Text style={styles.categoryLabel}>{label}</Text>
        </View>
        <MutedText>{t('truckHealth.noDataPrompt')}</MutedText>
        <MarkAsDoneAction t={t} onPress={() => onMarkDone(result)} />
      </Card>
    );
  }

  const interval = result.trackingMode === 'hours' ? result.intervalHours ?? 0 : result.intervalMiles ?? 0;
  const consumed = interval - result.remaining;
  const pctUsed = interval > 0 ? Math.min(100, Math.max(0, (consumed / interval) * 100)) : 0;
  const remainingLabel =
    result.remaining < 0
      ? t('truckHealth.overdueBy', { amount: number(Math.round(Math.abs(result.remaining))), unit })
      : t('truckHealth.amountLeft', { amount: number(Math.round(result.remaining)), unit });

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <Text style={{ fontSize: 18, marginEnd: spacing.sm }}>{icon}</Text>
          <Text style={styles.categoryLabel}>{label}</Text>
        </View>
        <View style={{ paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radii.sm, backgroundColor: statusColor(result.status) }}>
          <Text style={{ color: '#0f1117', fontSize: typography.size.xs, fontWeight: '700' }}>{t(`truckHealth.status.${result.status}`)}</Text>
        </View>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.card2, overflow: 'hidden', marginBottom: spacing.xs }}>
        <View style={{ height: '100%', width: `${pctUsed}%`, backgroundColor: statusColor(result.status) }} />
      </View>
      <Text style={{ color: statusColor(result.status), fontWeight: '700', fontSize: typography.size.md }}>{remainingLabel}</Text>
      <MutedText>
        {t('truckHealth.lastDone', {
          date: result.lastDoneDate ? date(result.lastDoneDate) : '—',
          odometer: result.trackingMode === 'hours' ? number(result.baselineHours) : number(result.baselineOdometer),
          unit,
        })}
      </MutedText>
      <MutedText>{t('truckHealth.nextDue', { amount: number(Math.round(result.nextDue)), unit })}</MutedText>
      <MarkAsDoneAction t={t} onPress={() => onMarkDone(result)} />
    </Card>
  );
}

export default function TruckHealth() {
  const { t } = useTranslation();
  const formatters = useFormatters();
  const { number } = formatters;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id;
  const { activeTruckId, loading: activeTruckLoading } = useActiveTruck();

  const trucksQuery = useTrucksList();
  const truck = useMemo(() => trucksQuery.data?.find((tr) => tr.id === activeTruckId) ?? null, [trucksQuery.data, activeTruckId]);

  const recordsQuery = useMaintenanceRecords(activeTruckId ? { truck_id: activeTruckId } : undefined);
  const intervalsQuery = useMaintenanceIntervals(activeTruckId);
  const healthConfigQuery = useTruckHealthConfig(activeTruckId);
  const updateTruck = useUpdateTruck();
  const updateInterval = useUpdateMaintenanceInterval();
  const insertMaintenanceRecord = useInsertMaintenanceRecord();

  const [refreshing, setRefreshing] = useState(false);
  const [editingIntervals, setEditingIntervals] = useState(false);
  const [intervalDrafts, setIntervalDrafts] = useState<Record<string, { value: string; enabled: boolean }>>({});
  const [savingIntervals, setSavingIntervals] = useState(false);
  const [editingOdometer, setEditingOdometer] = useState(false);
  const [odometerDraft, setOdometerDraft] = useState('');
  const [savingOdometer, setSavingOdometer] = useState(false);
  const [notifStatus, setNotifStatus] = useState<NotificationPermissionStatus | null>(null);

  const [markingDone, setMarkingDone] = useState<HealthResult | null>(null);
  const [markDoneDate, setMarkDoneDate] = useState('');
  const [markDoneReading, setMarkDoneReading] = useState('');
  const [markDoneCost, setMarkDoneCost] = useState('0');
  const [markDoneNote, setMarkDoneNote] = useState('');
  const [markDoneSaving, setMarkDoneSaving] = useState(false);

  useEffect(() => {
    getNotificationPermissionStatus().then(setNotifStatus);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['trucks'], refetchType: 'all' }),
        queryClient.invalidateQueries({ queryKey: ['maintenance_records'], refetchType: 'all' }),
        queryClient.invalidateQueries({ queryKey: ['maintenance_intervals'], refetchType: 'all' }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const results = useMemo<HealthResult[]>(() => {
    if (!truck || !intervalsQuery.data) return [];
    const intervals = intervalsQuery.data.map((iv) => ({
      category: iv.category,
      trackingMode: iv.tracking_mode,
      intervalMiles: iv.interval_miles,
      intervalHours: iv.interval_hours,
      bundledWithCategory: iv.bundled_with_category,
      enabled: iv.enabled,
    }));
    const records = (recordsQuery.data ?? []).map((r) => ({
      serviceType: r.service_type,
      odometer: r.odometer,
      engineHours: r.engine_hours,
      serviceDate: r.service_date,
    }));
    const overrides = (healthConfigQuery.data?.overrides ?? {}) as HealthOverrides;
    const computed = calcTruckHealth(intervals, records, truck.current_odometer ?? 0, truck.apu_hours ?? 0, overrides);
    return [...computed].sort((a, b) => HEALTH_CATEGORIES.indexOf(a.category as HealthCategory) - HEALTH_CATEGORIES.indexOf(b.category as HealthCategory));
  }, [truck, intervalsQuery.data, recordsQuery.data, healthConfigQuery.data]);

  // Per-truck local notifications (owner ask: unit number in the title,
  // never a bare category name — app/src/notifications/truckHealthNotifications.ts
  // owns permission/dedupe mechanics, this screen owns the localized copy.
  useEffect(() => {
    if (notifStatus !== 'granted' || !truck) return;
    const unitLabel = truck.unit_number ?? truck.id;
    for (const r of results) {
      if (r.status !== 'due_soon' && r.status !== 'overdue') continue;
      const label = t(`truckHealth.categories.${r.category}`);
      const unit = r.trackingMode === 'hours' ? t('truckHealth.hoursUnit') : t('truckHealth.milesUnit');
      const amount = number(Math.round(Math.abs(r.remaining)));
      const title =
        r.status === 'overdue'
          ? t('truckHealth.notifOverdueTitle', { unit: unitLabel, label })
          : t('truckHealth.notifDueSoonTitle', { unit: unitLabel, label });
      const body =
        r.status === 'overdue'
          ? t('truckHealth.notifOverdueBody', { label, amount, unit })
          : t('truckHealth.notifDueSoonBody', { label, amount, unit });
      scheduleHealthNotification({ truckId: truck.id, category: r.category, status: r.status, title, body });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, notifStatus, truck?.id]);

  async function handleEnableNotifications() {
    const status = await requestNotificationPermission();
    setNotifStatus(status);
  }

  function openEditIntervals() {
    const drafts: Record<string, { value: string; enabled: boolean }> = {};
    for (const iv of intervalsQuery.data ?? []) {
      drafts[iv.id] = {
        value: String(iv.tracking_mode === 'hours' ? iv.interval_hours ?? '' : iv.interval_miles ?? ''),
        enabled: iv.enabled,
      };
    }
    setIntervalDrafts(drafts);
    setEditingIntervals(true);
  }

  async function handleSaveIntervals() {
    if (!intervalsQuery.data) return;
    setSavingIntervals(true);
    try {
      const changed: Array<{ id: string; values: Partial<MaintenanceInterval> }> = [];
      for (const iv of intervalsQuery.data) {
        const draft = intervalDrafts[iv.id];
        if (!draft) continue;
        const numericValue = Number(draft.value) || 0;
        const valueChanged = iv.tracking_mode === 'hours' ? numericValue !== iv.interval_hours : numericValue !== iv.interval_miles;
        const enabledChanged = draft.enabled !== iv.enabled;
        if (!valueChanged && !enabledChanged) continue;
        changed.push({
          id: iv.id,
          values: iv.tracking_mode === 'hours' ? { interval_hours: numericValue, enabled: draft.enabled } : { interval_miles: numericValue, enabled: draft.enabled },
        });
      }
      await Promise.all(changed.map((c) => updateInterval.mutateAsync(c)));
      setEditingIntervals(false);
    } finally {
      setSavingIntervals(false);
    }
  }

  function openEditOdometer() {
    setOdometerDraft(String(truck?.current_odometer ?? ''));
    setEditingOdometer(true);
  }

  async function handleSaveOdometer() {
    if (!truck) return;
    setSavingOdometer(true);
    try {
      await updateTruck.mutateAsync({ id: truck.id, values: { current_odometer: Number(odometerDraft) || 0 } });
      setEditingOdometer(false);
    } finally {
      setSavingOdometer(false);
    }
  }

  // "Mark as Done" (owner decision) — maintenance performed WITHOUT an
  // invoice (e.g. self-performed chassis lube on the road). Creates a
  // normal maintenance_records row for this category with no document
  // attached; calcTruckHealth() already resets a category's interval off
  // the highest-odometer/hours maintenance_records row per service_type
  // (src/truck/health.ts buildBaselines()), so no separate "reset" step is
  // needed here — inserting the record IS the reset, identical to an
  // invoiced record. Cost defaults to 0 (free self-service still resets
  // the interval); a non-zero cost flows into Maintenance & Repairs
  // expenses the same way any other maintenance_records row does.
  function openMarkDone(result: HealthResult) {
    setMarkingDone(result);
    setMarkDoneDate(new Date().toISOString().slice(0, 10));
    setMarkDoneReading(String(result.trackingMode === 'hours' ? truck?.apu_hours ?? 0 : truck?.current_odometer ?? 0));
    setMarkDoneCost('0');
    setMarkDoneNote('');
  }

  function closeMarkDone() {
    setMarkingDone(null);
  }

  async function handleConfirmMarkDone() {
    if (!markingDone || !truck || !userId) return;
    const isHours = markingDone.trackingMode === 'hours';
    const reading = Number(markDoneReading) || 0;
    const cost = Number(markDoneCost) || 0;
    setMarkDoneSaving(true);
    try {
      await insertMaintenanceRecord.mutateAsync({
        user_id: userId,
        truck_id: truck.id,
        service_date: markDoneDate || new Date().toISOString().slice(0, 10),
        service_type: markingDone.category,
        odometer: isHours ? null : reading || null,
        engine_hours: isHours ? reading || null : null,
        cost,
        description: markDoneNote || null,
      });

      // Same "latest reading from any source drives next-due math" rule
      // as maintenance.tsx's manual-add form — only bumps the truck's
      // tracked reading upward, never down.
      const truckUpdates: { current_odometer?: number; apu_hours?: number } = {};
      if (!isHours && reading > (truck.current_odometer ?? 0)) truckUpdates.current_odometer = reading;
      if (isHours && reading > (truck.apu_hours ?? 0)) truckUpdates.apu_hours = reading;
      if (Object.keys(truckUpdates).length > 0) await updateTruck.mutateAsync({ id: truck.id, values: truckUpdates });

      await Promise.all([
        invalidateFinancialData(queryClient),
        queryClient.invalidateQueries({ queryKey: ['trucks'], refetchType: 'all' }),
        queryClient.invalidateQueries({ queryKey: ['maintenance_intervals'], refetchType: 'all' }),
      ]);
      setMarkingDone(null);
    } catch (err) {
      Alert.alert(t('truckHealth.markDoneFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setMarkDoneSaving(false);
    }
  }

  const isLoading = activeTruckLoading || trucksQuery.isLoading;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <ScreenTitle>{t('truckHealth.title')}</ScreenTitle>
          {truck && (
            <Pressable onPress={openEditIntervals} hitSlop={8} style={{ marginBottom: spacing.md }}>
              <Text style={{ fontSize: 22 }}>⚙️</Text>
            </Pressable>
          )}
        </View>

        {isLoading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : !truck ? (
          <Card>
            <MutedText>{t('truckHealth.noTrucks')}</MutedText>
            <SecondaryButton title={t('truckHealth.addTruck')} onPress={() => router.push('/(tabs)/more/trucks')} />
          </Card>
        ) : (
          <>
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View>
                  <MutedText>{t('truckHealth.currentOdometer')}</MutedText>
                  <Text style={{ color: colors.text, fontSize: typography.size.xl, fontWeight: '700' }}>
                    {number(truck.current_odometer ?? 0)} {t('truckHealth.milesUnit')}
                  </Text>
                </View>
                <SecondaryButton title={t('truckHealth.updateOdometer')} onPress={openEditOdometer} />
              </View>
            </Card>

            {notifStatus === 'undetermined' && (
              <Card>
                <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>{t('truckHealth.notifBannerTitle')}</Text>
                <MutedText>{t('truckHealth.notifBannerBody')}</MutedText>
                <PrimaryButton title={t('truckHealth.notifEnableButton')} onPress={handleEnableNotifications} />
              </Card>
            )}

            {results.length === 0 ? (
              <Card>
                <MutedText>{t('truckHealth.noIntervals')}</MutedText>
              </Card>
            ) : (
              results.map((r) => <CategoryCard key={r.category} result={r} t={t} formatters={formatters} onMarkDone={openMarkDone} />)
            )}
          </>
        )}
      </ScrollView>

      <ModalSheet visible={editingIntervals} onClose={() => setEditingIntervals(false)}>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }}>
          <SheetTitle>{t('truckHealth.editIntervalsTitle')}</SheetTitle>
          {(intervalsQuery.data ?? [])
            .slice()
            .sort((a, b) => HEALTH_CATEGORIES.indexOf(a.category as HealthCategory) - HEALTH_CATEGORIES.indexOf(b.category as HealthCategory))
            .map((iv) => {
              const draft = intervalDrafts[iv.id] ?? { value: '', enabled: iv.enabled };
              return (
                <View key={iv.id} style={{ marginBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.sm }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
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
            })}
          <PrimaryButton title={t('common.save')} onPress={handleSaveIntervals} loading={savingIntervals} />
          <SecondaryButton title={t('common.cancel')} onPress={() => setEditingIntervals(false)} />
        </ScrollView>
      </ModalSheet>

      <ModalSheet visible={editingOdometer} onClose={() => setEditingOdometer(false)}>
        <SheetTitle>{t('truckHealth.updateOdometer')}</SheetTitle>
        <MutedText>{t('truckHealth.odometerLabel')}</MutedText>
        <Field keyboardType="numeric" value={odometerDraft} onChangeText={setOdometerDraft} placeholder="0" />
        <PrimaryButton title={t('common.save')} onPress={handleSaveOdometer} loading={savingOdometer} />
        <SecondaryButton title={t('common.cancel')} onPress={() => setEditingOdometer(false)} />
      </ModalSheet>

      <ModalSheet visible={!!markingDone} onClose={closeMarkDone}>
        {markingDone && (
          <>
            <SheetTitle>
              {t('truckHealth.markDoneTitle', { label: t(`truckHealth.categories.${markingDone.category}`) })}
            </SheetTitle>

            <MutedText>{t('truckHealth.markDoneDateLabel')}</MutedText>
            <Field value={markDoneDate} onChangeText={setMarkDoneDate} placeholder="YYYY-MM-DD" />

            <MutedText>
              {markingDone.trackingMode === 'hours' ? t('truckHealth.markDoneHoursLabel') : t('truckHealth.markDoneOdometerLabel')}
            </MutedText>
            <Field keyboardType="numeric" value={markDoneReading} onChangeText={setMarkDoneReading} placeholder="0" />

            <MutedText>{t('truckHealth.markDoneCostLabel')}</MutedText>
            <Field keyboardType="numeric" value={markDoneCost} onChangeText={setMarkDoneCost} placeholder="0.00" />

            <MutedText>{t('truckHealth.markDoneNoteLabel')}</MutedText>
            <Field value={markDoneNote} onChangeText={setMarkDoneNote} placeholder={t('truckHealth.markDoneNotePlaceholder')} />

            <PrimaryButton title={`✅ ${t('truckHealth.markDoneConfirm')}`} onPress={handleConfirmMarkDone} loading={markDoneSaving} />
            <SecondaryButton title={t('common.cancel')} onPress={closeMarkDone} />
          </>
        )}
      </ModalSheet>
    </Screen>
  );
}

const styles = {
  categoryLabel: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
  },
};
