/**
 * Inline SVG sparkline with CSS-only tooltip.
 * Used in the PAA Keyword Phrase summary table.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import * as mSql from '@uwdata/mosaic-sql';
import { line as d3Line, scaleLinear, scalePoint } from 'd3';
import { useMosaicSparkline } from '@nozzleio/mosaic-tanstack-react-table';
import type { Selection } from '@uwdata/mosaic-core';
import type { SparklineAggMode } from '@nozzleio/mosaic-tanstack-react-table';

// --- Presentational Sparkline ---

const DEFAULTS = { width: 100, height: 28, strokeWidth: 1.5 };

type SparklinePoint = {
  date: string;
  value: number;
};

type SparklineProps = {
  data: Array<SparklinePoint>;
  width?: number;
  height?: number;
};

function formatDate(raw: string): string {
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) {
      return raw;
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return raw;
  }
}

export function Sparkline({
  data,
  width = DEFAULTS.width,
  height = DEFAULTS.height,
}: SparklineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    point: SparklinePoint;
  } | null>(null);

  const pad = { top: 2, bottom: 2, left: 1, right: 1 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const { xScale, yScale, pathD } = useMemo(() => {
    if (data.length === 0) {
      return { xScale: null, yScale: null, pathD: null };
    }

    const dates = data.map((d) => d.date);
    const values = data.map((d) => d.value);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);

    const xs = scalePoint<string>().domain(dates).range([0, innerW]);
    const ys = scaleLinear()
      .domain([
        minV === maxV ? minV - 1 : minV,
        maxV === minV ? maxV + 1 : maxV,
      ])
      .range([innerH, 0]);

    const gen = d3Line<SparklinePoint>()
      .x((d) => xs(d.date) ?? 0)
      .y((d) => ys(d.value));

    return { xScale: xs, yScale: ys, pathD: gen(data) };
  }, [data, innerW, innerH]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!xScale || data.length === 0) {
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - pad.left;

      // Find nearest point
      let closest = data[0]!;
      let closestDist = Infinity;
      for (const pt of data) {
        const px = xScale(pt.date) ?? 0;
        const dist = Math.abs(px - mouseX);
        if (dist < closestDist) {
          closestDist = dist;
          closest = pt;
        }
      }
      setTooltip({ x: xScale(closest.date) ?? 0, point: closest });
    },
    [xScale, data, pad.left],
  );

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  if (data.length === 0) {
    return null;
  }

  // Single point: render a dot
  if (data.length === 1) {
    const cx = innerW / 2;
    const cy = innerH / 2;
    return (
      <div
        ref={containerRef}
        className="relative inline-block"
        style={{ width, height }}
      >
        <svg width={width} height={height}>
          <circle
            cx={cx + pad.left}
            cy={cy + pad.top}
            r={2.5}
            className="fill-cyan-600"
          />
        </svg>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative inline-block"
      style={{ width, height }}
    >
      <svg
        width={width}
        height={height}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="cursor-crosshair"
      >
        <g transform={`translate(${pad.left},${pad.top})`}>
          {pathD && (
            <path
              d={pathD}
              fill="none"
              stroke="currentColor"
              strokeWidth={DEFAULTS.strokeWidth}
              className="text-cyan-600"
            />
          )}
          {tooltip && yScale && (
            <>
              <circle
                cx={tooltip.x}
                cy={yScale(tooltip.point.value)}
                r={2.5}
                className="fill-cyan-600"
              />
              <line
                x1={tooltip.x}
                y1={0}
                x2={tooltip.x}
                y2={innerH}
                stroke="currentColor"
                strokeWidth={0.5}
                strokeDasharray="2,2"
                className="text-slate-300"
              />
            </>
          )}
        </g>
      </svg>
      {tooltip && (
        <div
          className="absolute z-50 pointer-events-none bg-slate-800 text-white text-[10px] leading-tight rounded px-1.5 py-1 whitespace-nowrap shadow-lg"
          style={{
            left: Math.min(tooltip.x + pad.left, width - 60),
            top: -24,
          }}
        >
          <div className="font-medium">{formatDate(tooltip.point.date)}</div>
          <div>{tooltip.point.value.toLocaleString()}</div>
        </div>
      )}
    </div>
  );
}

// --- Data-fetching cell wrapper ---

export type SparklineCellConfig = {
  /** Metric column to aggregate. */
  metric: string;
  /** Date/time column. */
  dateColumn: string;
  /** Aggregation mode. */
  aggMode: SparklineAggMode;
};

type SparklineCellProps = {
  /** Table name for the base FROM clause. */
  tableName: string;
  /** Column used to filter rows for this sparkline (e.g. 'phrase'). */
  groupByColumn: string;
  /** Row key value to filter by. */
  keyValue: string | number | null;
  filterBy: Selection;
  config: SparklineCellConfig;
  enabled: boolean;
};

/**
 * Builds a function-form MosaicTableSource that bakes the per-row
 * WHERE clause into the query. The SidecarClient passes the filterBy
 * predicate as the `filter` argument.
 */
function useSparklineSource(
  tableName: string,
  groupByColumn: string,
  keyValue: string | number | null,
) {
  return useMemo(() => {
    if (keyValue == null) {
      return tableName;
    }

    return (filter: mSql.FilterExpr | null | undefined) => {
      const q = mSql.Query.from(tableName).select('*');
      q.where(mSql.eq(mSql.column(groupByColumn), mSql.literal(keyValue)));
      if (filter) {
        q.where(filter);
      }
      return q;
    };
  }, [tableName, groupByColumn, keyValue]);
}

export function SparklineCell({
  tableName,
  groupByColumn,
  keyValue,
  filterBy,
  config,
  enabled,
}: SparklineCellProps) {
  const source = useSparklineSource(tableName, groupByColumn, keyValue);

  const { data, loading } = useMosaicSparkline({
    table: source,
    column: config.metric,
    dateColumn: config.dateColumn,
    aggMode: config.aggMode,
    filterBy,
    enabled: enabled && keyValue != null,
  });

  if (loading && data.length === 0) {
    return <div className="h-7 w-[100px] bg-slate-100 rounded animate-pulse" />;
  }

  if (data.length === 0) {
    return null;
  }

  return <Sparkline data={data} />;
}
