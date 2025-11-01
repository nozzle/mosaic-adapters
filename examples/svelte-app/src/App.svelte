<!-- src/App.svelte -->
<!-- This file orchestrates the main application layout, tabs, and initializes
the global interaction graph (selections) for the entire Svelte application. -->
<script lang="ts">
    import { onMount } from 'svelte';
    import { setMosaicContext, type SelectionConfig } from '@nozzle/mosaic-tanstack-svelte-table';
    import AthletesDashboard from './dashboards/AthletesDashboard.svelte';
    import NycTaxiDashboard from './dashboards/NycTaxiDashboard.svelte';
    import FlightsDashboard from './dashboards/FlightsDashboard.svelte';
  
    // --- INTERACTION GRAPH DEFINITION (Copied from original App.tsx) ---
    const athleteSelections: SelectionConfig[] = [
      { name: 'athlete_category', type: 'intersect' },
      { name: 'athlete_internal_filter', type: 'intersect' },
      { name: 'athlete_rowSelection', type: 'union', options: { empty: true } },
      { name: 'athlete_hover_raw', type: 'intersect', options: { empty: true } },
      { name: 'athlete_query', type: 'intersect', options: { include: ['athlete_category', 'athlete_rowSelection', 'athlete_internal_filter'] } },
      { name: 'athlete_hover', type: 'intersect', options: { empty: true, include: ['athlete_query', 'athlete_hover_raw'] } },
    ];
    const taxiSelections: SelectionConfig[] = [
      { name: 'taxi_rowSelection', type: 'union', options: { empty: true } },
      { name: 'taxi_trips_internal_filter', type: 'intersect' },
      { name: 'taxi_vendor_internal_filter', type: 'intersect' },
      { name: 'taxi_hover_raw', type: 'intersect', options: { empty: true } },
      { name: 'taxi_filter', type: 'intersect', options: { include: ['taxi_trips_internal_filter', 'taxi_vendor_internal_filter'] } },
      { name: 'taxi_hover', type: 'intersect', options: { empty: true, include: ['taxi_filter', 'taxi_hover_raw'] } },
    ];
    const flightsSelections: SelectionConfig[] = [
      { name: 'flights_brush', type: 'intersect', options: { cross: true } },
      { name: 'flights_internal_filter', type: 'intersect' },
      { name: 'flights_rowSelection', type: 'union', options: { empty: true } },
      { name: 'flights_query', type: 'intersect', options: { include: ['flights_brush', 'flights_rowSelection', 'flights_internal_filter'] } }
    ];
    const allDashboardSelections = [...athleteSelections, ...taxiSelections, ...flightsSelections];
  
    // Initialize the Mosaic context once for the entire application.
    setMosaicContext(allDashboardSelections);
    
    let activeTab: 'athletes' | 'taxis' | 'flights' = 'athletes';
  </script>
  
  <main>
    <nav>
      <button on:click={() => activeTab = 'athletes'} disabled={activeTab === 'athletes'}>
        Athletes Dashboard
      </button>
      <button on:click={() => activeTab = 'taxis'} disabled={activeTab === 'taxis'}>
        NYC Taxi Rides
      </button>
      <button on:click={() => activeTab = 'flights'} disabled={activeTab === 'flights'}>
        Flights Dashboard
      </button>
    </nav>
    <hr />
  
    <!-- Conditional rendering based on the active tab -->
    <div style:display={activeTab === 'athletes' ? 'block' : 'none'}>
      <AthletesDashboard />
    </div>
    <div style:display={activeTab === 'taxis' ? 'block' : 'none'}>
      <NycTaxiDashboard />
    </div>
    <div style:display={activeTab === 'flights' ? 'block' : 'none'}>
      <FlightsDashboard />
    </div>
  </main>