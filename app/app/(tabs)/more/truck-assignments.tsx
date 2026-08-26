import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useTrucksList } from '@/src/data/trucks';
import { useSettlements, useUpdateSettlement } from '@/src/data/settlements';
import { useFuelPurchases, useUpdateFuelPurchase } from '@/src/data/fuelPurchases';
import { useMaintenanceRecords, useUpdateMaintenanceRecord } from '@/src/data/maintenanceRecords';
import { useTolls, useUpdateToll } from '@/src/data/tolls';
import { findUnassignedRows, UNASSIGNED_ROW_TABLE, type UnassignedRow, type UnassignedRowKind } from '@/src/import/truckAssignmentRepair';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, TappableCard, PrimaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';

// TRUCK ASSIGNMENT REPAIR FLOW (MULTI-TRUCK MODEL, owner decision) —
// requirement 3's second half: a screen listing every settlement/fuel/
// maintenance/toll row with no truck_id, with bulk assign. Framed
// neutrally ("assign a truck," never "your data is broken") — a row with
// no truck can be entirely legitimate if it predates the account's 2nd
// truck.

function kindLabel(t: (k: string) => string, kind: UnassignedRowKind): string {
  return t(`truckAssignments.kind.${kind}`);
}

export default function TruckAssignments() {
  const { t } = useTranslation();
  const { money, date } = useFormatters();
  const queryClient = useQueryClient();
  const trucksQuery = useTrucksList();
  const settlementsQuery = useSettlements();
  const fuelQuery = useFuelPurchases();
  const maintenanceQuery = useMaintenanceRecords();
  const tollsQuery = useTolls();
  const updateSettlement = useUpdateSettlement();
  const updateFuel = useUpdateFuelPurchase();
  const updateMaintenance = useUpdateMaintenanceRecord();
  const updateToll = useUpdateToll();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTruckId, setBulkTruckId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  const rows = useMemo(
    () => findUnassignedRows(settlementsQuery.data ?? [], fuelQuery.data ?? [], maintenanceQuery.data ?? [], tollsQuery.data ?? []),
    [settlementsQuery.data, fuelQuery.data, maintenanceQuery.data, tollsQuery.data]
  );
  const trucks = trucksQuery.data ?? [];

  function rowKey(r: UnassignedRow) {
    return `${r.kind}:${r.id}`;
  }

  function toggle(r: UnassignedRow) {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = rowKey(r);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function assignOne(r: UnassignedRow, truckId: string) {
    if (r.kind === 'settlement') await updateSettlement.mutateAsync({ id: r.id, values: { truck_id: truckId } });
    else if (r.kind === 'fuel') await updateFuel.mutateAsync({ id: r.id, values: { truck_id: truckId } });
    else if (r.kind === 'maintenance') await updateMaintenance.mutateAsync({ id: r.id, values: { truck_id: truckId } });
    else await updateToll.mutateAsync({ id: r.id, values: { truck_id: truckId } });
  }

  function openRowPicker(r: UnassignedRow) {
    Alert.alert(
      t('truckAssignments.assignThisRow'),
      undefined,
      trucks
        .map((truck) => ({
          text: truck.unit_number ?? truck.id,
          onPress: async () => {
            try {
              await assignOne(r, truck.id);
              await invalidateFinancialData(queryClient, { entities: [UNASSIGNED_ROW_TABLE[r.kind]] });
            } catch (err) {
              Alert.alert(t('common.error'), err instanceof Error ? err.message : t('deductions.genericRetry'));
            }
          },
        }))
        .concat([{ text: t('truckSwitcher.cancel'), style: 'cancel' } as any])
    );
  }

  async function handleBulkAssign() {
    if (!bulkTruckId || selected.size === 0) return;
    setAssigning(true);
    try {
      const selectedRows = rows.filter((r) => selected.has(rowKey(r)));
      for (const r of selectedRows) {
        await assignOne(r, bulkTruckId);
      }
      await invalidateFinancialData(queryClient, {
        entities: ['settlements', 'fuel_purchases', 'maintenance_records', 'tolls'],
      });
      setSelected(new Set());
    } catch (err) {
      Alert.alert(t('common.error'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setAssigning(false);
    }
  }

  const isLoading = trucksQuery.isLoading || settlementsQuery.isLoading;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScreenTitle>{t('truckAssignments.title')}</ScreenTitle>
        <MutedText style={{ marginBottom: spacing.sm }}>{t('truckAssignments.subtitle')}</MutedText>

        {trucks.length <= 1 ? (
          <Card>
            <MutedText>{t('truckAssignments.needsMultipleTrucks')}</MutedText>
          </Card>
        ) : isLoading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <MutedText>{t('truckAssignments.empty')}</MutedText>
          </Card>
        ) : (
          <>
            <Card>
              <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>
                {t('truckAssignments.bulkTitle', { count: selected.size })}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm }}>
                {trucks.map((truck) => (
                  <Pressable
                    key={truck.id}
                    onPress={() => setBulkTruckId(truck.id)}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      borderRadius: radii.sm,
                      borderWidth: 1,
                      borderColor: bulkTruckId === truck.id ? colors.accent : colors.border,
                      backgroundColor: bulkTruckId === truck.id ? colors.accent : colors.card2,
                      marginEnd: spacing.xs,
                      marginBottom: spacing.xs,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '600' }}>{t('common.unit', { unit: truck.unit_number ?? truck.id })}</Text>
                  </Pressable>
                ))}
              </View>
              <PrimaryButton
                title={t('truckAssignments.assignSelected', { count: selected.size })}
                onPress={handleBulkAssign}
                loading={assigning}
                disabled={selected.size === 0 || !bulkTruckId}
              />
            </Card>

            {rows.map((r) => {
              const key = rowKey(r);
              const isSelected = selected.has(key);
              return (
                <TappableCard key={key} onPress={() => toggle(r)} style={isSelected ? { borderColor: colors.accent, borderWidth: 2 } : undefined}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ fontSize: 18, marginEnd: spacing.sm }}>{isSelected ? '☑️' : '⬜'}</Text>
                    <View style={{ flex: 1, marginEnd: spacing.sm }}>
                      <Text style={{ color: colors.text, fontWeight: '600' }} numberOfLines={1}>
                        {kindLabel(t, r.kind)}{r.label ? ` · ${r.label}` : ''}
                      </Text>
                      <MutedText numberOfLines={1}>{r.date ? date(r.date) : '—'}</MutedText>
                    </View>
                    <Text style={{ color: colors.text, fontWeight: '700', marginEnd: spacing.sm }}>
                      {r.amount != null ? money(r.amount, { maximumFractionDigits: 0 }) : '—'}
                    </Text>
                    <Pressable onPress={() => openRowPicker(r)} hitSlop={8}>
                      <Text style={{ color: colors.accent, fontWeight: '600' }}>🚚</Text>
                    </Pressable>
                  </View>
                </TappableCard>
              );
            })}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
