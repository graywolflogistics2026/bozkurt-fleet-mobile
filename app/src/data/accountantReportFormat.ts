import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReportFormat } from '@/src/stats/accountantPackageReport';

// SHORT VS DETAILED EXPORT (owner decision, web-parity pass, spec item 1
// "remember the last choice") — same AsyncStorage-cache pattern
// src/i18n/localeStorage.ts already established for a lightweight,
// device-local UI preference (not a `profiles` column — this is a
// per-device export-tool default, not account data worth syncing).
const REPORT_FORMAT_CACHE_KEY = 'bozkurt-fleet-os-accountant-report-format';

export async function getCachedReportFormat(): Promise<ReportFormat | null> {
  const value = await AsyncStorage.getItem(REPORT_FORMAT_CACHE_KEY);
  return value === 'summary' || value === 'detailed' ? value : null;
}

export async function setCachedReportFormat(format: ReportFormat): Promise<void> {
  await AsyncStorage.setItem(REPORT_FORMAT_CACHE_KEY, format);
}
