import Svg, { Circle } from 'react-native-svg';
import { colors } from '@/src/theme';

// Fleet Health Score gauge (Session 9d item 2) — a plain react-native-svg
// ring, not a chart-library dependency: one Circle for the track, one for
// the progress arc (rotated -90deg so it starts at 12 o'clock, same
// convention as every native "gauge" widget).
export function CircularGauge({
  score,
  size = 96,
  strokeWidth = 10,
  color,
}: {
  score: number;
  size?: number;
  strokeWidth?: number;
  color: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(100, score)) / 100;
  const strokeDashoffset = circumference * (1 - progress);
  const center = size / 2;

  return (
    <Svg width={size} height={size}>
      <Circle cx={center} cy={center} r={radius} stroke={colors.border} strokeWidth={strokeWidth} fill="none" />
      <Circle
        cx={center}
        cy={center}
        r={radius}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        rotation="-90"
        origin={`${center}, ${center}`}
      />
    </Svg>
  );
}
