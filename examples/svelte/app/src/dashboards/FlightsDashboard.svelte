<!-- src/lib/dashboards/FlightsDashboard.svelte -->
<!-- This Svelte component replicates the FlightsDashboard from the React app. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import * as vg from '@uwdata/vgplot';
  import {
    useMosaicSelection,
    DataTable,
  } from '@nozzle/mosaic-tanstack-svelte-table';
  import { vgplot } from '../utils/vgplot';
  import { flightsLogicConfig, flightsUIConfig } from '../tables';
  import type { Selection } from '@uwdata/mosaic-core';

  let dashboardElement: HTMLElement | null = null;
  let isReady = false;
  let setupRan = false;

  // Declare selection variables, but do not initialize them here.
  let querySel: Selection;
  let brushSel: Selection;
  let rowSelectionSel: Selection;
  let internalFilterSel: Selection;
  let externalFilterSel: Selection;

  onMount(async () => {
    if (setupRan) return;
    setupRan = true;

    // Initialize selections inside onMount.
    querySel = useMosaicSelection('flights_query');
    brushSel = useMosaicSelection('flights_brush');
    rowSelectionSel = useMosaicSelection('flights_rowSelection');
    internalFilterSel = useMosaicSelection('flights_internal_filter');
    externalFilterSel = useMosaicSelection('flights_external_filter');

    const fileURL =
      'https://pub-1da360b43ceb401c809f68ca37c7f8a4.r2.dev/data/flights-10m.parquet';
    const dataSetupQuery = `
      CREATE OR REPLACE TABLE flights_10m AS
      SELECT ROW_NUMBER() OVER () AS id,
        GREATEST(-60, LEAST(ARR_DELAY, 180))::DOUBLE AS delay,
        DISTANCE AS distance, DEP_TIME AS time
      FROM '${fileURL}'`;
    await vg.coordinator().exec(dataSetupQuery);

    dashboardElement = vg.vconcat(
      vg.plot(
        vg.rectY(vg.from('flights_10m', { filterBy: querySel }), {
          x: vg.bin('delay'),
          y: vg.count(),
          fill: 'steelblue',
          insetLeft: 0.5,
          insetRight: 0.5,
        }),
        vg.intervalX({ as: brushSel }),
        vg.xDomain(vg.Fixed),
        vg.xLabel('Arrival Delay (min) →'),
        vg.yTickFormat('s'),
        vg.width(600),
        vg.height(200),
      ),
      vg.plot(
        vg.rectY(vg.from('flights_10m', { filterBy: querySel }), {
          x: vg.bin('time'),
          y: vg.count(),
          fill: 'steelblue',
          insetLeft: 0.5,
          insetRight: 0.5,
        }),
        vg.intervalX({ as: brushSel }),
        vg.xDomain(vg.Fixed),
        vg.xLabel('Departure Time (hour) →'),
        vg.yTickFormat('s'),
        vg.width(600),
        vg.height(200),
      ),
      vg.plot(
        vg.rectY(vg.from('flights_10m', { filterBy: querySel }), {
          x: vg.bin('distance'),
          y: vg.count(),
          fill: 'steelblue',
          insetLeft: 0.5,
          insetRight: 0.5,
        }),
        vg.intervalX({ as: brushSel }),
        vg.xDomain(vg.Fixed),
        vg.xLabel('Flight Distance (miles) →'),
        vg.yTickFormat('s'),
        vg.width(600),
        vg.height(200),
      ),
    );

    isReady = true;
  });
</script>

<div>
  <h2>10 Million US Flights</h2>
  <p>
    This dashboard shows three histograms of flight data. Brushing on one
    histogram (clicking and dragging) will cross-filter the other two, updating
    their distributions to reflect the selected data subset.
  </p>
  {#if isReady}
    <div use:vgplot={dashboardElement} />
    <div style="margin-top: 1rem;">
      <DataTable
        logicConfig={flightsLogicConfig}
        uiConfig={flightsUIConfig}
        filterBy={externalFilterSel}
        rowSelectionAs={rowSelectionSel}
        internalFilterAs={internalFilterSel}
      />
    </div>
  {:else}
    <div>Loading Flights Dashboard...</div>
  {/if}
</div>