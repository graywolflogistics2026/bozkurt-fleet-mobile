import { I18nManager, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { spacing } from '@/src/theme';

// BRAND REFRESH (owner decision 2026-07-30): the app's logo mark — a
// minimal line-art semi-truck side profile (sleeper cab + trailer),
// replacing the earlier 🐺 emoji "wordmark icon" everywhere it appeared
// (BrandWordmark.tsx, the intro slides). Pure react-native-svg (already a
// dependency, used throughout the Dashboard's own charts) — no image
// asset, so it stays crisp at any size and themes with a single `color`
// prop like every other icon in this app.
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
// are the two guaranteed-legible presets. `colors.accent` (brand blue) is
// available as an explicit opt-in for a small accent touch, never the
// default.
//
// LOGO CONSISTENCY BUG FIX (owner decision 2026-08-24, device report:
// "the app still shows the old blue mark" everywhere a logo renders): the
// default `color` below used to be `colors.accent` (brand blue) — every
// call site that didn't pass an explicit color (BrandWordmark.tsx, and
// therefore the top bar/wide sidebar/CEO Mode header/every share-card
// footer that renders via BrandWordmark, plus intro.tsx's own bare
// <BrandLogo>) silently rendered blue instead of the intended
// theme-appropriate white/black, directly contradicting this file's own
// MONOCHROME VARIANTS comment above ("never the default"). Fixed at the
// single source: the default is now BRAND_LOGO_LIGHT (white), matching
// this app's dark-theme-only in-app default. `colors.accent` must now be
// passed explicitly wherever a blue accent touch is actually wanted — no
// call site in this app does today.
export const BRAND_LOGO_DARK = '#0a0a0f';
export const BRAND_LOGO_LIGHT = '#ffffff';
// Common render sizes this mark is asked to stay crisp at (vector SVG, so
// every size is equally crisp — these are just the sizes actually used
// across the app/store-asset call sites, kept here as the one shared list
// rather than each call site picking its own arbitrary number).
export const BRAND_LOGO_SIZES = { xs: 24, sm: 32, md: 64, xl: 512 } as const;

const VIEWBOX_WIDTH = 48;
const VIEWBOX_HEIGHT = 26;

export function BrandLogo({ size = 28, color = BRAND_LOGO_LIGHT }: { size?: number; color?: string }) {
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

// LOGO CONSISTENCY (owner decision 2026-08-24): every auth-flow screen
// (sign-in, sign-up, forgot-password, check-email, confirm-email,
// reset-password) previously showed the BRAND_NAME as plain text with no
// logo mark at all — the one surface named in the device report that
// wasn't merely showing the wrong (blue) color, but was missing the mark
// entirely. This is the one shared, centered header block all six use
// above their own ScreenTitle, so a future logo-size/spacing change is
// one edit, not six.
export function AuthBrandHeader({ size = 64 }: { size?: number }) {
  return (
    <View style={{ alignItems: 'center', marginBottom: spacing.md }}>
      <BrandLogo size={size} />
    </View>
  );
}
