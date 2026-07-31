// Single source of truth for the app's display brand (owner decision
// 2026-07-30, BRAND REFRESH — supersedes the earlier "BOZKA AI" working
// name). Working name only, still pre-trademark: the FINAL app name is a
// later Session 10 decision made after a trademark search
// (docs/PENDING_SQL.md-adjacent PROMPTS.md Session 10 Part 2). Changing
// the working name should only ever require editing this file — every
// screen that displays the brand imports from here instead of
// hardcoding a string or baking it into an i18n translation value.
// app.config.js's `name`/`slug` (the store-facing identity) stay
// "Bozkurt Fleet OS" until that Session 10 decision lands.
export const BRAND_NAME = 'BOZKA TRUCKING AI';
export const BRAND_SHORT_NAME = 'BOZKA';
// Shown under the wordmark (BrandWordmark's `showTagline` prop) — the
// logo + name + tagline header block on the phone top bar and the
// wide-screen sidebar (owner decision 2026-07-30). Brand voice stays
// English regardless of locale, same as every other brand-identity
// string here — glossary-exempt (docs/I18N_GLOSSARY.md governs domain
// terms like "per diem"/"settlement," not the brand's own voice).
export const BRAND_TAGLINE = 'Your AI Business Coach';
export const BRAND_EMOJI = '🐺';
