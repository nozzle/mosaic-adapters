// packages/mosaic-tanstack-react/src/types.ts
// This file defines the formal TypeScript "contract" for the React adapter.
// It imports the generic types from the core package and extends them with
// React-specific types, ensuring strong type safety for React developers
// using the adapter.
import type { ComponentType } from "react";
import type {
	ColumnUIConfig as CoreColumnUIConfig,
	MosaicColumnDef as CoreMosaicColumnDef,
	DataTableOptions as CoreDataTableOptions,
	DataTableLogicConfig as CoreDataTableLogicConfig,
} from "../../mosaic-tanstack-table-core/src";
import type { Column, ColumnDef } from "@tanstack/table-core";

// Re-export core types for convenience
export * from "../../mosaic-tanstack-table-core/src";

// Create a React-specific ColumnUIConfig that enforces React component types.
export interface ColumnUIConfig<T extends object>
	extends CoreColumnUIConfig<T> {
	header?: ColumnDef<T, unknown>["header"] | ComponentType;
	cell?: ColumnDef<T, unknown>["cell"] | ComponentType;
	meta?: { Filter?: ComponentType<{ column: any }> };
}

// The top-level UI config now uses our new, strongly-typed interface.
export type DataTableUIConfig<T extends object> = {
	[columnId in string]?: ColumnUIConfig<T>;
};
