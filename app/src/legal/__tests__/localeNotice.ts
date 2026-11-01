import { BRAND_NAME } from '@/src/brand';
import { estimateNoticeStrings, type EstimateNoticeStrings } from '@/src/legal/estimateNotice';
import en from '@/src/i18n/locales/en.json';

// Test helper: a plain i18n-style translator over a locale JSON, and the
// real estimate-notice strings built from it.
export function translator(locale: Record<string, unknown>) {
  const get = (key: string) => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], locale);
  return (key: string, o: Record<string, unknown> = {}) => {
    const plural = typeof o.count === 'number' ? get(`${key}_${o.count === 1 ? 'one' : 'other'}`) : undefined;
    const raw = (plural ?? get(key) ?? key) as string;
    return raw.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(o[k]));
  };
}

export function localeNotice(locale: Record<string, unknown> = en, note?: string | null): EstimateNoticeStrings {
  return estimateNoticeStrings(translator(locale), BRAND_NAME, note);
}
