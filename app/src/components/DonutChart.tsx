import Svg, { Circle } from 'react-native-svg';

export type DonutSlice = { label: string; value: number; color: string };

// Money Breakdown donut (Session 9d item 4) — stacked react-native-svg
// Circle strokes, the standard "multi-color ring via strokeDasharray"
// technique, no chart library. A small gap between segments (mark-spec
// convention: a visible surface gap between adjacent fills) keeps slices
// visually distinct since this app's fixed dark theme (CLAUDE.md — ported
// verbatim from legacy's CSS variables) doesn't clear the dataviz
// skill's lightness/chroma bands; the caller's legend (always rendered
// alongside, never color-only) is the primary identity channel, same
// "text label, not color alone" rule StatusChip already follows.
export function DonutChart({ slices, size = 120, strokeWidth = 22 }: { slices: DonutSlice[]; size?: number; strokeWidth?: number }) {
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const gap = 3;
  const center = size / 2;
  let cumulative = 0;

  return (
    <Svg width={size} height={size}>
      {slices.map((slice, i) => {
        if (total <= 0 || slice.value <= 0) return null;
        const fraction = slice.value / total;
        const dash = Math.max(0, circumference * fraction - gap);
        const rotation = -90 + (cumulative / total) * 360;
        cumulative += slice.value;
        return (
          <Circle
            key={i}
            cx={center}
            cy={center}
            r={radius}
            stroke={slice.color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={`${dash} ${Math.max(0, circumference - dash)}`}
            strokeLinecap="round"
            rotation={rotation}
            origin={`${center}, ${center}`}
          />
        );
      })}
    </Svg>
  );
}
