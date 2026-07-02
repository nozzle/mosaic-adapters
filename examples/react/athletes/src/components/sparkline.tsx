import type { SparklinePoint } from '@nozzleio/react-mosaic';

const WIDTH = 96;
const HEIGHT = 24;

/**
 * Presentational mini bar chart over a sparkline client's series points.
 * Nothing in here touches Mosaic — data arrives as plain {x, y} points.
 */
export function Sparkline(props: {
  points: Array<SparklinePoint>;
  tooltip?: (point: SparklinePoint) => string;
}) {
  const { points, tooltip } = props;
  if (points.length === 0) {
    return <span className="text-xs text-slate-300">—</span>;
  }

  const maxY = Math.max(...points.map((point) => point.y));
  const barWidth = WIDTH / points.length;

  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      role="img"
      data-testid="sparkline"
      className="text-cyan-600"
    >
      {points.map((point, index) => {
        const barHeight = maxY > 0 ? (point.y / maxY) * HEIGHT : 0;
        return (
          <rect
            key={index}
            x={index * barWidth + 0.5}
            y={HEIGHT - barHeight}
            width={Math.max(barWidth - 1, 1)}
            height={barHeight}
            fill="currentColor"
          >
            {tooltip ? <title>{tooltip(point)}</title> : null}
          </rect>
        );
      })}
    </svg>
  );
}
