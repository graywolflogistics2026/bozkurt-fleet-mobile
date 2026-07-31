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
