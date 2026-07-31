// Feature flags (owner decision 2026-07-30, NAV SIMPLIFICATION) — a
// flagged-off feature's code, tables, and tests are NEVER deleted;
// flipping a flag back to `true` re-enables it everywhere instantly, no
// further changes needed. Default OFF here means "hidden from every nav
// surface (src/navigation/navRegistry.ts), and the legacy-backup importer
// politely skips creating new rows for it" — existing data already in the
// tables is never touched, and a screen that reads it directly for its
// own aggregate (e.g. Accountant Package) is unaffected, since this flag
// only gates NAVIGATION and NEW imports, not data access.
export const FEATURE_FLAGS = {
  // Bank Statement + Credit Cards screens/nav items hidden app-wide
  // (owner decision 2026-07-30). Capital Account is explicitly NOT
  // included here — the owner-contribution flow, draw tracking, and tax
  // basis all depend on it (confirmed decision) and it stays fully
  // enabled regardless of this flag.
  bankCreditCards: false,
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;
