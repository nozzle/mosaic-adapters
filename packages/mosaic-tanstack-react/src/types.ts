// src/tables/types.ts
// This file defines the formal TypeScript "contract" that separates data/logic
// configurations from UI/rendering configurations for data tables.
import { MosaicColumnDef } from '../mosaic-tanstack-adapter/DataTable';
import { Query } from '@uwdata/mosaic-sql';
import { SQLAst } from '@uwdata/mosaic-core';
import { Column, ColumnDef, Table } from '@tanstack/table-core';
import React from 'react';

// --- START: NEW TYPE DEFINITIONS & MODULE AUGMENTATION ---

/**
 * Defines the custom properties we expect on the table-wide `meta` object.
 */
export interface CustomTableMeta<TData extends object> {
    onRowHover?: (row: TData | null) => void;
    onRowClick?: (row: TData | null) => void;
    hasGlobalFilter?: boolean;
}

/**
 * Defines the custom properties we expect on a per-column `meta` object.
 */
export interface CustomColumnMeta<TData extends object, TValue> {
    Filter?: React.ComponentType<{ column: Column<TData, TValue> }>;
    enableGlobalFilter?: boolean;
}

// Use module augmentation to merge our custom meta types with Tanstack's.
// This teaches TypeScript about the shape of our `meta` objects.
declare module '@tanstack/table-core' {
    interface TableMeta<TData extends object> extends CustomTableMeta<TData> {}
    interface ColumnMeta<TData extends object, TValue> extends CustomColumnMeta<TData, TValue> {}
}

// --- END: NEW TYPE DEFINITIONS & MODULE AUGMENTATION ---


// This defines a column's LOGIC properties, explicitly omitting UI renderers.
export type LogicColumnDef<T extends object> = Omit<
    MosaicColumnDef<T>, 
    'header' | 'cell' | 'meta' // Omit all potentially UI-related properties
> & {
    // Re-add a strictly-typed meta object that ONLY allows non-UI properties.
    meta?: {
        enableGlobalFilter?: boolean;
    }
};

// Defines the shape of the UI configuration for a single column.
// It includes all the properties that were omitted from LogicColumnDef.
export interface ColumnUIConfig<T extends object> {
    header?: ColumnDef<T, unknown>['header'];
    cell?: ColumnDef<T, unknown>['cell'];
    meta?: {
        Filter?: React.ComponentType<{ column: any }>; // Explicitly type the Filter component
    };
}

// Defines the top-level UI configuration object as a map
// from a column ID (string) to its specific UI config.
export type DataTableUIConfig<T extends object> = {
    [columnId in string]?: ColumnUIConfig<T>;
};

// A clear contract for how to create a predicate from a single data row.
// This will be used for point-based interactions like hover and click.
export interface InteractionConfig<T extends object> {
  createPredicate: (row: T) => SQLAst | null;
}

// This defines the shape of our new, framework-agnostic logic config objects.
// It is now strictly enforced to contain no UI-rendering code.
export interface DataTableLogicConfig<T extends object> {
    name: string;
    /**
     * An array of column IDs that form the composite primary key for a row.
     * If provided, the adapter will automatically generate the required `getRowId`
     * function for Tanstack Table and handle predicate generation for row selection.
     */
    primaryKey?: (keyof T & string)[];
    columns: LogicColumnDef<T>[];
    getBaseQuery: (filters: { where?: any; having?: any }) => Query;
    groupBy?: string[];
    hoverInteraction?: InteractionConfig<T>;
    clickInteraction?: InteractionConfig<T>;
    options?: Omit<Parameters<typeof createDataTable>[0], 'meta'>;
}