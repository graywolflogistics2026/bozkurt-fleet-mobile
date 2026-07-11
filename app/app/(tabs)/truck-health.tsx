import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useTrucksList, useUpdateTruck } from '@/src/data/trucks';
import { useMaintenanceRecords } from '@/src/data/maintenanceRecords';
import { useMaintenanceIntervals, useUpdateMaintenanceInterval } from '@/src/data/maintenanceIntervals';
import { useTruckHealthConfig } from '@/src/data/truckHealthConfig';
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

function CategoryCard({ result, t, formatters }: { result: HealthResult; t: TFunction; formatters: ReturnType<typeof useFormatters> }) {
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
    </Card>
  );
}

export default function TruckHealth() {
  const { t } = useTranslation();
  const formatters = useFormatters();
  const { number } = formatters;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeTruckId, loading: activeTruckLoading } = useActiveTruck();

  const trucksQuery = useTrucksList();
  const truck = useMemo(() => trucksQuery.data?.find((tr) => tr.id === activeTruckId) ?? null, [trucksQuery.data, activeTruckId]);

  const recordsQuery = useMaintenanceRecords(activeTruckId ? { truck_id: activeTruckId } : undefined);
  const intervalsQuery = useMaintenanceIntervals(activeTruckId);
  const healthConfigQuery = useTruckHealthConfig(activeTruckId);
  const updateTruck = useUpdateTruck();
  const updateInterval = useUpdateMaintenanceInterval();

  const [refreshing, setRefreshing] = useState(false);
  const [editingIntervals, setEditingIntervals] = useState(false);
  const [intervalDrafts, setIntervalDrafts] = useState<Record<string, { value: string; enabled: boolean }>>({});
  const [savingIntervals, setSavingIntervals] = useState(false);
  const [editingOdometer, setEditingOdometer] = useState(false);
  const [odometerDraft, setOdometerDraft] = useState('');
  const [savingOdometer, setSavingOdometer] = useState(false);
  const [notifStatus, setNotifStatus] = useState<NotificationPermissionStatus | null>(null);

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
              results.map((r) => <CategoryCard key={r.category} result={r} t={t} formatters={formatters} />)
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
