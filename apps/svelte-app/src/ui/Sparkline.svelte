<script lang="ts">
  import { scaleLinear, line as d3Line, extent } from 'd3';
  import type { Row, Cell, Column, Header, Table } from '@tanstack/svelte-table';

  export let row: Row<any>;
  
  // svelte-ignore unused-export-let
  export let cell: Cell<any, unknown>;
  // svelte-ignore unused-export-let
  export let column: Column<any, unknown>;
  // svelte-ignore unused-export-let
  export let table: Table<any>;
  // svelte-ignore unused-export-let
  export let getValue: (() => any) | undefined = undefined;
  // svelte-ignore unused-export-let
  export let renderValue: (() => any) | undefined = undefined;

  export let width = 180;
  export let height = 40;
  export let color = '#4682b4';
  export let strokeWidth = 1.5;

  interface HoverPoint {
    index: number;
    value: number;
    x: number;
    y: number;
  }
  let hoverPoint: HoverPoint | null = null;
  
  let plainData: number[] = [];
  let startDate: Date | undefined = undefined;
  let endDate: Date | undefined = undefined;

  $: {
    const originalData = row.original;
    plainData = Array.from(originalData.daily_revenue || []);
    startDate = originalData.start_date;
    endDate = originalData.end_date;
  }

  const formatDate = (date: Date) => date.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit'});

  let isDataPlottable = false;
  $: isDataPlottable = plainData.length > 0 && !plainData.some(d => typeof d !== 'number' || !isFinite(d));
  
  let path: string | null = null;
  let xScale: d3.ScaleLinear<number, number> | null = null;
  let yScale: d3.ScaleLinear<number, number> | null = null;

  $: {
    if (!isDataPlottable || plainData.length < 2) {
      path = null;
      xScale = null;
      yScale = null;
    } else {
      const yDomain = extent(plainData) as [number, number];
      const xS = scaleLinear().domain([0, plainData.length - 1]).range([0, width]);
      const yBuffer = (yDomain[1] - yDomain[0]) * 0.2 || 1;
      const yS = scaleLinear().domain([yDomain[0] - yBuffer, yDomain[1] + yBuffer]).range([height, 0]);
      
      const lineGenerator = d3Line<number>().x((_, i) => xS(i)).y(d => yS(d));
      
      path = lineGenerator(plainData);
      xScale = xS;
      yScale = yS;
    }
  }

  function handleMouseMove(event: MouseEvent) {
    if (!xScale || !yScale || !isDataPlottable) return;
    const mouseX = event.offsetX;
    const index = Math.round(xScale.invert(mouseX));
    const clampedIndex = Math.max(0, Math.min(plainData.length - 1, index));
    const value = plainData[clampedIndex];
    hoverPoint = { index: clampedIndex, value, x: xScale(clampedIndex), y: yScale(value) };
  }
</script>

<div 
    role="graphics-document" 
    aria-label="Sparkline chart showing daily revenue"
    style="position: relative; cursor: crosshair; height: {height + 20}px;"
>
  {#if !isDataPlottable}
    <div style="height: {height + 20}px; display: flex; align-items: center; justify-content: center; font-size: 10px; color: #999;">
      (no data)
    </div>
  {:else if plainData.length === 1}
    <div 
          role="graphics-symbol"
          aria-label="Single data point for revenue"
          on:mouseenter={() => hoverPoint = { index: 0, value: plainData[0], x: width / 2, y: height / 2 }}
          on:mouseleave={() => hoverPoint = null}
          style="position: relative; cursor: pointer; height: {height + 20}px"
      >
          <svg {width} {height} style="overflow: visible">
              <circle cx={width / 2} cy={height / 2} r={strokeWidth * 1.5} fill={color} />
              {#if hoverPoint}
                  <g>
                      <text x={width / 2} y={height / 2} dy={-10} text-anchor="middle" font-size="12" fill="#333" font-weight="bold">
                          ${hoverPoint.value.toFixed(0)}
                      </text>
                  </g>
              {/if}
          </svg>
          {#if startDate}
               <div style="text-align: center; font-size: 10px; color: #666; margin-top: 2px; opacity: {hoverPoint ? 1 : 0.5}">
                  <span>{formatDate(startDate)}</span>
              </div>
          {/if}
      </div>
  {:else}
    <svg {width} {height} style="overflow: visible;">
      <path d={path || ''} fill="none" stroke={color} stroke-width={strokeWidth} />
      {#if hoverPoint}
        <g style="pointer-events: none;">
          <line x1={hoverPoint.x} y1={0} x2={hoverPoint.x} y2={height} stroke="#aaa" stroke-width="1" stroke-dasharray="2,2" />
          <circle cx={hoverPoint.x} cy={hoverPoint.y} r={strokeWidth + 1.5} fill="white" stroke={color} stroke-width="1.5" />
          <text x={hoverPoint.x} y={hoverPoint.y} dy={-10} text-anchor="middle" font-size="12" fill="#333" font-weight="bold">
            ${hoverPoint.value.toFixed(0)}
          </text>
        </g>
      {/if}
      <rect 
            role="slider"
            aria-label="Time-series slider"
            {width} 
            {height} 
            fill="transparent" 
            on:mousemove={handleMouseMove} 
            on:mouseleave={() => hoverPoint = null} 
      />
    </svg>
    {#if startDate && endDate}
      <div style="display: flex; justify-content: space-between; font-size: 10px; color: #666; margin-top: 4px; opacity: {hoverPoint ? 1 : 0.5}; transition: opacity 0.2s ease-in-out;">
        <span>{formatDate(startDate)}</span>
        <span>{formatDate(endDate)}</span>
      </div>
    {/if}
  {/if}
</div>