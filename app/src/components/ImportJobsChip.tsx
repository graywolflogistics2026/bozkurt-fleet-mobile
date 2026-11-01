import { useEffect, useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useImportJobs, fetchImportJobResult, resumeImportJob, answerImportJob, IMPORT_JOBS_QUERY_KEY } from '@/src/data/importJobs';
import { deriveChipSummary, isReadyToReview, runOptionalSideEffect, shouldAutoResume, silentAttachmentStep } from '@/src/import/importJobs';
import { supabase } from '@/src/lib/supabase';
import { notifyImportJobDone, hasNotifiedJob } from '@/src/notifications/importJobNotifications';
import { useFormatters } from '@/src/i18n/format';
import { colors, radii, spacing, typography } from '@/src/theme';

const JOBS_ROUTE = '/(tabs)/import/jobs' as Href;

// Jobs this app session already restarted, keyed by job id -> the
// heartbeat it saw then, so one interruption is resumed once, not on
// every poll.
const autoResumed = new Map<string, string>();
// Jobs this session already handled silently (batch D2): page-cap
// questions answered, post-save attachment jobs stored or dropped.
const handledSilently = new Set<string>();

// BACKGROUND IMPORT (owner decision 2026-08-24, items 1 + 3) — a small,
// persistent status pill, always mounted from the tab layout (both the
// phone and wide-screen branches — see app/(tabs)/_layout.tsx), so it's
// visible from anywhere in the app while a background import job is
// running, and is the one place that reliably sees every poll tick to
// trigger the "ready to review" local notification (notifyImportJobDone()
// has its own permanent per-job dedupe, so this is safe to re-evaluate on
// every render — it only actually fires once per job id).
export function ImportJobsChip() {
  const { t } = useTranslation();
  const router = useRouter();
  const { money } = useFormatters();
  const queryClient = useQueryClient();
  const { data: allJobs } = useImportJobs();
  // Post-save attachment jobs are handled silently below — never shown.
  const jobs = useMemo(() => (allJobs ?? []).filter((j) => silentAttachmentStep(j) == null), [allJobs]);
  const summary = deriveChipSummary(jobs);

  // SIMPLE IMPORT FLOW (batch D2 2.1/2.4): nothing waits on the owner.
  // A page-cap question is answered "read the first pages"; a week's
  // attachment readings are stored on its document (no re-save, so the
  // certification stays) and a failed attachment run is dropped quietly.
  useEffect(() => {
    for (const job of allJobs ?? []) {
      if (handledSilently.has(job.id)) continue;
      if (job.status === 'needs_decision') {
        handledSilently.add(job.id);
        answerImportJob(job.id, 'read_first').catch(() => handledSilently.delete(job.id));
        continue;
      }
      const step = silentAttachmentStep(job);
      if (step !== 'store' && step !== 'drop') continue;
      handledSilently.add(job.id);
      (async () => {
        if (step === 'store') {
          const result = await fetchImportJobResult(job.id);
          if (result) {
            const { error } = await supabase.from('documents').update({ parsed_json: result }).eq('id', job.documentId!);
            if (error) throw error;
          }
        }
        await supabase.from('import_jobs').delete().eq('id', job.id);
        await queryClient.invalidateQueries({ queryKey: IMPORT_JOBS_QUERY_KEY, refetchType: 'all' });
        await queryClient.invalidateQueries({ queryKey: ['documents'] });
      })().catch(() => handledSilently.delete(job.id));
    }
  }, [allJobs, queryClient]);

  // BACKGROUND IMPORT CRASH FIX (owner decision 2026-08-24, hard rule): a
  // job's completion (the chip/list reflecting 'ready'/'failed') is driven
  // entirely by useImportJobs()'s own polling of the `import_jobs` row —
  // this effect's ONLY job is the OPTIONAL local-notification convenience
  // on top of that, so every notification call is routed through
  // runOptionalSideEffect() (src/import/importJobs.ts), which can never
  // throw regardless of whether the notification API is available in this
  // build. This effect itself also never crashes the caller — its own
  // try/catch is a second layer on top of runOptionalSideEffect's, since
  // `hasNotifiedJob`/`fetchImportJobResult` are called directly, not
  // through the wrapper. `cancelled` guards every async gap (same pattern
  // as every other cleanup-aware effect in this app) so a fast series of
  // poll ticks — or this component unmounting mid-loop — never acts on a
  // stale iteration; note this effect reads only `jobs` (this render's own
  // fresh query data) and module-level functions, never anything captured
  // from whatever screen originally started the job, so "the screen that
  // started the job is gone" has no effect on this logic at all.
  // RESUMABLE IMPORT JOBS (owner decision 2026-10-13): the backup restart.
  // Each run of a job starts the next one itself; if that never happens
  // (the worker was stopped, the request was lost), a job whose heartbeat
  // is 3 minutes old is resumed from its first unfinished page. The
  // server's lease makes this safe even if the job is in fact still
  // running — the second run simply does nothing.
  useEffect(() => {
    const now = new Date().toISOString();
    for (const job of jobs ?? []) {
      if (!shouldAutoResume(job, now)) continue;
      const seen = job.heartbeatAt ?? job.updatedAt;
      if (autoResumed.get(job.id) === seen) continue;
      autoResumed.set(job.id, seen);
      resumeImportJob(job.id, false).catch(() => {
        // The row keeps saying "Interrupted at page N" with a Resume button.
      });
    }
  }, [jobs]);

  useEffect(() => {
    let cancelled = false;
    async function checkAndNotify() {
      for (const job of jobs ?? []) {
        if (!isReadyToReview(job) && job.status !== 'failed') continue;
        const notifyId = job.id;
        const alreadyNotified = await hasNotifiedJob(notifyId).catch(() => false);
        if (alreadyNotified) continue;
        if (cancelled) return;
        if (isReadyToReview(job)) {
          const result = await fetchImportJobResult(job.id).catch(() => null);
          const s = result?.settlement;
          const body =
            s?.weekEnding && s?.grossRevenue
              ? t('importJobs.notification.readyBodyWithDetail', { weekEnding: s.weekEnding, amount: money(s.grossRevenue) })
              : t('importJobs.notification.readyBody');
          if (cancelled) return;
          await runOptionalSideEffect(() =>
            notifyImportJobDone(notifyId, {
              title: t('importJobs.notification.readyTitle'),
              body,
            })
          );
        } else {
          await runOptionalSideEffect(() =>
            notifyImportJobDone(notifyId, {
              title: t('importJobs.notification.failedTitle'),
              body: job.fileName ?? t('importJobs.notification.failedBody'),
            })
          );
        }
      }
    }
    checkAndNotify().catch(() => {
      // Belt-and-suspenders: even an unexpected failure in the loop itself
      // (not just the notification calls) must never surface as an
      // unhandled rejection — the chip's own render below already reflects
      // job status correctly regardless of whether this effect ever runs.
    });
    return () => {
      cancelled = true;
    };
  }, [jobs, t, money]);

  if (summary.kind === 'hidden') return null;

  const { icon, label, tint } = (() => {
    // Batch D2 2.1: one reading line — no page, step, pause or
    // interruption wording (a question is answered automatically).
    if (summary.kind === 'question' || summary.kind === 'processing') {
      return { icon: '⏳', label: t('importFlow.readingShort'), tint: colors.accent };
    }
    if (summary.kind === 'ready') {
      return {
        icon: '✅',
        label: summary.readyCount > 1 ? t('importJobs.chip.readyMultiple', { count: summary.readyCount }) : t('importJobs.chip.ready'),
        tint: colors.green,
      };
    }
    return {
      icon: '⚠️',
      label: t('importFlow.chipCouldNotRead'),
      tint: colors.red,
    };
  })();

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: spacing.md, alignItems: 'center' }}>
      <Pressable
        onPress={() => router.push(JOBS_ROUTE)}
        style={({ pressed }) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.card2,
            borderWidth: 1,
            borderColor: tint,
            borderRadius: radii.lg,
            paddingVertical: spacing.xs,
            paddingHorizontal: spacing.md,
            maxWidth: '92%',
          },
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text style={{ fontSize: 16, marginEnd: spacing.xs }}>{icon}</Text>
        <Text style={{ color: colors.text, fontWeight: '600', fontSize: typography.size.sm }} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    </View>
  );
}
