// Session 9e-B10 ("BOZKA AI" design language, owner decision 2026-07-10):
// deeper blacks + a blue-600 (#2563eb family) accent, superseding the
// legacy-CSS-variable palette this file originally ported verbatim from
// legacy/index.html:10 (--bg:#0f1117;--side:#161b27;--card:#1c2233;
// --card2:#212840;--bor:#2a3150;--txt:#e8eaf6;--mut:#7b85a3;--acc:#4f7cff;
// --grn:#22c55e;--red:#ef4444;--org:#f59e0b;--pur:#a855f7). The 4 semantic
// signal colors (green/red/orange/purple) are UNCHANGED — this pass only
// deepens the neutrals and swaps the accent; see CLAUDE.md's color-source
// invariant for the full history.
//
// This app is dark-theme-only (no light mode) — matches the legacy web app.
export const colors = {
  bg: '#08080c',
  side: '#101015',
  card: '#16161d',
  card2: '#1c1c26',
  border: '#26262f',
  text: '#f0f0f5',
  muted: '#8a8a99',
  accent: '#2563eb',
  green: '#22c55e',
  red: '#ef4444',
  orange: '#f59e0b',
  purple: '#a855f7',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 18,
  xl: 28,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
} as const;

export const typography = {
  size: {
    xs: 11,
    sm: 12,
    md: 13,
    lg: 16,
    xl: 20,
  },
} as const;

// ESTIMATE NOTICE (owner decision 2026-10-30, batch D item 10). The app is
// dark-only today, but the "ESTIMATES ONLY - NOT TAX ADVICE" banner carries
// its own light AND dark tokens so it stays readable if the OS (or a future
// light theme) asks for light. Every text/background pair is >= 4.5:1
// (src/legal/__tests__/estimateNotice.test.ts checks the WCAG ratio).
export const estimateBannerTokens = {
  dark: { bg: '#2b1d00', border: '#f59e0b', headline: '#ffd27a', body: '#fff3d6', icon: '#f59e0b' },
  light: { bg: '#fff4d6', border: '#b45309', headline: '#7a2e00', body: '#3a2300', icon: '#b45309' },
} as const;
