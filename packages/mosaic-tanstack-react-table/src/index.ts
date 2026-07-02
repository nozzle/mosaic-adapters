// Distribution model: users install this package only. The framework-agnostic
// TanStack glue core is a regular dependency whose public API is re-exported
// in full (the @tanstack/react-table model) — anything a consumer needs from
// the glue core is importable from here.
export * from '@nozzleio/mosaic-tanstack-table-core';

export { useTanStackFilterBridge } from './use-tanstack-filter-bridge';
export type { UseTanStackFilterBridgeOptions } from './use-tanstack-filter-bridge';
