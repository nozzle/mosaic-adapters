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

export { useVgPlot } from './use-vg-plot';
export type { VgPlotElement } from './use-vg-plot';
