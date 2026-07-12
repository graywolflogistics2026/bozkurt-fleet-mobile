import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import {
  useComplianceItems,
  useInsertComplianceItem,
  useUpdateComplianceItem,
  useDeleteComplianceItem,
} from '@/src/data/complianceItems';
import {
  calcComplianceStatus,
  sortByDueDate,
  COMPLIANCE_TYPES,
  COMPLIANCE_TYPE_ICON,
  DEFAULT_RECURRENCE,
  type ComplianceUrgency,
} from '@/src/compliance/status';
import {
  getNotificationPermissionStatus,
  requestNotificationPermission,
  scheduleComplianceNotification,
  type NotificationPermissionStatus,
} from '@/src/notifications/complianceNotifications';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, ModalSheet, SheetTitle, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';
import type { ComplianceItem } from '@/src/types/db';

const RECURRENCES: NonNullable<ComplianceItem['recurrence']>[] = ['none', 'annual', 'biennial', 'quarterly'];

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

function urgencyColor(urgency: ComplianceUrgency): string {
  if (urgency === 'overdue') return colors.red;
  if (urgency === 'due_soon') return colors.orange;
  return colors.green;
}

type FormState = {
  type: ComplianceItem['type'];
  label: string;
  dueDate: string;
  recurrence: NonNullable<ComplianceItem['recurrence']>;
};

function emptyForm(): FormState {
  return { type: 'other', label: '', dueDate: '', recurrence: 'none' };
}

