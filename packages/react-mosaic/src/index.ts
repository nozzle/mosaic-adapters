// Distribution model: users install this package only. The framework-agnostic
// core is a regular dependency whose public API is re-exported in full (the
// @tanstack/react-table model) — anything a consumer needs from the core is
// importable from here.
export * from '@nozzleio/mosaic-core';

export { MosaicProvider, useMosaicCoordinator } from './context';
export type { MosaicProviderProps } from './context';

export { useMosaicRows } from './use-mosaic-rows';
export type {
  UseMosaicRowsOptions,
  UseMosaicRowsResult,
} from './use-mosaic-rows';

export { useMosaicValues } from './use-mosaic-values';
export type {
  UseMosaicValuesOptions,
  UseMosaicValuesResult,
} from './use-mosaic-values';

export { useMosaicFacet } from './use-mosaic-facet';
export type {
  UseMosaicFacetOptions,
  UseMosaicFacetResult,
} from './use-mosaic-facet';

export { useMosaicHistogram } from './use-mosaic-histogram';
export type {
  UseMosaicHistogramOptions,
  UseMosaicHistogramResult,
} from './use-mosaic-histogram';

export { useMosaicSparkline } from './use-mosaic-sparkline';
export type {
  UseMosaicSparklineOptions,
  UseMosaicSparklineResult,
} from './use-mosaic-sparkline';

export { useMosaicRollup } from './use-mosaic-rollup';
export type {
  UseMosaicRollupOptions,
  UseMosaicRollupResult,
} from './use-mosaic-rollup';

export { useMosaicPivot } from './use-mosaic-pivot';
export type {
  UseMosaicPivotOptions,
  UseMosaicPivotResult,
} from './use-mosaic-pivot';

export { useMosaicSchema } from './use-mosaic-schema';
export type {
  UseMosaicSchemaOptions,
  UseMosaicSchemaResult,
} from './use-mosaic-schema';

export { useVgPlot } from './use-vg-plot';
export type { VgPlotElement } from './use-vg-plot';

export {
  useCascadingContexts,
  useComposedSelection,
  useMosaicSelection,
  useMosaicSelections,
} from './use-topology-helpers';

export { useTopology } from './use-topology';

export {
  MosaicTopologyProvider,
  useMosaicSelectionRef,
  useMosaicTopology,
} from './topology-context';
export type { MosaicTopologyProviderProps } from './topology-context';

export {
  useMosaicActiveClauses,
  useTopologyActiveClauses,
} from './use-topology-active-clauses';

export { useMosaicSelectionValue } from './use-mosaic-selection-value';
export type { UseMosaicSelectionValueOptions } from './use-mosaic-selection-value';

export { useFilterSetChips, useFilterSetState } from './use-filter-set';
