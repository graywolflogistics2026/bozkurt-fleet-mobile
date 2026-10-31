import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSettlements } from '@/src/data/settlements';
import { useLoads } from '@/src/data/loads';
import { useTrucksList } from '@/src/data/trucks';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { computeKpis } from '@/src/stats/kpi';
import { HERO_PERIODS, type HeroPeriod } from '@/src/stats/heroPeriod';
import { resolveHeroPeriodDateWindow, type DateWindow } from '@/src/stats/heroPeriodWindow';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { saveManualMilesSplit, validateMilesSplit, WeekReviewNotInstalledError } from '@/src/data/weekReviewMutations';
import { FleetScopeLabel } from '@/src/components/FleetScopeLabel';
import { useFormatters } from '@/src/i18n/format';
import { Card, Field, ModalSheet, MutedText, PrimaryButton, Screen, SheetTitle } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';
import { numOrNull } from '@/src/lib/number';
import type { WeekMiles } from '@/src/stats/miles';

// MILES PER WEEK (owner decision 2026-10-30, master plan batch C item 6):
// Home's Total Miles opens this list — week ending, truck, loaded, empty,
// total, deadhead % — for the same period (plus All) and truck scope. Every
// figure is computeKpis()'s (src/stats/kpi.ts miles.weeks), the one source
// Home and Scorecard read. Loaded/empty are editable per week; a manual
// split survives re-imports (src/import/milesSplit.ts).

type MilesPeriod = HeroPeriod | 'all';
const MILES_PERIODS: MilesPeriod[] = [...HERO_PERIODS, 'all'];

