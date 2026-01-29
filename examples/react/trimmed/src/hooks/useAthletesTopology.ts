/**
 * Hook for the Athletes view topology.
 * Defines the topological relationships between selections for the Athletes Dashboard.
 * Uses the Functional Topology Pattern - all selections are created inside React
 * so they're properly recreated on mode switches.
 */
import { useMemo } from 'react';
import * as vg from '@uwdata/vgplot';
import {
  useMosaicSelection,
  useRegisterSelections,
} from '@nozzleio/react-mosaic';

export function useAthletesTopology() {
  // 1. Instantiate Selections (Stable Identities via useMemo inside hook)
  // These will be recreated when the component remounts (e.g., on mode switch)
  const $query = useMosaicSelection('intersect');
  const $tableFilter = useMosaicSelection('intersect');
  const $weight = useMosaicSelection('intersect');
  const $height = useMosaicSelection('intersect');

  // Register selections with the global reset context
  useRegisterSelections([$query, $tableFilter, $weight, $height]);

  // 2. Define Contexts (Derived Selections)
  // Weight Histogram Context: Everything EXCEPT Weight (prevents self-filtering)
  const $ctxWeight = useMemo(
    () =>
      vg.Selection.intersect({
        include: [$query, $tableFilter, $height],
      }),
    [$query, $tableFilter, $height],
  );

  // Height Histogram Context: Everything EXCEPT Height
  const $ctxHeight = useMemo(
    () =>
      vg.Selection.intersect({
        include: [$query, $tableFilter, $weight],
      }),
    [$query, $tableFilter, $weight],
  );

  // Table Context: Everything EXCEPT Table Filters (handled internally by table prop)
  // The table receives filters from Inputs and Histograms.
  const $tableContext = useMemo(
    () =>
      vg.Selection.intersect({
        include: [$query, $weight, $height],
      }),
    [$query, $weight, $height],
  );

  // Global Combined: The Intersection of All Filters (Used for the Chart points)
  const $combined = useMemo(
    () =>
      vg.Selection.intersect({
        include: [$query, $tableFilter, $weight, $height],
      }),
    [$query, $tableFilter, $weight, $height],
  );

  return {
    // Base selections
    $query,
    $tableFilter,
    $weight,
    $height,
    // Derived contexts
    $ctxWeight,
    $ctxHeight,
    $tableContext,
    $combined,
  };
}
