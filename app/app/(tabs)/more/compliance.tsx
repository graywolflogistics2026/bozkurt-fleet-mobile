import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import {
  useComplianceItems,
  useInsertComplianceItem,
  useUpdateComplianceItem,
  useDeleteComplianceItem,
} from '@/src/data/complianceItems';
import { useTrucksList } from '@/src/data/trucks';
import { useDrivers } from '@/src/data/drivers';
import { uploadComplianceAttachment } from '@/src/data/complianceAttachment';
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
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { Screen, ScreenTitle, Card, MutedText, ModalSheet, SheetTitle, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';
import type { ComplianceAppliesTo, ComplianceItem } from '@/src/types/db';

const RECURRENCES: NonNullable<ComplianceItem['recurrence']>[] = ['none', 'annual', 'biennial', 'quarterly'];
const APPLIES_TO_OPTIONS: ComplianceAppliesTo[] = ['truck', 'trailer', 'driver', 'business'];

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

// DOCUMENTS & RENEWALS EXPANSION (owner decision 2026-08-24, device
// testing round, item 3) — the manual-add flow already existed (the "type"
// picker's 'other' option + free-text label); this pass adds the 6 richer
// fields docs/PENDING_SQL.md §55b introduced: issue date, a per-item
// reminder lead time (calcComplianceStatus's new optional 3rd param),
// an optional note, an optional photo/PDF attachment, and who it belongs
// to (truck/trailer/driver/business). All optional/additive — a plain
// built-in item saved without touching any of these behaves exactly as
// before.
type FormState = {
  type: ComplianceItem['type'];
  label: string;
  issueDate: string;
  dueDate: string;
  recurrence: NonNullable<ComplianceItem['recurrence']>;
  reminderLeadDays: string;
  note: string;
  appliesTo: ComplianceAppliesTo | '';
  truckId: string | null;
  driverId: string | null;
  sourceDocumentId: string | null;
  attachmentFilename: string | null;
};

function emptyForm(): FormState {
  return {
    type: 'other',
    label: '',
    issueDate: '',
    dueDate: '',
    recurrence: 'none',
    reminderLeadDays: '',
    note: '',
    appliesTo: '',
    truckId: null,
    driverId: null,
    sourceDocumentId: null,
    attachmentFilename: null,
  };
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
  const trucksQuery = useTrucksList();
  const driversQuery = useDrivers();

  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState<FormState>(emptyForm());
  const [editing, setEditing] = useState<ComplianceItem | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [attaching, setAttaching] = useState(false);
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
  // exists yet — see complianceNotifications.ts). A manual item's own
  // reminder_lead_days (docs/PENDING_SQL.md §55b) overrides the app-wide
  // 30-day default — same threshold calcComplianceStatus() itself falls
  // back to when the value is null, so a manual and a built-in item get
  // IDENTICAL urgency/notification treatment unless the user customized it.
  useEffect(() => {
    if (notifStatus !== 'granted') return;
    for (const item of items) {
      const { urgency } = calcComplianceStatus(item.due_date, new Date(), item.reminder_lead_days);
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
    setEditForm({
      type: item.type,
      label: item.label,
      issueDate: item.issue_date ?? '',
      dueDate: item.due_date,
      recurrence: item.recurrence ?? 'none',
      reminderLeadDays: item.reminder_lead_days != null ? String(item.reminder_lead_days) : '',
      note: item.note ?? '',
      appliesTo: item.applies_to ?? '',
      truckId: item.truck_id,
      driverId: item.driver_id,
      sourceDocumentId: item.source_document_id,
      attachmentFilename: null,
    });
  }

  // Shared by both add/edit forms — a form's own reminderLeadDays/
  // issueDate/note/appliesTo/truckId/driverId/sourceDocumentId all map
  // directly onto compliance_items' new nullable columns (§55b); an empty
  // string always becomes null, never an empty-string value in the DB.
  function buildSaveValues(form: FormState) {
    return {
      type: form.type,
      label: form.label.trim() || t(`compliance.types.${form.type}`),
      issue_date: form.issueDate.trim() || null,
      due_date: form.dueDate,
      recurrence: form.recurrence,
      reminder_lead_days: form.reminderLeadDays.trim() ? Math.max(0, Number(form.reminderLeadDays) || 0) : null,
      note: form.note.trim() || null,
      applies_to: form.appliesTo || null,
      truck_id: form.appliesTo === 'truck' || form.appliesTo === 'trailer' ? form.truckId : null,
      driver_id: form.appliesTo === 'driver' ? form.driverId : null,
      source_document_id: form.sourceDocumentId,
    };
  }

  async function handleSaveAdd() {
    if (!userId) return;
    if (!addForm.dueDate.trim()) {
      Alert.alert(t('compliance.enterDueDateTitle'));
      return;
    }
    setSaving(true);
    try {
      await insertItem.mutateAsync({ user_id: userId, ...buildSaveValues(addForm) });
      await invalidateFinancialData(queryClient, { entities: ['compliance_items'] });
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
      await updateItem.mutateAsync({ id: editing.id, values: buildSaveValues(editForm) });
      await invalidateFinancialData(queryClient, { entities: ['compliance_items'] });
      setEditing(null);
    } catch (err) {
      Alert.alert(t('compliance.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSaving(false);
    }
  }

  // ATTACHMENT (item 3's "optional photo/PDF attachment") — uploads
  // immediately on pick (not deferred to Save), storing the resulting
  // document id in the form's own sourceDocumentId — same "upload first,
  // reference its id" order as every other document-producing flow in
  // this app (aiImportSave.ts's own step 1/2). Best-effort: a failure here
  // never blocks the rest of the form from being filled out/saved.
  async function handleAttachPhoto(form: FormState, setForm: (f: FormState) => void) {
    if (!userId) return;
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    const filename = asset.fileName || `photo-${Date.now()}.jpg`;
    setAttaching(true);
    try {
      const documentId = await uploadComplianceAttachment(
        userId,
        form.label || t(`compliance.types.${form.type}`),
        asset.uri,
        filename,
        asset.mimeType || 'image/jpeg',
        form.dueDate || null
      );
      setForm({ ...form, sourceDocumentId: documentId, attachmentFilename: filename });
    } catch (err) {
      Alert.alert(t('compliance.attachFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setAttaching(false);
    }
  }

  async function handleAttachPdf(form: FormState, setForm: (f: FormState) => void) {
    if (!userId) return;
    const picked = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    setAttaching(true);
    try {
      const documentId = await uploadComplianceAttachment(
        userId,
        form.label || t(`compliance.types.${form.type}`),
        asset.uri,
        asset.name,
        'application/pdf',
        form.dueDate || null
      );
      setForm({ ...form, sourceDocumentId: documentId, attachmentFilename: asset.name });
    } catch (err) {
      Alert.alert(t('compliance.attachFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setAttaching(false);
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
            await invalidateFinancialData(queryClient, { entities: ['compliance_items'] });
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

        <MutedText>{t('compliance.issueDateLabel')}</MutedText>
        <Field value={form.issueDate} onChangeText={(v) => setForm({ ...form, issueDate: v })} placeholder="YYYY-MM-DD" />

        <MutedText>{t('compliance.dueDateLabel')}</MutedText>
        <Field value={form.dueDate} onChangeText={(v) => setForm({ ...form, dueDate: v })} placeholder="YYYY-MM-DD" />

        <MutedText>{t('compliance.recurrenceLabel')}</MutedText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {RECURRENCES.map((r) => (
            <Pill key={r} label={t(`compliance.recurrence.${r}`)} selected={form.recurrence === r} onPress={() => setForm({ ...form, recurrence: r })} />
          ))}
        </View>

        <MutedText>{t('compliance.reminderLeadDaysLabel')}</MutedText>
        <Field
          keyboardType="numeric"
          value={form.reminderLeadDays}
          onChangeText={(v) => setForm({ ...form, reminderLeadDays: v })}
          placeholder={t('compliance.reminderLeadDaysPlaceholder')}
        />

        <MutedText>{t('compliance.noteLabel')}</MutedText>
        <Field value={form.note} onChangeText={(v) => setForm({ ...form, note: v })} placeholder={t('compliance.notePlaceholder')} />

        <MutedText>{t('compliance.appliesToLabel')}</MutedText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Pill
            label={t('compliance.appliesToNone')}
            selected={form.appliesTo === ''}
            onPress={() => setForm({ ...form, appliesTo: '', truckId: null, driverId: null })}
          />
          {APPLIES_TO_OPTIONS.map((a) => (
            <Pill
              key={a}
              label={t(`compliance.appliesTo.${a}`)}
              selected={form.appliesTo === a}
              onPress={() => setForm({ ...form, appliesTo: a, truckId: null, driverId: null })}
            />
          ))}
        </View>

        {(form.appliesTo === 'truck' || form.appliesTo === 'trailer') && (trucksQuery.data ?? []).length > 0 && (
          <>
            <MutedText>{t('compliance.truckLabel')}</MutedText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              <Pill label={t('compliance.pickerNone')} selected={!form.truckId} onPress={() => setForm({ ...form, truckId: null })} />
              {(trucksQuery.data ?? []).map((tr) => (
                <Pill
                  key={tr.id}
                  label={tr.unit_number || tr.id}
                  selected={form.truckId === tr.id}
                  onPress={() => setForm({ ...form, truckId: tr.id })}
                />
              ))}
            </View>
          </>
        )}

        {form.appliesTo === 'driver' && (driversQuery.data ?? []).length > 0 && (
          <>
            <MutedText>{t('compliance.driverLabel')}</MutedText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              <Pill label={t('compliance.pickerNone')} selected={!form.driverId} onPress={() => setForm({ ...form, driverId: null })} />
              {(driversQuery.data ?? []).map((dr) => (
                <Pill
                  key={dr.id}
                  label={dr.name}
                  selected={form.driverId === dr.id}
                  onPress={() => setForm({ ...form, driverId: dr.id })}
                />
              ))}
            </View>
          </>
        )}

        <MutedText>{t('compliance.attachmentLabel')}</MutedText>
        {form.sourceDocumentId ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
            <MutedText>{form.attachmentFilename ? t('compliance.attachmentAttached', { filename: form.attachmentFilename }) : t('compliance.attachmentOnFile')}</MutedText>
            <Pressable onPress={() => setForm({ ...form, sourceDocumentId: null, attachmentFilename: null })} hitSlop={8} style={{ marginStart: spacing.sm }}>
              <Text style={{ color: colors.red, fontSize: typography.size.xs, fontWeight: '700' }}>{t('compliance.removeAttachment')}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <SecondaryButton title={t('compliance.attachPhoto')} onPress={() => handleAttachPhoto(form, setForm)} loading={attaching} />
            <SecondaryButton title={t('compliance.attachPdf')} onPress={() => handleAttachPdf(form, setForm)} loading={attaching} />
          </View>
        )}
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
              const { daysUntil, urgency } = calcComplianceStatus(item.due_date, new Date(todayIso), item.reminder_lead_days);
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
        <SheetTitle>{t('compliance.addTitle')}</SheetTitle>
        {renderForm(addForm, setAddForm)}
        <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSaveAdd} loading={saving} />
        <SecondaryButton title={t('common.cancel')} onPress={() => setAdding(false)} />
      </ModalSheet>

      <ModalSheet visible={!!editing} onClose={() => setEditing(null)}>
        <SheetTitle>{t('compliance.editTitle')}</SheetTitle>
        {renderForm(editForm, setEditForm)}
        <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSaveEdit} loading={saving} />
        {editing && (
          <Pressable onPress={() => handleDelete(editing)} hitSlop={8} style={{ marginTop: spacing.sm, alignItems: 'center' }}>
            <Text style={{ color: colors.red, fontSize: typography.size.sm, fontWeight: '700' }}>{t('compliance.delete')}</Text>
          </Pressable>
        )}
        <SecondaryButton title={t('common.cancel')} onPress={() => setEditing(null)} />
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
