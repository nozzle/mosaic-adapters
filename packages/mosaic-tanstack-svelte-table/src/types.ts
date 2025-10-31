// packages/mosaic-tanstack-svelte/src/types.ts
// This file defines the formal TypeScript "contract" for the Svelte adapter.
// It imports the generic types from the core package and extends them with
// Svelte-specific types, ensuring strong type safety for Svelte developers
// using the adapter.
import type { ComponentType } from "svelte";
import type {
	ColumnUIConfig as CoreColumnUIConfig,
	MosaicColumnDef as CoreMosaicColumnDef,
	DataTableOptions as CoreDataTableOptions,
	DataTableLogicConfig as CoreDataTableLogicConfig,
} from "../../mosaic-tanstack-table-core/src";
import type { Column, ColumnDef } from "@tanstack/table-core";

// Re-export core types for convenience
export * from "../../mosaic-tanstack-table-core/src";

// Create a Svelte-specific ColumnUIConfig that enforces Svelte component types.
export interface ColumnUIConfig<T extends object>
	extends CoreColumnUIConfig<T> {
	header?: ColumnDef<T, unknown>["header"] | ComponentType;
	cell?: ColumnDef<T, unknown>["cell"] | ComponentType;
	// @ts-expect-error Type '{ column: any; }' does not satisfy the constraint 'SvelteComponent<any, any, any>'. Type '{ column: any; }' is missing the following properties from type 'SvelteComponent<any, any, any>': $$prop_def, $$events_def, $$slot_def, $capture_state, and 6 more.
	meta?: { Filter?: ComponentType<{ column: any }> };
}

// The top-level UI config now uses our new, strongly-typed interface.
export type DataTableUIConfig<T extends object> = {
	[columnId in string]?: ColumnUIConfig<T>;
};
