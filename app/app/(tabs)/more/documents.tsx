import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter, useLocalSearchParams, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '@/src/data/documents';
import { useSettlements } from '@/src/data/settlements';
import { useDeductions } from '@/src/data/deductions';
import { useMaintenanceRecords } from '@/src/data/maintenanceRecords';
import { useBankStatements } from '@/src/data/bankStatements';
import { useComplianceItems } from '@/src/data/complianceItems';
import { useHouseholdIncome } from '@/src/data/householdIncome';
import {
  filterDocuments,
  distinctDocTypes,
  findLinkedRecords,
  isImageFilename,
  type LinkedRecordRef,
} from '@/src/data/documentsFilter';
import { getSignedDocumentUrl, shareDocumentFile } from '@/src/data/documentViewer';
import { deriveDocumentTitle } from '@/src/data/documentTitle';
import { findRowToAutoOpen } from '@/src/navigation/autoOpenParam';
import { DOC_TYPE_ICON, useDocTypeMeta } from '@/src/import/docTypes';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, TappableCard, ModalSheet, SheetTitle, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';
import type { DocType } from '@/src/import/types';
import type { DocumentRow } from '@/src/types/db';

// Where "View linked records" (item 2) jumps to — mirrors the routes in
// app/(tabs)/more/index.tsx. Only settlement/deduction/maintenance support
// jumping straight to the matching row (openId param, wired into those 3
// screens); the rest land on the right list screen, same "at least get you
// to where it lives" bar as the others.
const LINKED_RECORD_ROUTE: Record<LinkedRecordRef['kind'], string> = {
  settlement: '/(tabs)/more/settlements',
  deduction: '/(tabs)/deductions',
  maintenance: '/(tabs)/more/maintenance',
  bank_statement: '/(tabs)/more/bank-statements',
  compliance_item: '/(tabs)/more/compliance',
  household_income: '/(tabs)/more/tax-estimator',
};

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

