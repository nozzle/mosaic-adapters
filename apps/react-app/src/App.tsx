// App.tsx
// This file serves as the root component for the React application. Its primary
// responsibilities are to define the application's top-level layout, including the
// tab-based navigation, and to establish the complete "interaction graph" for all
// dashboards. It does this by declaratively configuring all Mosaic Selections for the
// entire app and providing them globally via the `MosaicProvider`.
import React, { useState } from 'react';
import { MosaicProvider, type SelectionConfig } from '@mosaic-tanstack/react';
import { AthletesDashboard } from './dashboards/AthletesDashboard';
import { NycTaxiDashboard } from './dashboards/NycTaxiDashboard';
import { FlightsDashboard } from './dashboards/FlightsDashboard';

// --- ATHLETES DASHBOARD INTERACTION GRAPH ---
const athleteSelections: SelectionConfig[] = [
  // --- Input Selections ---
  // Receives filter predicates from the Sport and Sex dropdown menus.
  { name: 'athlete_category', type: 'intersect' },
  // Receives predicates from the Tanstack table's internal column/global filters.
  { name: 'athlete_internal_filter', type: 'intersect' },
  // Receives a union of predicates for all selected rows (via checkboxes).
  { name: 'athlete_rowSelection', type: 'union', options: { empty: true } },
  
  // --- Raw Interaction Signal ---
  // Receives the primitive, context-free predicate for the currently hovered table row.
  // This is a "signal" channel, not for direct UI filtering.
  { name: 'athlete_hover_raw', type: 'intersect', options: { empty: true } },
  
  // --- Composite Selections for UI Filtering ---
  // The main context filter for the dashboard. Combines inputs, selected rows,
  // and the table's own internal filters. This is the selection that most
  // components (including the table itself and vgplot visuals) will be filtered by.
  { 
    name: 'athlete_query', 
    type: 'intersect', 
    options: { 
      include: ['athlete_category', 'athlete_rowSelection', 'athlete_internal_filter'] 
    } 
  },

  // The final, context-aware selection for the hover highlight effect.
  // It combines the main query context WITH the raw hover signal.
  // The vgplot `dot` mark for highlighting listens to this selection.
  {
    name: 'athlete_hover',
    type: 'intersect',
    options: {
      empty: true,
      include: ['athlete_query', 'athlete_hover_raw']
    }
  },
];

// --- NYC TAXI DASHBOARD INTERACTION GRAPH ---
const taxiSelections: SelectionConfig[] = [
  // --- Input Selections ---
  // Receives a union of predicates for all selected rows (if selection were enabled).
  { name: 'taxi_rowSelection', type: 'union', options: { empty: true } },
  // Receives predicates from the "Trips" table's internal filters.
  { name: 'taxi_trips_internal_filter', type: 'intersect' },
  // Receives predicates from the "Vendor" table's internal filters.
  { name: 'taxi_vendor_internal_filter', type: 'intersect' },

  // --- Raw Interaction Signal ---
  // Receives the primitive, context-free predicate for a hovered row in the Trips table.
  { name: 'taxi_hover_raw', type: 'intersect', options: { empty: true } },
  
  // --- Composite Selections for UI Filtering ---
  // The main context filter for the dashboard.
  // In the current configuration, this selection is only updated by chart brushes,
  // and does NOT include the table's internal filters.
  { 
    name: 'taxi_filter', 
    type: 'intersect',
  },

  // The final, context-aware selection for the hover highlight effect on the map.
  // It combines all active filters WITH the raw hover signal from the table.
  {
    name: 'taxi_hover',
    type: 'intersect',
    options: {
      empty: true,
      include: ['taxi_filter', 'taxi_hover_raw', 'taxi_trips_internal_filter']
    }
  },
];

// --- FLIGHTS DASHBOARD INTERACTION GRAPH ---
const flightsSelections: SelectionConfig[] = [
  // Receives filter predicates from brushing the histograms.
  { name: 'flights_brush', type: 'intersect', options: { cross: true } },
  // Receives predicates from the table's internal column filters.
  { name: 'flights_internal_filter', type: 'intersect' },
  // Receives a union of predicates for all selected rows (via checkboxes).
  { name: 'flights_rowSelection', type: 'union', options: { empty: true } },

  // Composite selection that combines histogram brush and row selections.
  // In the current configuration, this does NOT include the table's internal filter.
  {
    name: 'flights_query',
    type: 'intersect',
    options: {
      include: ['flights_brush', 'flights_rowSelection']
    }
  }
];


// Combine all configurations into a single source of truth for the provider.
const allDashboardSelections = [...athleteSelections, ...taxiSelections, ...flightsSelections];

// App is now a simple tab container, managing which dashboard is visible.
export default function App() {
  const [activeTab, setActiveTab] = useState<'athletes' | 'taxis' | 'flights'>('athletes');

  return (
    // The provider is initialized ONCE with the complete application interaction graph.
    <MosaicProvider selections={allDashboardSelections}>
      <div>
        <nav>
          <button onClick={() => setActiveTab('athletes')} disabled={activeTab === 'athletes'}>
            Athletes Dashboard
          </button>
          <button onClick={() => setActiveTab('taxis')} disabled={activeTab === 'taxis'}>
            NYC Taxi Rides
          </button>
          <button onClick={() => setActiveTab('flights')} disabled={activeTab === 'flights'}>
            Flights Dashboard
          </button>
        </nav>
        <hr />
        {/* Conditional rendering based on the active tab */}
        <div style={{ display: activeTab === 'athletes' ? 'block' : 'none' }}>
          <AthletesDashboard />
        </div>
        <div style={{ display: activeTab === 'taxis' ? 'block' : 'none' }}>
          <NycTaxiDashboard />
        </div>
        <div style={{ display: activeTab === 'flights' ? 'block' : 'none' }}>
          <FlightsDashboard />
        </div>
      </div>
    </MosaicProvider>
  );
}