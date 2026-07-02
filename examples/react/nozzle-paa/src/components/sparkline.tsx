/**
 * Inline SVG sparkline with a nearest-point tooltip. Purely presentational:
 * the points come from the phrase table's one batched sparkline client.
 */
import { useCallback, useMemo, useState } from 'react';
import type { SparklinePoint } from '@nozzleio/react-mosaic';

const WIDTH = 100;
const HEIGHT = 28;
const PAD = { top: 2, bottom: 2, left: 1, right: 1 };
const INNER_W = WIDTH - PAD.left - PAD.right;
const INNER_H = HEIGHT - PAD.top - PAD.bottom;

function toMillis(x: SparklinePoint['x']): number {
  return x instanceof Date ? x.getTime() : Number(x);
}

function formatDate(x: SparklinePoint['x']): string {
  const date = x instanceof Date ? x : new Date(Number(x));
  if (Number.isNaN(date.getTime())) {
    return String(x);
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface ScaledPoint {
  x: number;
  y: number;
  point: SparklinePoint;
}

export function Sparkline(props: { points: Array<SparklinePoint> }) {
  const { points } = props;
  const [hovered, setHovered] = useState<ScaledPoint | null>(null);

  const scaled = useMemo<Array<ScaledPoint>>(() => {
    if (points.length === 0) {
      return [];
    }
    const xs = points.map((point) => toMillis(point.x));
    const ys = points.map((point) => point.y);
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
    const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    return points.map((point) => ({
      x: ((toMillis(point.x) - minX) / spanX) * INNER_W,
      y: INNER_H - ((point.y - minY) / spanY) * INNER_H,
      point,
    }));
  }, [points]);

  const path = useMemo(() => {
    if (scaled.length < 2) {
      return null;
    }
    return scaled
      .map(
        (point, index) =>
          `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`,
      )
      .join(' ');
  }, [scaled]);

  const onMouseMove = useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      if (scaled.length === 0) {
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const mouseX = event.clientX - rect.left - PAD.left;
      let closest = scaled[0]!;
      for (const candidate of scaled) {
        if (Math.abs(candidate.x - mouseX) < Math.abs(closest.x - mouseX)) {
          closest = candidate;
        }
      }
      setHovered(closest);
    },
    [scaled],
  );

  if (points.length === 0) {
    return null;
  }

  // A single point renders as a dot.
  if (scaled.length === 1) {
    return (
      <div
        data-testid="sparkline"
        className="relative inline-block"
        style={{ width: WIDTH, height: HEIGHT }}
      >
        <svg width={WIDTH} height={HEIGHT}>
          <circle
            cx={PAD.left + INNER_W / 2}
            cy={PAD.top + INNER_H / 2}
            r={2.5}
            className="fill-cyan-600"
          />
        </svg>
      </div>
    );
  }

  return (
    <div
      data-testid="sparkline"
      className="relative inline-block"
      style={{ width: WIDTH, height: HEIGHT }}
    >
      <svg
        width={WIDTH}
        height={HEIGHT}
        className="cursor-crosshair"
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHovered(null)}
      >
        <g transform={`translate(${PAD.left},${PAD.top})`}>
          {path !== null ? (
            <path
              d={path}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="text-cyan-600"
            />
          ) : null}
          {hovered !== null ? (
            <>
              <circle
                cx={hovered.x}
                cy={hovered.y}
                r={2.5}
                className="fill-cyan-600"
              />
              <line
                x1={hovered.x}
                y1={0}
                x2={hovered.x}
                y2={INNER_H}
                stroke="currentColor"
                strokeWidth={0.5}
                strokeDasharray="2,2"
                className="text-slate-300"
              />
            </>
          ) : null}
        </g>
      </svg>
      {hovered !== null ? (
        <div
          className="pointer-events-none absolute z-50 rounded bg-slate-800 px-1.5 py-1 text-[10px] leading-tight whitespace-nowrap text-white shadow-lg"
          style={{ left: Math.min(hovered.x + PAD.left, WIDTH - 60), top: -24 }}
        >
          <div className="font-medium">{formatDate(hovered.point.x)}</div>
          <div>{hovered.point.y.toLocaleString()}</div>
        </div>
      ) : null}
    </div>
  );
}
