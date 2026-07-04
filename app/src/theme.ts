// Ported verbatim from the :root CSS variables in legacy/index.html.
// legacy/index.html:10 —
// --bg:#0f1117;--side:#161b27;--card:#1c2233;--card2:#212840;--bor:#2a3150;
// --txt:#e8eaf6;--mut:#7b85a3;--acc:#4f7cff;--grn:#22c55e;--red:#ef4444;
// --org:#f59e0b;--pur:#a855f7;
//
// This app is dark-theme-only (no light mode) — matches the legacy web app.
export const colors = {
  bg: '#0f1117',
  side: '#161b27',
  card: '#1c2233',
  card2: '#212840',
  border: '#2a3150',
  text: '#e8eaf6',
  muted: '#7b85a3',
  accent: '#4f7cff',
  green: '#22c55e',
  red: '#ef4444',
  orange: '#f59e0b',
  purple: '#a855f7',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const radii = {
  sm: 7,
  md: 10,
  lg: 12,
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
