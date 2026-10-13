import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useImportJobs, fetchImportJobResult, resumeImportJob } from '@/src/data/importJobs';
import { deriveChipSummary, jobProgressView, runOptionalSideEffect, shouldAutoResume } from '@/src/import/importJobs';
import { jobProgressText } from '@/src/components/importJobText';
import { notifyImportJobDone, hasNotifiedJob } from '@/src/notifications/importJobNotifications';
import { useFormatters } from '@/src/i18n/format';
import { colors, radii, spacing, typography } from '@/src/theme';

const JOBS_ROUTE = '/(tabs)/import/jobs' as Href;

// Jobs this app session already restarted, keyed by job id -> the
// heartbeat it saw then, so one interruption is resumed once, not on
// every poll.
const autoResumed = new Map<string, string>();

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
  const { data: jobs } = useImportJobs();
  const summary = deriveChipSummary(jobs ?? []);

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
        if (job.status !== 'ready' && job.status !== 'failed') continue;
        // A week saved while its attachments were still being read gets a
        // second "ready" (the attachments, for review) — its own id.
        const notifyId = job.documentId ? `${job.id}:attachments` : job.id;
        const alreadyNotified = await hasNotifiedJob(notifyId).catch(() => false);
        if (alreadyNotified) continue;
        if (cancelled) return;
        if (job.status === 'ready') {
          const result = await fetchImportJobResult(job.id).catch(() => null);
          const s = result?.settlement;
          const body =
            s?.weekEnding && s?.grossRevenue
              ? t('importJobs.notification.readyBodyWithDetail', { weekEnding: s.weekEnding, amount: money(s.grossRevenue) })
              : t('importJobs.notification.readyBody');
          if (cancelled) return;
          await runOptionalSideEffect(() =>
            notifyImportJobDone(notifyId, {
              title: t(job.documentId ? 'importJobs.notification.attachmentsReadyTitle' : 'importJobs.notification.readyTitle'),
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
    if (summary.kind === 'question') {
      return { icon: '❓', label: jobProgressText(jobProgressView(summary.job, new Date().toISOString()), t), tint: colors.orange };
    }
    if (summary.kind === 'processing') {
      // The same words as the jobs list ("Reading settlement page 3 of 6 ·
      // 12 attachments queued · 1:42", "Interrupted at page 3").
      const view = jobProgressView(summary.job, new Date().toISOString());
      const progressLabel = summary.job.progress || view.state === 'interrupted' ? jobProgressText(view, t) : t('importJobs.chip.processing');
      return { icon: view.state === 'interrupted' ? '⚠️' : '⏳', label: progressLabel, tint: view.state === 'interrupted' ? colors.orange : colors.accent };
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
      label: summary.failedCount > 1 ? t('importJobs.chip.failedMultiple', { count: summary.failedCount }) : t('importJobs.chip.failed'),
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