export default function ComplianceTracker() {
  const { t } = useTranslation();
  const { date } = useFormatters();
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();

  const itemsQuery = useComplianceItems();
  const insertItem = useInsertComplianceItem();
  const updateItem = useUpdateComplianceItem();
  const deleteItem = useDeleteComplianceItem();

  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState<FormState>(emptyForm());
  const [editing, setEditing] = useState<ComplianceItem | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [notifStatus, setNotifStatus] = useState<NotificationPermissionStatus | null>(null);

  useEffect(() => {
    getNotificationPermissionStatus().then(setNotifStatus);
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ['compliance_items'], refetchType: 'all' });
    } finally {
      setRefreshing(false);
    }
  }

  const items = useMemo(() => sortByDueDate(itemsQuery.data ?? []), [itemsQuery.data]);
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Local notifications, same "compute on screen mount, dedupe so it
  // doesn't nag daily" pattern as Truck Health (no background task runner
  // exists yet — see complianceNotifications.ts).
  useEffect(() => {
    if (notifStatus !== 'granted') return;
    for (const item of items) {
      const { urgency } = calcComplianceStatus(item.due_date);
      if (urgency !== 'due_soon' && urgency !== 'overdue') continue;
      const label = item.label || t(`compliance.types.${item.type}`);
      const title =
        urgency === 'overdue' ? t('compliance.notifOverdueTitle', { label }) : t('compliance.notifDueSoonTitle', { label });
      const body =
        urgency === 'overdue'
          ? t('compliance.notifOverdueBody', { label, date: date(item.due_date) })
          : t('compliance.notifDueSoonBody', { label, date: date(item.due_date) });
      scheduleComplianceNotification({ itemId: item.id, status: urgency, title, body });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, notifStatus]);

  async function handleEnableNotifications() {
    const status = await requestNotificationPermission();
    setNotifStatus(status);
  }

  function openAdd() {
    setAddForm(emptyForm());
    setAdding(true);
  }

  function openEdit(item: ComplianceItem) {
    setEditing(item);
    setEditForm({ type: item.type, label: item.label, dueDate: item.due_date, recurrence: item.recurrence ?? 'none' });
  }

  async function handleSaveAdd() {
    if (!userId) return;
    if (!addForm.dueDate.trim()) {
      Alert.alert(t('compliance.enterDueDateTitle'));
      return;
    }
    setSaving(true);
    try {
      await insertItem.mutateAsync({
        user_id: userId,
        type: addForm.type,
        label: addForm.label.trim() || t(`compliance.types.${addForm.type}`),
        due_date: addForm.dueDate,
        recurrence: addForm.recurrence,
      });
      setAdding(false);
    } catch (err) {
      Alert.alert(t('compliance.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit() {
    if (!editing) return;
    if (!editForm.dueDate.trim()) {
      Alert.alert(t('compliance.enterDueDateTitle'));
      return;
    }
    setSaving(true);
    try {
      await updateItem.mutateAsync({
        id: editing.id,
        values: {
          type: editForm.type,
          label: editForm.label.trim() || t(`compliance.types.${editForm.type}`),
          due_date: editForm.dueDate,
          recurrence: editForm.recurrence,
        },
      });
      setEditing(null);
    } catch (err) {
      Alert.alert(t('compliance.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(item: ComplianceItem) {
    Alert.alert(t('compliance.deleteConfirmTitle'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteItem.mutateAsync(item.id);
            setEditing(null);
          } catch (err) {
            Alert.alert(t('compliance.deleteFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
          }
        },
      },
    ]);
  }

  function renderForm(form: FormState, setForm: (f: FormState) => void) {
    return (
      <>
        <MutedText>{t('compliance.typeLabel')}</MutedText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {COMPLIANCE_TYPES.map((ct) => (
            <Pill
              key={ct}
              label={`${COMPLIANCE_TYPE_ICON[ct]} ${t(`compliance.types.${ct}`)}`}
              selected={form.type === ct}
              onPress={() => setForm({ ...form, type: ct, recurrence: DEFAULT_RECURRENCE[ct] })}
            />
          ))}
        </View>

        <MutedText>{t('compliance.labelLabel')}</MutedText>
        <Field value={form.label} onChangeText={(v) => setForm({ ...form, label: v })} placeholder={t(`compliance.types.${form.type}`)} />

        <MutedText>{t('compliance.dueDateLabel')}</MutedText>
        <Field value={form.dueDate} onChangeText={(v) => setForm({ ...form, dueDate: v })} placeholder="YYYY-MM-DD" />

        <MutedText>{t('compliance.recurrenceLabel')}</MutedText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {RECURRENCES.map((r) => (
            <Pill key={r} label={t(`compliance.recurrence.${r}`)} selected={form.recurrence === r} onPress={() => setForm({ ...form, recurrence: r })} />
          ))}
        </View>
      </>
    );
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <ScreenTitle>{t('compliance.title')}</ScreenTitle>
          <Pressable onPress={openAdd} hitSlop={8}>
            <Text style={{ color: colors.accent, fontSize: typography.size.md, fontWeight: '700' }}>+ {t('compliance.add')}</Text>
          </Pressable>
        </View>
        <MutedText>{t('compliance.subtitle')}</MutedText>

        {notifStatus === 'undetermined' && (
          <Card>
            <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>{t('compliance.notifBannerTitle')}</Text>
            <MutedText>{t('compliance.notifBannerBody')}</MutedText>
            <PrimaryButton title={t('compliance.notifEnableButton')} onPress={handleEnableNotifications} />
          </Card>
        )}

        {itemsQuery.isLoading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : items.length === 0 ? (
          <Card>
            <MutedText>{t('compliance.empty')}</MutedText>
          </Card>
        ) : (
          <Card>
            {items.map((item, i) => {
              const { daysUntil, urgency } = calcComplianceStatus(item.due_date, new Date(todayIso));
              return (
                <Pressable
                  key={item.id}
                  onPress={() => openEdit(item)}
                  style={[styles.row, i > 0 && styles.rowBorder]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabel} numberOfLines={1}>
                      {COMPLIANCE_TYPE_ICON[item.type]} {item.label || t(`compliance.types.${item.type}`)}
                    </Text>
                    <MutedText>{date(item.due_date)}</MutedText>
                  </View>
                  <View style={{ paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radii.sm, backgroundColor: urgencyColor(urgency) }}>
                    <Text style={{ color: '#0f1117', fontSize: typography.size.xs, fontWeight: '700' }}>
                      {urgency === 'overdue'
                        ? t('compliance.overdueBy', { count: Math.abs(daysUntil) })
                        : t('compliance.dueInDays', { count: daysUntil })}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </Card>
        )}
      </ScrollView>

      <ModalSheet visible={adding} onClose={() => setAdding(false)}>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }}>
          <SheetTitle>{t('compliance.addTitle')}</SheetTitle>
          {renderForm(addForm, setAddForm)}
          <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSaveAdd} loading={saving} />
          <SecondaryButton title={t('common.cancel')} onPress={() => setAdding(false)} />
        </ScrollView>
      </ModalSheet>

      <ModalSheet visible={!!editing} onClose={() => setEditing(null)}>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }}>
          <SheetTitle>{t('compliance.editTitle')}</SheetTitle>
          {renderForm(editForm, setEditForm)}
          <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSaveEdit} loading={saving} />
          {editing && (
            <Pressable onPress={() => handleDelete(editing)} hitSlop={8} style={{ marginTop: spacing.sm, alignItems: 'center' }}>
              <Text style={{ color: colors.red, fontSize: typography.size.sm, fontWeight: '700' }}>{t('compliance.delete')}</Text>
            </Pressable>
          )}
          <SecondaryButton title={t('common.cancel')} onPress={() => setEditing(null)} />
        </ScrollView>
      </ModalSheet>
    </Screen>
  );
}

const styles = {
  row: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: spacing.sm,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowLabel: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '600' as const,
  },
};
