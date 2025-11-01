// src/Sparkline.tsx
// This file defines a simple, reusable, and interactive Sparkline chart component.
// It is designed to take an array of numbers and render a small line chart
// that reveals individual data points and labels on hover.
import React, { useMemo, useState } from 'react';
import { line as d3Line, extent, scaleLinear } from 'd3';

interface HoverPoint {
  index: number;
  value: number;
  x: number;
  y: number;
}

interface SparklineProps {
  data: Array<number> | Float64Array;
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
  startDate?: Date;
  endDate?: Date;
}

const formatDate = (date: Date) =>
  date.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' });

export const Sparkline: React.FC<SparklineProps> = ({
  data,
  width = 180,
  height = 40,
  color = '#4682b4',
  strokeWidth = 1.5,
  startDate,
  endDate,
}) => {
  const [hoverPoint, setHoverPoint] = useState<HoverPoint | null>(null);

  const plainData = useMemo(() => Array.from(data || []), [data]);

  const isDataPlottable = useMemo(() => {
    if (plainData.length === 0) {
      return false;
    }
    const containsInvalidNumbers = plainData.some(
      (d) => typeof d !== 'number' || !isFinite(d),
    );
    if (containsInvalidNumbers) {
      return false;
    }
    return true;
  }, [plainData]);

  const { path, xScale, yScale } = useMemo(() => {
    if (!isDataPlottable || plainData.length < 2)
      return { path: null, xScale: null, yScale: null };

    const yDomain = extent(plainData) as [number, number];

    const xScale = scaleLinear()
      .domain([0, plainData.length - 1])
      .range([0, width]);

    // Add a small buffer to the y-domain to prevent labels from being clipped
    const yBuffer = (yDomain[1] - yDomain[0]) * 0.2 || 1;
    const yScale = scaleLinear()
      .domain([yDomain[0] - yBuffer, yDomain[1] + yBuffer])
      .range([height, 0]);

    const lineGenerator = d3Line<number>()
      .x((_, i) => xScale(i))
      .y((d) => yScale(d));

    return {
      path: lineGenerator(plainData),
      xScale,
      yScale,
    };
  }, [plainData, width, height, isDataPlottable]);

  const handleMouseMove = (event: React.MouseEvent<SVGRectElement>) => {
    if (!xScale || !yScale || !isDataPlottable) return;

    const mouseX = event.nativeEvent.offsetX;

    const indexFloat = xScale.invert(mouseX);
    const index = Math.round(indexFloat);

    const clampedIndex = Math.max(0, Math.min(plainData.length - 1, index));

    const value = plainData[clampedIndex];

    setHoverPoint({
      index: clampedIndex,
      value: value,
      x: xScale(clampedIndex),
      y: yScale(value),
    });
  };

  const handleMouseLeave = () => {
    setHoverPoint(null);
  };

  if (!isDataPlottable) {
    return (
      <div
        style={{
          height: `${height + 20}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '10px',
          color: '#999',
        }}
      >
        (no data)
      </div>
    );
  }

  // Conditional rendering for single data point
  if (plainData.length === 1) {
    const value = plainData[0];
    return (
      <div
        onMouseEnter={() =>
          setHoverPoint({ index: 0, value, x: width / 2, y: height / 2 })
        }
        onMouseLeave={handleMouseLeave}
        style={{
          position: 'relative',
          cursor: 'pointer',
          height: `${height + 20}px`,
        }}
      >
        <svg width={width} height={height} style={{ overflow: 'visible' }}>
          <circle
            cx={width / 2}
            cy={height / 2}
            r={strokeWidth * 1.5}
            fill={color}
          />
          {hoverPoint && (
            <g>
              <text
                x={width / 2}
                y={height / 2}
                dy={-10}
                textAnchor="middle"
                fontSize="12"
                fill="#333"
                fontWeight="bold"
              >
                ${value?.toFixed(0)}
              </text>
            </g>
          )}
        </svg>
        {startDate && (
          <div
            style={{
              textAlign: 'center',
              fontSize: '10px',
              color: '#666',
              marginTop: '2px',
              opacity: hoverPoint ? 1 : 0.5,
            }}
          >
            <span>{formatDate(startDate)}</span>
          </div>
        )}
      </div>
    );
  }

  // Main return for multi-point data (line chart)
  return (
    <div
      style={{
        position: 'relative',
        cursor: 'crosshair',
        height: `${height + 20}px`,
      }}
    >
      <svg width={width} height={height} style={{ overflow: 'visible' }}>
        <path
          d={path || ''}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
        />

        {hoverPoint && (
          <g style={{ pointerEvents: 'none' }}>
            <line
              x1={hoverPoint.x}
              y1={0}
              x2={hoverPoint.x}
              y2={height}
              stroke="#aaa"
              strokeWidth="1"
              strokeDasharray="2,2"
            />
            <circle
              cx={hoverPoint.x}
              cy={hoverPoint.y}
              r={strokeWidth + 1.5}
              fill="white"
              stroke={color}
              strokeWidth="1.5"
            />
            <text
              x={hoverPoint.x}
              y={hoverPoint.y}
              dy={-10}
              textAnchor="middle"
              fontSize="12"
              fill="#333"
              fontWeight="bold"
            >
              ${hoverPoint.value.toFixed(0)}
            </text>
          </g>
        )}

        <rect
          width={width}
          height={height}
          fill="transparent"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />
      </svg>
      {startDate && endDate && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '10px',
            color: '#666',
            marginTop: '4px',
            opacity: hoverPoint ? 1 : 0.5,
            transition: 'opacity 0.2s ease-in-out',
          }}
        >
          <span>{formatDate(startDate)}</span>
          <span>{formatDate(endDate)}</span>
        </div>
      )}
    </div>
  );
};