export default function DocumentsArchive() {
  const { t } = useTranslation();
  const { money, date } = useFormatters();
  const router = useRouter();
  const { openId } = useLocalSearchParams<{ openId?: string }>();
  const autoOpenedRef = useRef(false);
  const docTypeMeta = useDocTypeMeta();

  const documentsQuery = useDocuments();
  const settlementsQuery = useSettlements();
  const deductionsQuery = useDeductions();
  const maintenanceQuery = useMaintenanceRecords();
  const bankStatementsQuery = useBankStatements();
  const complianceItemsQuery = useComplianceItems();
  const householdIncomeQuery = useHouseholdIncome();

  const [search, setSearch] = useState('');
  const [docTypeFilter, setDocTypeFilter] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selected, setSelected] = useState<DocumentRow | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const allDocs = documentsQuery.data ?? [];
  const types = useMemo(() => distinctDocTypes(allDocs), [allDocs]);
  const rows = useMemo(
    () =>
      filterDocuments(allDocs, {
        search,
        docType: docTypeFilter,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
      }),
    [allDocs, search, docTypeFilter, dateFrom, dateTo]
  );

  // "View original document" from a settlement/deduction/maintenance detail
  // (owner decision 2026-07-30) jumps here with ?openId=<documentId> —
  // auto-opens that document's viewer exactly once.
  useEffect(() => {
    const match = findRowToAutoOpen(allDocs, openId, autoOpenedRef.current);
    if (match) {
      autoOpenedRef.current = true;
      setSelected(match);
    }
  }, [allDocs, openId]);

  const linkedRecords = useMemo(() => {
    if (!selected) return [];
    return findLinkedRecords(selected.id, {
      settlements: settlementsQuery.data,
      deductions: deductionsQuery.data,
      maintenanceRecords: maintenanceQuery.data,
      bankStatements: bankStatementsQuery.data,
      complianceItems: complianceItemsQuery.data,
      householdIncome: householdIncomeQuery.data,
    });
  }, [
    selected,
    settlementsQuery.data,
    deductionsQuery.data,
    maintenanceQuery.data,
    bankStatementsQuery.data,
    complianceItemsQuery.data,
    householdIncomeQuery.data,
  ]);

  useEffect(() => {
    if (!selected?.storage_path) {
      setSignedUrl(null);
      return;
    }
    let cancelled = false;
    setUrlLoading(true);
    setUrlError(null);
    getSignedDocumentUrl(selected.storage_path)
      .then((url) => {
        if (!cancelled) setSignedUrl(url);
      })
      .catch((err) => {
        if (!cancelled) setUrlError(err instanceof Error ? err.message : t('documentsArchive.viewFailed'));
      })
      .finally(() => {
        if (!cancelled) setUrlLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, t]);

  function closeViewer() {
    setSelected(null);
    setSignedUrl(null);
    setUrlError(null);
  }

  async function handleOpen() {
    if (!signedUrl) return;
    try {
      await WebBrowser.openBrowserAsync(signedUrl);
    } catch (err) {
      Alert.alert(t('documentsArchive.viewFailed'), err instanceof Error ? err.message : t('common.tryAgain'));
    }
  }

  async function handleShare() {
    if (!selected?.storage_path) return;
    setSharing(true);
    try {
      await shareDocumentFile(selected.storage_path, selected.filename ?? 'document');
    } catch (err) {
      Alert.alert(t('documentsArchive.shareFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSharing(false);
    }
  }

  function handleOpenLinkedRecord(ref: LinkedRecordRef) {
    const pathname = LINKED_RECORD_ROUTE[ref.kind];
    closeViewer();
    if (ref.kind === 'settlement' || ref.kind === 'deduction' || ref.kind === 'maintenance') {
      router.push({ pathname, params: { openId: ref.id } } as unknown as Href);
    } else {
      router.push(pathname as Href);
    }
  }

  const image = selected?.storage_path && isImageFilename(selected.filename);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScreenTitle>{t('documentsArchive.title')}</ScreenTitle>
        <MutedText style={{ marginBottom: spacing.sm }}>{t('documentsArchive.subtitle')}</MutedText>

        <Field
          value={search}
          onChangeText={setSearch}
          placeholder={t('documentsArchive.searchPlaceholder')}
        />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm }}>
          <Pill label={t('documentsArchive.allTypes')} selected={!docTypeFilter} onPress={() => setDocTypeFilter(null)} />
          {types.map((type) => (
            <Pill
              key={type}
              label={docTypeMeta(type as DocType).label}
              selected={docTypeFilter === type}
              onPress={() => setDocTypeFilter(type)}
            />
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <MutedText>{t('documentsArchive.dateFromLabel')}</MutedText>
            <Field value={dateFrom} onChangeText={setDateFrom} placeholder="YYYY-MM-DD" />
          </View>
          <View style={{ flex: 1 }}>
            <MutedText>{t('documentsArchive.dateToLabel')}</MutedText>
            <Field value={dateTo} onChangeText={setDateTo} placeholder="YYYY-MM-DD" />
          </View>
        </View>

        {documentsQuery.isLoading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <MutedText>{allDocs.length === 0 ? t('documentsArchive.emptyState') : t('documentsArchive.noMatches')}</MutedText>
          </Card>
        ) : (
          rows.map((doc) => {
            const meta = docTypeMeta((doc.doc_type as DocType) ?? 'other');
            const title = deriveDocumentTitle(doc.parsed_json, meta.label);
            return (
              <TappableCard key={doc.id} onPress={() => setSelected(doc)}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ fontSize: 24, marginEnd: spacing.sm }}>{DOC_TYPE_ICON[(doc.doc_type as DocType) ?? 'other'] ?? '📄'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '600' }}>{title}</Text>
                    <MutedText>
                      {title !== meta.label ? `${meta.label} · ` : ''}
                      {doc.doc_date ? date(doc.doc_date) : date(doc.imported_at)}
                      {doc.filename ? ` · ${doc.filename}` : ''}
                    </MutedText>
                  </View>
                  {doc.amount != null && <Text style={{ color: colors.text, fontWeight: '700' }}>{money(doc.amount)}</Text>}
                </View>
              </TappableCard>
            );
          })
        )}
      </ScrollView>

      <ModalSheet visible={!!selected} onClose={closeViewer}>
        {selected && (() => {
          const selectedMeta = docTypeMeta((selected.doc_type as DocType) ?? 'other');
          const selectedTitle = deriveDocumentTitle(selected.parsed_json, selectedMeta.label);
          return (
            <>
              <SheetTitle>{selectedTitle}</SheetTitle>
              {selectedTitle !== selectedMeta.label && <MutedText>{selectedMeta.label}</MutedText>}
              <MutedText>{selected.doc_date ? date(selected.doc_date) : date(selected.imported_at)}</MutedText>
              {selected.filename && <MutedText>{selected.filename}</MutedText>}
              {selected.amount != null && (
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: typography.size.lg, marginTop: spacing.xs }}>
                  {money(selected.amount)}
                </Text>
              )}

              {!selected.storage_path ? (
                <MutedText style={{ marginTop: spacing.md }}>{t('documentsArchive.noFile')}</MutedText>
              ) : urlLoading ? (
                <MutedText style={{ marginTop: spacing.md }}>{t('common.loading')}</MutedText>
              ) : urlError ? (
                <MutedText style={{ marginTop: spacing.md, color: colors.red }}>{urlError}</MutedText>
              ) : (
                signedUrl && (
                  <View style={{ marginTop: spacing.md }}>
                    {image ? (
                      <Image
                        source={{ uri: signedUrl }}
                        style={{ width: '100%', height: 320, borderRadius: radii.sm, backgroundColor: colors.card2 }}
                        resizeMode="contain"
                      />
                    ) : (
                      <PrimaryButton title={t('documentsArchive.openDocument')} onPress={handleOpen} />
                    )}
                    <SecondaryButton title={t('documentsArchive.shareDownload')} onPress={handleShare} />
                  </View>
                )
              )}

              {linkedRecords.length > 0 && (
                <View style={{ marginTop: spacing.md }}>
                  <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>
                    {t('documentsArchive.linkedRecords')}
                  </Text>
                  {linkedRecords.map((ref) => (
                    <Pressable
                      key={`${ref.kind}-${ref.id}`}
                      onPress={() => handleOpenLinkedRecord(ref)}
                      style={{
                        paddingVertical: spacing.xs,
                        borderTopWidth: 1,
                        borderTopColor: colors.border,
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                      }}
                    >
                      <Text style={{ color: colors.text }}>{ref.label}</Text>
                      <Text style={{ color: colors.accent, fontWeight: '700' }}>›</Text>
                    </Pressable>
                  ))}
                </View>
              )}

              {sharing && <MutedText style={{ marginTop: spacing.sm }}>{t('documentsArchive.preparingShare')}</MutedText>}

              <SecondaryButton title={t('common.cancel')} onPress={closeViewer} />
            </>
          );
        })()}
      </ModalSheet>
    </Screen>
  );
}
