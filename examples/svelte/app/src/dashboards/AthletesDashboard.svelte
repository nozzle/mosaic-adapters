<!-- src/lib/dashboards/AthletesDashboard.svelte -->
<!-- This Svelte component replicates the AthletesDashboard from the React app,
showing how to integrate vgplot and the custom DataTable component. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import * as vg from '@uwdata/vgplot';
  import {
    useMosaicSelection,
    DataTable,
  } from '@nozzle/mosaic-tanstack-svelte-table';
  import { vgplot } from '../utils/vgplot';
  import { athletesLogicConfig, athletesUIConfig } from '../tables';

  let dashboardElement: HTMLElement | null = null;
  let isReady = false;
  let setupRan = false;

  // Retrieve all necessary selections from the global context.
  const categorySel = useMosaicSelection('athlete_category');
  const querySel = useMosaicSelection('athlete_query');
  const hoverSel = useMosaicSelection('athlete_hover');
  const hoverRawSel = useMosaicSelection('athlete_hover_raw');
  const rowSelectionSel = useMosaicSelection('athlete_rowSelection');
  const internalFilterSel = useMosaicSelection('athlete_internal_filter');

  onMount(async () => {
    if (setupRan) return;
    setupRan = true;

    // --- FIX: Use a publicly accessible URL for the Parquet file. ---
    // The remote DuckDB server cannot access 'localhost:5173'. This public URL
    // is accessible by the server, just like the data for the other dashboards.
    const fileURL =
      'https://pub-1da360b43ceb401c809f68ca37c7f8a4.r2.dev/data/athletes.parquet';
    await vg
      .coordinator()
      .exec([`CREATE OR REPLACE TABLE athletes AS SELECT * FROM '${fileURL}'`]);

    // Programmatically create the vgplot dashboard element.
    // This is the Svelte equivalent of the React component's setup effect.
    dashboardElement = vg.vconcat(
      vg.hconcat(
        vg.menu({
          label: 'Sport',
          as: categorySel,
          from: 'athletes',
          column: 'sport',
        }),
        vg.menu({
          label: 'Sex',
          as: categorySel,
          from: 'athletes',
          column: 'sex',
        }),
        vg.search({
          label: 'Name',
          filterBy: categorySel,
          as: querySel,
          from: 'athletes',
          column: 'name',
          type: 'contains',
        }),
      ),
      vg.vspace(10),
      vg.plot(
        vg.dot(vg.from('athletes', { filterBy: querySel }), {
          x: 'weight',
          y: 'height',
          fill: 'sex',
          r: 2,
          opacity: 0.1,
        }),
        vg.regressionY(vg.from('athletes', { filterBy: querySel }), {
          x: 'weight',
          y: 'height',
          stroke: 'sex',
        }),
        vg.intervalXY({
          as: querySel,
          brush: { fillOpacity: 0, stroke: 'black' },
        }),
        vg.dot(vg.from('athletes', { filterBy: hoverSel }), {
          x: 'weight',
          y: 'height',
          fill: 'sex',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          r: 4,
        }),
        vg.xyDomain(vg.Fixed),
        vg.colorDomain(vg.Fixed),
        vg.margins({ left: 35, top: 20, right: 1 }),
        vg.width(570),
        vg.height(350),
      ),
    );

    isReady = true;
  });
</script>

<div>
  <!-- Only render once the dashboard element is created -->
  {#if isReady}
    <!-- Use the vgplot Svelte action to mount the dashboard -->
    <div use:vgplot={dashboardElement} />

    <div style="margin-top: 5px;">
      <!-- Instantiate the generic DataTable component with specific configs and selections -->
      <DataTable
        logicConfig={athletesLogicConfig}
        uiConfig={athletesUIConfig}
        filterBy={querySel}
        internalFilterAs={internalFilterSel}
        rowSelectionAs={rowSelectionSel}
        hoverAs={hoverRawSel}
      />
    </div>
  {:else}
    <div>Loading Athletes Dashboard...</div>
  {/if}
</div>
