import { colors } from '@/src/theme';

// ACCOUNTANT PACKAGE — FULL VISUAL PARITY WITH WEB (owner decision,
// v2026.08.05-W chase). ONE shared source of truth for every colour used
// across the three surfaces this report renders on (on-screen, PDF,
// Excel) — the same meaning always gets the same colour family, so a
// screenshot and an exported file can never visually disagree.
//
// EXPORT (PDF/Excel) — light, print-friendly hex values. Both exports
// share the exact same generated HTML (accountantPackageReport.ts), so
// these values apply identically to both — a `.pdf` and a `.xls` of the
// same report are pixel-identical in colour.
export const ACCOUNTANT_EXPORT_COLORS = {
  ownerPaidBg: '#fef3c7',
  totalRowBg: '#fee2e2',
  grossIncomeBg: '#dcfce7',
  contributionsInBg: '#f0fdf4',
  drawsOutBg: '#fef2f2',
  capitalAssetsBg: '#eff6ff',
  capitalAssetsHeaderBg: '#dbeafe',
  lumperHeaderBg: '#fef3c7',
  subtotalRowBg: '#f1f5f9',
} as const;

// ON-SCREEN (dark theme, CLAUDE.md's own dark-theme-only design language)
// — translucent overlays of the SAME hue family as the export colours
// above (theme.ts's colors.orange/red/green/accent), never the light
// export hex values directly, which would be unreadable against this
// app's near-black background. Same meanings, same relative emphasis
// (a "total" row is always the strongest tint, a secondary "in"/"out"
// flow always the lightest) — just re-expressed for a dark background
// instead of white paper.
export const ACCOUNTANT_SCREEN_COLORS = {
  ownerPaidBg: 'rgba(245, 158, 11, 0.16)', // colors.orange
  totalRowBg: 'rgba(239, 68, 68, 0.16)', // colors.red
  grossIncomeBg: 'rgba(34, 197, 94, 0.16)', // colors.green
  contributionsInBg: 'rgba(34, 197, 94, 0.10)', // colors.green, lighter
  drawsOutBg: 'rgba(239, 68, 68, 0.10)', // colors.red, lighter
  capitalAssetsBg: 'rgba(37, 99, 235, 0.10)', // colors.accent
  capitalAssetsHeaderBg: 'rgba(37, 99, 235, 0.18)', // colors.accent, stronger
  lumperHeaderBg: 'rgba(245, 158, 11, 0.16)', // colors.orange
  // Grey subtotal rows: this app's dark theme already has a natural
  // secondary-surface tone (colors.card2, used everywhere else a subtly
  // raised/differentiated panel is needed) — reused here rather than
  // inventing a new grey specifically for this screen.
  subtotalRowBg: colors.card2,
} as const;

export type AccountantColorKey = keyof typeof ACCOUNTANT_EXPORT_COLORS;
