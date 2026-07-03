import { Param, Selection } from '@uwdata/mosaic-core';
import { createFilterSet } from '@nozzleio/react-mosaic';

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
 * The table's column filters flow through the TanStack bridge as
 * {@link FilterSpec}s on this module-scope set, which publishes them as clauses
 * on `$page` (target `where`). The specs carry no `clients`, so — exactly like
 * the old direct-Selection bridge — the table is filtered by its own column
 * filters while every sibling widget sees them too.
 */
export const filterSet = createFilterSet({ targets: { where: $page } });

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
