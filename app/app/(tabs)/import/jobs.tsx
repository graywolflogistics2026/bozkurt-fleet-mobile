import { useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter, useFocusEffect, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useImportJobs, useRetryImportJob, useDismissImportJob, IMPORT_JOBS_QUERY_KEY } from '@/src/data/importJobs';
import { sortImportJobsForDisplay, jobProgressFraction, type ImportJob } from '@/src/import/importJobs';
import { useFormatters } from '@/src/i18n/format';
import { Screen, Card, MutedText, SecondaryButton, PrimaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';

// BACKGROUND IMPORT (owner decision 2026-08-24, item 4 "multiple imports
// queue up... show them as a small list with per-item status and retry")
// — reads the SAME useImportJobs() polling hook the persistent chip does
// (react-query dedupes by query key, so mounting both never doubles the
// real network polling).
function statusColor(status: ImportJob['status']): string {
  if (status === 'ready') return colors.green;
  if (status === 'failed') return colors.red;
  return colors.accent;
}

function JobRow({
  job,
  onReview,
  onRetry,
  onDismiss,
  retrying,
}: {
  job: ImportJob;
  onReview: (job: ImportJob) => void;
  onRetry: (job: ImportJob) => void;
  onDismiss: (job: ImportJob) => void;
  retrying: boolean;
}) {
  const { t } = useTranslation();
  const fraction = jobProgressFraction(job);

  return (
    <Card style={{ marginBottom: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
        <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>
          {job.fileName ?? t('importJobs.untitledFile')}
        </Text>
        <Text style={{ color: statusColor(job.status), fontWeight: '700', fontSize: typography.size.xs }}>
          {t(`importJobs.status.${job.status}`)}
        </Text>
      </View>

      {(job.status === 'queued' || job.status === 'processing') && (
        <View style={{ marginBottom: spacing.xs }}>
          {fraction != null ? (
            <>
              <View style={{ height: 6, borderRadius: radii.sm, backgroundColor: colors.card2, overflow: 'hidden' }}>
                <View style={{ height: '100%', width: `${Math.round(fraction * 100)}%`, backgroundColor: colors.accent }} />
              </View>
              <MutedText style={{ marginTop: 2 }}>{t('importJobs.pageProgress', { through: job.pagesDone, total: job.pagesTotal })}</MutedText>
            </>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <ActivityIndicator size="small" color={colors.accent} style={{ marginEnd: spacing.xs }} />
              <MutedText>{t('importJobs.starting')}</MutedText>
            </View>
          )}
        </View>
      )}

      {job.status === 'failed' && (
        <MutedText style={{ color: colors.red, marginBottom: spacing.xs }} numberOfLines={2}>
          {job.errorMessage ?? t('importJobs.genericFailure')}
        </MutedText>
      )}

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {job.status === 'ready' && <PrimaryButton title={t('importJobs.reviewNow')} onPress={() => onReview(job)} />}
        {job.status === 'failed' && (
          <PrimaryButton title={t('importScreen.retryImport')} onPress={() => onRetry(job)} loading={retrying} />
        )}
        {(job.status === 'ready' || job.status === 'failed') && (
          <SecondaryButton title={t('common.dismiss')} onPress={() => onDismiss(job)} />
        )}
      </View>
    </Card>
  );
}

export default function ImportJobsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const jobsQuery = useImportJobs();
  const retryJob = useRetryImportJob();
  const dismissJob = useDismissImportJob();
  const [refreshing, setRefreshing] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  useFocusEffect(() => {
    // A cheap, deliberate extra refetch on focus (on top of the hook's
    // own polling) — landing on this screen from a "ready"/"failed" chip
    // tap should show up-to-the-second state immediately, not wait for
    // the next poll tick.
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

  async function handleRetry(job: ImportJob) {
    setRetryingId(job.id);
    try {
      await retryJob.mutateAsync({ jobId: job.id });
    } catch (err) {
      Alert.alert(t('importJobs.retryFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setRetryingId(null);
    }
  }

  function handleDismiss(job: ImportJob) {
    Alert.alert(t('importJobs.dismissConfirmTitle'), t('importJobs.dismissConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.dismiss'), style: 'destructive', onPress: () => dismissJob.mutate(job.id) },
    ]);
  }

  const jobs = sortImportJobsForDisplay(jobsQuery.data ?? []);

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
          jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              onReview={handleReview}
              onRetry={handleRetry}
              onDismiss={handleDismiss}
              retrying={retryingId === job.id}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
