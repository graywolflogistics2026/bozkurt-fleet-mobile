import { I18nManager } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '@/src/theme';

// BRAND REFRESH (owner decision 2026-07-30): the app's logo mark — a
// minimal line-art semi-truck side profile (sleeper cab + trailer),
// brand blue on dark, replacing the earlier 🐺 emoji "wordmark icon"
// everywhere it appeared (BrandWordmark.tsx, the intro slides). Pure
// react-native-svg (already a dependency, used throughout the Dashboard's
// own charts) — no image asset, so it stays crisp at any size and themes
// with a single `color` prop like every other icon in this app.
//
// RTL-safe: this is a directional side-profile glyph (the cab reads as
// "facing" one direction), so it mirrors under I18nManager.isRTL — the
// same "logical, not literal, direction" principle CLAUDE.md invariant
// #11 already requires for RTL layout generally.
//
// MONOCHROME VARIANTS (owner decision 2026-08-24, branding pass): this
// app is dark-theme-only in its own UI (theme.ts), but the mark also
// appears on surfaces this app doesn't control the background of — a
// captured share-card image someone posts anywhere, a future white
// app-store icon background, a printed/exported document. `BRAND_LOGO_DARK`
// (near-black, for a light/white background) and `BRAND_LOGO_LIGHT`
// (white, for a dark background — the existing in-app default context)
// are the two guaranteed-legible presets; `colors.accent` stays available
// as an explicit opt-in for a small accent touch, never the default for a
// surface whose background isn't known to be dark.
export const BRAND_LOGO_DARK = '#0a0a0f';
export const BRAND_LOGO_LIGHT = '#ffffff';
// Common render sizes this mark is asked to stay crisp at (vector SVG, so
// every size is equally crisp — these are just the sizes actually used
// across the app/store-asset call sites, kept here as the one shared list
// rather than each call site picking its own arbitrary number).
export const BRAND_LOGO_SIZES = { xs: 24, sm: 32, md: 64, xl: 512 } as const;

const VIEWBOX_WIDTH = 48;
const VIEWBOX_HEIGHT = 26;

export function BrandLogo({ size = 28, color = colors.accent }: { size?: number; color?: string }) {
  const width = size;
  const height = size * (VIEWBOX_HEIGHT / VIEWBOX_WIDTH);
  return (
    <Svg
      width={width}
      height={height}
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      style={I18nManager.isRTL ? { transform: [{ scaleX: -1 }] } : undefined}
    >
      {/* Trailer */}
      <Rect x={14} y={4} width={31} height={14} rx={1} stroke={color} strokeWidth={2} fill="none" />
      {/* Sleeper cab */}
      <Path d="M4 18 V10 H9 L14 4 V18 Z" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" fill="none" />
      {/* Chassis */}
      <Path d="M2 18 H46" stroke={color} strokeWidth={2} strokeLinecap="round" />
      {/* Wheels */}
      <Circle cx={9} cy={21} r={3} stroke={color} strokeWidth={2} fill="none" />
      <Circle cx={34} cy={21} r={3} stroke={color} strokeWidth={2} fill="none" />
    </Svg>
  );
}
