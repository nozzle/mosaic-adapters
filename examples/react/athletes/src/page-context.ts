import { Param, Selection } from '@uwdata/mosaic-core';

export const tableName = 'athletes';

/**
 * One crossfilter Selection is the page's entire filter context. Every filter
 * UI publishes clauses into it; every client consumes it. Native cross-mode
 * resolution excludes each publisher from its own clause, so the scatterplot
 * brush never filters the scatterplot itself — while the table's column
 * filters (published without a `clients` set) do filter the table. No
 * SelectionManager, no tableFilterSelection, no adapter topology concepts.
 */
export const $page = Selection.crossfilter();

/**
 * Rows picked in the table fan out to whatever wants them (detail panes,
 * comparison views). Deliberately NOT part of $page — no feedback loop.
 */
export const $picked = Selection.union();

export type MedalMetric = 'gold' | 'silver' | 'bronze';

/**
 * Drives which medal column the KPI aggregates. A Param 'value' event
 * re-queries every client that lists it in `params` (our wiring — upstream
 * never re-queries on Param changes automatically).
 */
export const $metric = Param.value<MedalMetric>('gold');

export interface AthleteRow {
  id: number;
  name: string;
  nationality: string;
  sport: string;
  sex: string;
  height: number | null;
  weight: number | null;
  gold: number;
}
