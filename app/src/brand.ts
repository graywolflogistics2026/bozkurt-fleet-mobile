// Single source of truth for the app's display brand (owner decision
// 2026-07-10, Session 9e — "BOZKA AI" design language). Working name only:
// the FINAL app name is a Session 10 decision made after a trademark
// search (docs/PENDING_SQL.md-adjacent PROMPTS.md Session 10 Part 2).
// Changing the working name should only ever require editing this file —
// every screen that displays the brand imports from here instead of
// hardcoding a string or baking it into an i18n translation value.
// app.json's `name`/`slug` (the store-facing identity) stay
// "Bozkurt Fleet OS" until that Session 10 decision lands.
export const BRAND_NAME = 'BOZKA AI';
export const BRAND_SHORT_NAME = 'BOZKA';
export const BRAND_TAGLINE = 'AI Business Coach for Owner Operators';
export const BRAND_EMOJI = '🐺';
