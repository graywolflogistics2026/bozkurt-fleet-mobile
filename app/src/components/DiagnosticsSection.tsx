import { useMemo, useState } from 'react';
import { Platform, Share, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, MutedText, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';
import { getBuildInfo } from '@/src/lib/buildInfo';
import { scannerModulePresent } from '@/src/scan/scanDeps';
import { useImportJobs } from '@/src/data/importJobs';
import { callDiagnose } from '@/src/data/diagnoseCall';
import {
  buildReportSections,
  formatReportText,
  markerFor,
  type ClientInfo,
  type DiagnoseReport,
} from '@/src/lib/systemReport';

// SETTINGS > DIAGNOSTICS (statement reading plan step A, owner 2026-10-31).
// Shows this build (version, runtime, update, channel, scanner, build
// stamp); "Run check" asks the server (ai-import mode "diagnose") for its
// build, plan budget, database, storage, AI key, a live check of each AI
// model and the import job counts. "Share report" sends the same lines as
// plain text through the native share sheet — no amounts, no file names,
// no bank digits (src/lib/systemReport.ts).
export function DiagnosticsSection() {
  const { t } = useTranslation();
  const jobs = useImportJobs();
  const [server, setServer] = useState<DiagnoseReport | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const client: ClientInfo = useMemo(
    () => ({ ...getBuildInfo(), scannerPresent: scannerModulePresent(), platform: `${Platform.OS} ${String(Platform.Version)}` }),
    [],
  );
  const sections = useMemo(
    () => buildReportSections(client, server, jobs.data ?? [], (k, o) => t(k, o) as string),
    [client, server, jobs.data, t],
  );

  async function runCheck() {
    setRunning(true);
    setServerError(null);
    try {
      const res = await callDiagnose();
      if ('report' in res) setServer(res.report);
      else setServerError(res.error);
    } catch {
      setServerError('network');
    } finally {
      setRunning(false);
    }
  }

  async function shareReport() {
    let text = formatReportText(sections, t('diagnostics.reportHeader'), server?.checkedAt ?? new Date().toISOString());
    if (serverError) text += `\n\n${markerFor(false)} ${t('diagnostics.serverTitle')}: ${serverError}`;
    try {
      await Share.share({ message: text });
    } catch {
      // the owner closed the share sheet
    }
  }

  return (
    <Card>
      <MutedText>{t('diagnostics.note')}</MutedText>
      {sections.map((s) => (
        <View key={s.title} style={{ marginTop: spacing.sm }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: typography.size.sm }}>{s.title}</Text>
          {s.lines.map((l, i) => (
            <Text
              key={`${s.title}-${i}`}
              style={{
                color: l.ok === false ? colors.red : l.ok === true ? colors.green : colors.muted,
                fontSize: typography.size.xs,
                marginTop: 2,
              }}
            >
              {`${markerFor(l.ok)} ${l.label}: ${l.value}`}
            </Text>
          ))}
        </View>
      ))}
      {serverError && (
        <Text style={{ color: colors.red, fontSize: typography.size.xs, marginTop: spacing.sm }}>
          {serverError === 'server_not_updated' ? t('diagnostics.serverNotUpdated') : t('diagnostics.checkFailed', { code: serverError })}
        </Text>
      )}
      <View style={{ marginTop: spacing.sm }}>
        <PrimaryButton title={running ? t('diagnostics.running') : t('diagnostics.runCheck')} onPress={runCheck} loading={running} />
      </View>
      <SecondaryButton title={t('diagnostics.shareReport')} onPress={shareReport} />
    </Card>
  );
}
