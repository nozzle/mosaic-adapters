<!-- src/App.svelte -->
<!-- This file orchestrates the main application layout and correctly initializes
the global Mosaic state (coordinator and selections) for the entire Svelte application,
respecting Svelte's component lifecycle and Mosaic's internal dependencies. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import * as vg from '@uwdata/vgplot';
  import { setMosaicContext } from '@nozzle/mosaic-tanstack-svelte-table';
  import { allDashboardSelections } from './selections';
  import AthletesDashboard from './dashboards/AthletesDashboard.svelte';
  import NycTaxiDashboard from './dashboards/NycTaxiDashboard.svelte';
  import FlightsDashboard from './dashboards/FlightsDashboard.svelte';

  // A single state flag to manage the visibility of child components.
  // This is the key to preventing children from initializing too early.
  let isMosaicReady = false;

  // onMount ensures this code runs only in the browser, after the component
  // has been added to the DOM. This is the correct place for all side-effects.
  onMount(() => {
    // --- CORRECT SEQUENTIAL INITIALIZATION ---

    // STEP 1: Configure the global coordinator first. This is a critical dependency
    // for creating selections.
    console.log('[App.svelte] onMount: Configuring global coordinator...');
    const backend = import.meta.env.VITE_MOSAIC_BACKEND || 'wasm';
    if (backend === 'wasm') {
      vg.coordinator().databaseConnector(vg.wasmConnector());
    } else {
      const serverUri =
        import.meta.env.VITE_MOSAIC_SERVER_URI || 'ws://localhost:3000';
      vg.coordinator().databaseConnector(vg.socketConnector(serverUri));
    }
    console.log('[App.svelte] onMount: Coordinator is ready.');

    // STEP 2: Now that the coordinator is ready, create and set the Svelte context.
    // This function call is safe inside onMount.
    setMosaicContext(allDashboardSelections);
    console.log('[App.svelte] onMount: Mosaic Context has been set.');

    // STEP 3: With both coordinator and context ready, signal to the template
    // that it is now safe to render the child dashboards.
    isMosaicReady = true;
  });

  // UI state for managing tabs
  let activeTab: 'athletes' | 'taxis' | 'flights' = 'athletes';
</script>

<main>
  <nav>
    <button
      on:click={() => (activeTab = 'athletes')}
      disabled={activeTab === 'athletes'}
    >
      Athletes Dashboard
    </button>
    <button
      on:click={() => (activeTab = 'taxis')}
      disabled={activeTab === 'taxis'}
    >
      NYC Taxi Rides
    </button>
    <button
      on:click={() => (activeTab = 'flights')}
      disabled={activeTab === 'flights'}
    >
      Flights Dashboard
    </button>
  </nav>
  <hr />

  <!--
    The #if block is critical. It ensures that Svelte does not even attempt to
    initialize the child dashboard components until `isMosaicReady` becomes true,
    preventing any premature calls to `useMosaicSelection`.
  -->
  {#if isMosaicReady}
    {#if activeTab === 'athletes'}
      <AthletesDashboard />
    {:else if activeTab === 'taxis'}
      <NycTaxiDashboard />
    {:else if activeTab === 'flights'}
      <FlightsDashboard />
    {/if}
  {:else}
    <div>Initializing Mosaic...</div>
  {/if}
</main>