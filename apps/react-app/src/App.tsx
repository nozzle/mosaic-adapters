// apps/react-app/src/App.tsx
// This file defines the root component of the React application. It sets up the
// global Mosaic context with a declarative "interaction graph" for each dashboard
// and manages the top-level tabbed navigation between them.
import React, { useState } from 'react';
import { MosaicProvider, type SelectionConfig } from '@mosaic-tanstack/react';
import { AthletesDashboard } from './dashboards/AthletesDashboard';
import { NycTaxiDashboard } from './dashboards/NycTaxiDashboard';
import { FlightsDashboard } from './dashboards/FlightsDashboard';

// --- ATHLETES DASHBOARD INTERACTION GRAPH ---
// Defines the complete set of reactive variables (Selections) for this dashboard.
// This graph makes the flow of interactions explicit and manageable.
const athleteSelections: SelectionConfig[] = [
  // --- ATOMIC SELECTIONS: Direct sources of user interaction ---
  // 1. From dropdown menus for Sport and Sex, and the Name search box.
  { name: 'athlete_category', type: 'intersect' },
  // 2. From the interactive brush on the vgplot scatterplot.
  { name: 'athlete_brush', type: 'intersect' },
  // 3. From the Tanstack table's own internal filters (column search, global search).
  { name: 'athlete_internal_filter', type: 'intersect' },
  // 4. From the table's row selection checkboxes. Uses 'union' to combine multiple rows.
  { name: 'athlete_rowSelection', type: 'union', options: { empty: true } },
  
  // --- RAW HOVER SIGNAL: A primitive for hover effects ---
  // Captures the predicate of the single, currently hovered row, without any other context.
  // It is set to be empty by default to prevent highlighting on load.
  { name: 'athlete_hover_raw', type: 'intersect', options: { empty: true } },

  // --- COMPOSITE SELECTIONS: Derived states for filtering UI components ---
  
  // A selection that combines ALL filters EXTERNAL to the table.
  // This is the clean, unidirectional input that the table's `filterBy` prop will listen to.
  {
    name: 'athlete_external_filter',
    type: 'intersect',
    options: {
      include: ['athlete_category', 'athlete_brush']
    }
  },

  // The "master" filter for the dashboard's vgplot visuals.
  // It combines everything: external filters (menus, brush) and the table's own state
  // (internal filters, selected rows) to create the complete filtering context.
  { 
    name: 'athlete_query', 
    type: 'intersect', 
    options: { 
      include: [
        'athlete_external_filter', // Includes menus and brush
        'athlete_rowSelection',
      ] 
    } 
  },

  // The final, context-aware selection for the hover highlight effect.
  // It combines the master filter context with the raw hover signal, ensuring that
  // only currently visible points can be highlighted.
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
  // Atomic selections from user interactions
  { name: 'taxi_rowSelection', type: 'union', options: { empty: true } },
  { name: 'taxi_trips_internal_filter', type: 'intersect' },
  { name: 'taxi_vendor_internal_filter', type: 'intersect' },
  { name: 'taxi_hover_raw', type: 'intersect', options: { empty: true } },
  { name: 'taxi_brush', type: 'intersect' }, // Dedicated selection for map/chart brushes

  // Composite Selections for UI Filtering
  // A clean separation: external filters for the tables.
  { 
    name: 'taxi_external_filter', 
    type: 'intersect',
    options: {
      include: ['taxi_brush']
    }
  },
  // The master filter for the entire dashboard, combining all sources.
  {
    name: 'taxi_query',
    type: 'intersect',
    options: {
      include: ['taxi_external_filter', 'taxi_trips_internal_filter', 'taxi_vendor_internal_filter', 'taxi_rowSelection']
    }
  },
  // Context-aware hover selection
  {
    name: 'taxi_hover',
    type: 'intersect',
    options: {
      empty: true,
      include: ['taxi_query', 'taxi_hover_raw']
    }
  },
];


// --- FLIGHTS DASHBOARD INTERACTION GRAPH ---
const flightsSelections: SelectionConfig[] = [
  // Atomic selections from user interactions
  { name: 'flights_brush', type: 'intersect', options: { cross: true } },
  { name: 'flights_internal_filter', type: 'intersect' },
  { name: 'flights_rowSelection', type: 'union', options: { empty: true } },

  // Composite Selections for UI Filtering
  // External filters that the table will be filtered by.
  {
    name: 'flights_external_filter',
    type: 'intersect',
    options: {
      include: ['flights_brush']
    }
  },
  // The master filter for vgplot visuals, combining external and internal table filters.
  {
    name: 'flights_query',
    type: 'intersect',
    options: {
      include: ['flights_external_filter', 'flights_internal_filter', 'flights_rowSelection']
    }
  }
];

// Combine all configurations into a single source of truth for the provider.
const allDashboardSelections = [...athleteSelections, ...taxiSelections, ...flightsSelections];

// The root App component is a simple tab container that renders the active dashboard.
export default function App() {
  const [activeTab, setActiveTab] = useState<'athletes' | 'taxis' | 'flights'>('athletes');

  return (
    // The provider is initialized ONCE with the complete application interaction graph.
    // It makes all defined selections available to any descendant component via the
    // `useMosaicSelection` hook.
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
        {/* Conditional rendering based on the active tab state */}
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