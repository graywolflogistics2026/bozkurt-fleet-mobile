import { useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter, useFocusEffect, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useImportJobs, useDismissImportJob, IMPORT_JOBS_QUERY_KEY } from '@/src/data/importJobs';
import { silentAttachmentStep, simpleJobState, sortImportJobsForDisplay, type ImportJob } from '@/src/import/importJobs';
import { Screen, Card, MutedText, SecondaryButton, PrimaryButton } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';

// BACKGROUND IMPORT (owner decision 2026-08-24, item 4): one row per
// imported file, from the SAME useImportJobs() polling hook the persistent
// chip uses (react-query dedupes by query key).
//
// SIMPLE IMPORT FLOW (owner decision 2026-10-31, batch D2 2.1): every row
// is in one of three states — Reading (one line; pauses, interruptions,
// page-cap questions and retries continue automatically and are never
// shown), Ready to check [Check and certify], or Could not read [Upload
// again]. No "Review All" and no batch save. Post-save attachment jobs are
// handled silently by ImportJobsChip and never listed.

function JobRow({ job, onReview, onDismiss }: { job: ImportJob; onReview: (job: ImportJob) => void; onDismiss: (job: ImportJob) => void }) {
  const { t } = useTranslation();
  const state = simpleJobState(job);
  const [label, color] =
    state === 'ready' ? [t('importFlow.statusReady'), colors.green] : state === 'failed' ? [t('importFlow.statusFailed'), colors.red] : [t('importFlow.statusReading'), colors.accent];

  return (
    <Card style={{ marginBottom: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
        <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>
          {job.fileName ?? t('importJobs.untitledFile')}
        </Text>
        <Text style={{ color, fontWeight: '700', fontSize: typography.size.xs }}>{label}</Text>
      </View>

      {state === 'reading' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
          <ActivityIndicator size="small" color={colors.accent} style={{ marginEnd: spacing.xs }} />
          <MutedText style={{ flex: 1 }}>{t('importFlow.reading')}</MutedText>
        </View>
      )}

      {state === 'failed' && <MutedText style={{ marginBottom: spacing.xs }}>{t('importFlow.couldNotReadTitle')}</MutedText>}

      <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
        {state === 'ready' && <PrimaryButton title={t('importFlow.checkAndCertify')} onPress={() => onReview(job)} />}
        {state === 'failed' && <PrimaryButton title={t('importFlow.uploadAgain')} onPress={() => onDismiss(job)} />}
        {state !== 'reading' && <SecondaryButton title={t('common.dismiss')} onPress={() => onDismiss(job)} />}
      </View>
    </Card>
  );
}

export default function ImportJobsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const jobsQuery = useImportJobs();
  const dismissJob = useDismissImportJob();
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(() => {
    // Re-check immediately on focus rather than waiting for the next
    // polling tick.
    queryClient.invalidateQueries({ queryKey: IMPORT_JOBS_QUERY_KEY });
  });

  async function onRefresh() {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: IMPORT_JOBS_QUERY_KEY, refetchType: 'all' });
    } finally {
      setRefreshing(false);
    }
  }

  function handleReview(job: ImportJob) {
    router.push({ pathname: '/(tabs)/import', params: { reviewJobId: job.id } } as unknown as Href);
  }

  // Nothing of a job is saved until "Certify and add", so dismissing (or
  // "Upload again" on a failed one) only removes the reading.
  function handleDismiss(job: ImportJob) {
    if (job.status === 'failed') {
      dismissJob.mutate(job.id);
      router.push('/(tabs)/import' as Href);
      return;
    }
    Alert.alert(t('importJobs.dismissConfirmTitle'), t('importJobs.dismissConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.dismiss'), style: 'destructive', onPress: () => dismissJob.mutate(job.id) },
    ]);
  }

  const jobs = sortImportJobsForDisplay((jobsQuery.data ?? []).filter((j) => silentAttachmentStep(j) == null));

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        {jobsQuery.isLoading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : jobs.length === 0 ? (
          <Card>
            <MutedText>{t('importJobs.empty')}</MutedText>
          </Card>
        ) : (
          jobs.map((job) => <JobRow key={job.id} job={job} onReview={handleReview} onDismiss={handleDismiss} />)
        )}
      </ScrollView>
    </Screen>
  );
}
