// src/selections.ts
// This file centralizes the declarative definition of the application's entire
// interaction graph, exporting all Mosaic selection configurations.

import type { SelectionConfig } from '@nozzle/mosaic-tanstack-svelte-table';

// --- ATHLETES DASHBOARD INTERACTION GRAPH ---
const athleteSelections: Array<SelectionConfig> = [
  { name: 'athlete_category', type: 'intersect' },
  { name: 'athlete_brush', type: 'intersect' },
  { name: 'athlete_internal_filter', type: 'intersect' },
  { name: 'athlete_rowSelection', type: 'union', options: { empty: true } },
  { name: 'athlete_hover_raw', type: 'intersect', options: { empty: true } },
  {
    name: 'athlete_external_filter',
    type: 'intersect',
    options: { include: ['athlete_category', 'athlete_brush'] },
  },
  {
    name: 'athlete_query',
    type: 'intersect',
    options: { include: ['athlete_external_filter', 'athlete_rowSelection'] },
  },
  {
    name: 'athlete_hover',
    type: 'intersect',
    options: { empty: true, include: ['athlete_query', 'athlete_hover_raw'] },
  },
];

// --- NYC TAXI DASHBOARD INTERACTION GRAPH ---
const taxiSelections: Array<SelectionConfig> = [
  { name: 'taxi_rowSelection', type: 'union', options: { empty: true } },
  { name: 'taxi_trips_internal_filter', type: 'intersect' },
  { name: 'taxi_vendor_internal_filter', type: 'intersect' },
  { name: 'taxi_hover_raw', type: 'intersect', options: { empty: true } },
  { name: 'taxi_brush', type: 'intersect' },
  {
    name: 'taxi_external_filter',
    type: 'intersect',
    options: { include: ['taxi_brush'] },
  },
  {
    name: 'taxi_query',
    type: 'intersect',
    options: {
      include: [
        'taxi_external_filter',
        'taxi_trips_internal_filter',
        'taxi_vendor_internal_filter',
        'taxi_rowSelection',
      ],
    },
  },
  {
    name: 'taxi_hover',
    type: 'intersect',
    options: { empty: true, include: ['taxi_query', 'taxi_hover_raw'] },
  },
];

// --- FLIGHTS DASHBOARD INTERACTION GRAPH ---
const flightsSelections: Array<SelectionConfig> = [
  { name: 'flights_brush', type: 'intersect', options: { cross: true } },
  { name: 'flights_internal_filter', type: 'intersect' },
  { name: 'flights_rowSelection', type: 'union', options: { empty: true } },
  {
    name: 'flights_external_filter',
    type: 'intersect',
    options: { include: ['flights_brush', 'flights_rowSelection'] },
  },
  {
    name: 'flights_query',
    type: 'intersect',
    options: {
      include: ['flights_external_filter', 'flights_internal_filter'],
    },
  },
];

// Combine all configurations into a single source of truth.
export const allDashboardSelections = [
  ...athleteSelections,
  ...taxiSelections,
  ...flightsSelections,
];