export default function MilesWeeks() {
  const { t } = useTranslation();
  const { number, date } = useFormatters();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ period?: string; startIso?: string; endIso?: string }>();
  const { activeTruck } = useActiveTruck();
  const settlementsQuery = useSettlements();
  const loadsQuery = useLoads();
  const trucksQuery = useTrucksList();
  const trucks = trucksQuery.data ?? [];

  const initialPeriod = (MILES_PERIODS as string[]).includes(params.period ?? '') ? (params.period as MilesPeriod) : 'all';
  const [period, setPeriod] = useState<MilesPeriod>(initialPeriod);
  // Opened from Home: the exact window Home just showed, so the numbers match.
  const homeWindow: DateWindow | null =
    params.startIso && params.endIso && period === initialPeriod ? { startIso: params.startIso, endIso: params.endIso } : null;

  const truckScope = activeTruck?.id ?? null;
  const kpi = useMemo(() => {
    const settlements = settlementsQuery.data ?? [];
    const scoped = truckScope ? settlements.filter((s) => s.truck_id === truckScope || s.truck_id == null) : settlements;
    const weekEndings = [...new Set(scoped.map((s) => s.week_ending))].sort();
    const window = period === 'all' ? null : (homeWindow ?? resolveHeroPeriodDateWindow(period, weekEndings, new Date()));
    if (period !== 'all' && !window) return null;
    return computeKpis({
      trucks,
      settlements,
      loads: loadsQuery.data ?? [],
      deductions: [],
      fuelPurchases: [],
      maintenanceRecords: [],
      tolls: [],
      reimbursements: [],
      truckScope,
      manualMilesOverride: activeTruck?.manual_total_miles_override,
      window,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settlementsQuery.data, loadsQuery.data, trucks, truckScope, period, params.startIso, params.endIso, activeTruck]);

  const [editing, setEditing] = useState<WeekMiles | null>(null);
  const [loadedDraft, setLoadedDraft] = useState('');
  const [emptyDraft, setEmptyDraft] = useState('');
  const [saving, setSaving] = useState(false);

  function openEdit(w: WeekMiles) {
    setEditing(w);
    setLoadedDraft(w.loadedMiles != null ? String(w.loadedMiles) : '');
    setEmptyDraft(w.emptyMiles != null ? String(w.emptyMiles) : '');
  }

  async function saveEdit() {
    if (!editing) return;
    const loaded = numOrNull(loadedDraft);
    const empty = numOrNull(emptyDraft);
    const check = validateMilesSplit(loaded, empty);
    if (check !== 'ok') {
      Alert.alert(t('milesWeeks.invalidTitle'), t(`milesWeeks.invalid.${check}`));
      return;
    }
    setSaving(true);
    try {
      await saveManualMilesSplit(editing.settlementId, loaded!, empty!);
      await invalidateFinancialData(queryClient, { entities: ['settlements'] });
      setEditing(null);
    } catch (err) {
      Alert.alert(
        t('milesWeeks.saveFailedTitle'),
        err instanceof WeekReviewNotInstalledError ? t('weekReview.needsDb') : err instanceof Error ? err.message : t('common.tryAgain')
      );
    } finally {
      setSaving(false);
    }
  }

  const unit = (truckId: string | null) => (truckId ? (trucks.find((x) => x.id === truckId)?.unit_number ?? '—') : t('fleetScope.unassigned'));
  const pct = (empty: number | null, total: number) => (empty != null && total > 0 ? `${((empty / total) * 100).toFixed(1)}%` : '—');

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl }}>
        <FleetScopeLabel />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
          {MILES_PERIODS.map((p) => (
            <Pressable
              key={p}
              onPress={() => setPeriod(p)}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 10,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: period === p ? colors.accent : colors.border,
                backgroundColor: period === p ? colors.accent : colors.card2,
              }}
            >
              <Text style={{ color: colors.text, fontWeight: '600', fontSize: typography.size.xs }}>
                {p === 'all' ? t('milesWeeks.all') : t(`dashboard.hero.periodTabs.${p}`)}
              </Text>
            </Pressable>
          ))}
        </View>

        {!kpi || kpi.miles.weeks.length === 0 ? (
          <MutedText>{t('milesWeeks.noWeeks')}</MutedText>
        ) : (
          <>
            <Card style={{ marginBottom: spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Summary label={t('milesWeeks.total')} value={number(kpi.miles.total)} />
                <Summary label={t('milesWeeks.loaded')} value={number(kpi.miles.loaded)} />
                <Summary label={t('milesWeeks.empty')} value={number(kpi.miles.empty)} />
                <Summary
                  label={t('milesWeeks.deadheadPct')}
                  value={kpi.miles.deadheadPct != null ? `${(kpi.miles.deadheadPct * 100).toFixed(1)}%` : '—'}
                />
              </View>
              {kpi.miles.weeksWithoutBreakdown > 0 && (
                <MutedText style={{ color: colors.orange, marginTop: spacing.xs }}>
                  {t('milesWeeks.withoutBreakdown', { count: kpi.miles.weeksWithoutBreakdown })}
                </MutedText>
              )}
              <MutedText style={{ marginTop: spacing.xs }}>{t('milesWeeks.editHint')}</MutedText>
            </Card>

            {kpi.miles.weeks.map((w) => (
              <Pressable key={w.settlementId} onPress={() => openEdit(w)}>
                <Card style={{ marginBottom: spacing.xs }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{t('milesWeeks.weekOf', { date: date(w.weekEnding) })}</Text>
                    <MutedText>🚚 {unit(w.truckId)}</MutedText>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
                    <Summary label={t('milesWeeks.loaded')} value={w.loadedMiles != null ? number(w.loadedMiles) : '—'} />
                    <Summary label={t('milesWeeks.empty')} value={w.emptyMiles != null ? number(w.emptyMiles) : '—'} />
                    <Summary label={t('milesWeeks.total')} value={number(w.totalMiles)} />
                    <Summary label={t('milesWeeks.deadheadPct')} value={pct(w.emptyMiles, w.totalMiles)} />
                  </View>
                  <MutedText style={{ marginTop: 2 }}>
                    {w.splitSource == null
                      ? t('milesWeeks.noBreakdown')
                      : t(`milesWeeks.source.${w.splitSource}`) + (w.splitLabel ? ` · "${w.splitLabel}"` : '')}
                  </MutedText>
                </Card>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>

      <ModalSheet visible={!!editing} onClose={() => setEditing(null)}>
        {editing && (
          <>
            <SheetTitle>{t('milesWeeks.weekOf', { date: date(editing.weekEnding) })}</SheetTitle>
            <MutedText>{t('milesWeeks.loaded')}</MutedText>
            <Field keyboardType="numeric" value={loadedDraft} onChangeText={setLoadedDraft} placeholder="0" />
            <MutedText>{t('milesWeeks.empty')}</MutedText>
            <Field keyboardType="numeric" value={emptyDraft} onChangeText={setEmptyDraft} placeholder="0" />
            <MutedText style={{ marginVertical: spacing.xs }}>{t('milesWeeks.manualNote')}</MutedText>
            <PrimaryButton title={t('common.save')} onPress={saveEdit} loading={saving} />
          </>
        )}
      </ModalSheet>
    </Screen>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <MutedText style={{ fontSize: typography.size.xs, textAlign: 'center' }}>{label}</MutedText>
      <Text style={{ color: colors.text, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}
