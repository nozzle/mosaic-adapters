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
  import type { Selection } from '@uwdata/mosaic-core';

  let dashboardElement: HTMLElement | null = null;
  let isReady = false;
  let setupRan = false;

  // Declare selection variables, but do not initialize them here.
  let categorySel: Selection;
  let brushSel: Selection;
  let externalFilterSel: Selection;
  let querySel: Selection;
  let hoverSel: Selection;
  let hoverRawSel: Selection;
  let rowSelectionSel: Selection;
  let internalFilterSel: Selection;

  onMount(async () => {
    if (setupRan) return;
    setupRan = true;

    // --- DEFERRED INITIALIZATION ---
    // Initialize selections inside onMount, guaranteeing the context is available.
    categorySel = useMosaicSelection('athlete_category');
    brushSel = useMosaicSelection('athlete_brush');
    externalFilterSel = useMosaicSelection('athlete_external_filter');
    querySel = useMosaicSelection('athlete_query');
    hoverSel = useMosaicSelection('athlete_hover');
    hoverRawSel = useMosaicSelection('athlete_hover_raw');
    rowSelectionSel = useMosaicSelection('athlete_rowSelection');
    internalFilterSel = useMosaicSelection('athlete_internal_filter');

    const fileURL =
      'https://pub-1da360b43ceb401c809f68ca37c7f8a4.r2.dev/data/athletes.parquet';
    await vg
      .coordinator()
      .exec([`CREATE OR REPLACE TABLE athletes AS SELECT * FROM '${fileURL}'`]);

    // Programmatically create the vgplot dashboard element.
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
          as: categorySel,
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
          as: brushSel,
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
  {#if isReady}
    <div use:vgplot={dashboardElement} />
    <div style="margin-top: 5px;">
      <DataTable
        logicConfig={athletesLogicConfig}
        uiConfig={athletesUIConfig}
        filterBy={externalFilterSel}
        internalFilterAs={internalFilterSel}
        rowSelectionAs={rowSelectionSel}
        hoverAs={hoverRawSel}
      />
    </div>
  {:else}
    <div>Loading Athletes Dashboard...</div>
  {/if}
</div>