// Shared SVG polyline geometry — "Apple Stocks style" thin-line chart
// language used app-wide (Dashboard hero card, revenue trend, and now
// Cash Flow's weekly trend, owner decision 2026-07-30: "consistent chart
// language app-wide", replacing the old thick-bar Cash Flow chart).
// Originally lived inline in app/(tabs)/index.tsx; extracted here so every
// screen draws from the same tested implementation instead of each
// hand-rolling its own (and risking drift between them).
//
// domain: optional externally-supplied [min, max] — needed whenever two+
// series must share one Y scale (e.g. gross AND net on the same chart);
// omit it for a single-series chart to auto-scale to its own values.
export function buildPolylinePoints(values: number[], width: number, height: number, domain?: [number, number]): string {
  if (values.length === 0 || width <= 0) return '';
  if (values.length === 1) return `0,${height / 2} ${width},${height / 2}`;
  const [min, max] = domain ?? [Math.min(...values, 0), Math.max(...values, 0)];
  const range = Math.max(1, max - min);
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    })
    .join(' ');
}

// The filled-area variant (Hero Card style): the same line, closed into a
// polygon along the bottom edge, for a translucent fill underneath.
export function buildAreaPoints(polylinePoints: string, width: number, height: number): string {
  if (!polylinePoints || width <= 0) return '';
  return `0,${height} ${polylinePoints} ${width},${height}`;
}
