// Distribution model: users install this package only. The framework-agnostic
// TanStack Table glue core is a regular dependency whose public API is re-exported
// in full (the @tanstack/react-table model) — anything a consumer needs from
// the glue core is importable from here.
export * from '@nozzleio/mosaic-tanstack-table-core';

export {
  useTanStackTableFilterBridge,
  useTanStackFilterBridge,
} from './use-tanstack-table-filter-bridge';
export type {
  UseTanStackTableFilterBridgeOptions,
  UseTanStackFilterBridgeOptions,
} from './use-tanstack-table-filter-bridge';
