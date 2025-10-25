// src/lib/tables/types.ts
// This file defines the formal TypeScript "contract" that separates data/logic
// configurations from UI/rendering configurations for data tables.
import type { ComponentType } from 'svelte';
import type { MosaicColumnDef, DataTableOptions } from '@mosaic-tanstack/core';
import type { Query } from '@uwdata/mosaic-sql';
import type { SQLAst } from '@uwdata/mosaic-core';
import type { Column, ColumnDef, Table } from '@tanstack/table-core';

export interface CustomTableMeta<TData extends object> {
    onRowHover?: (row: TData | null) => void;
    onRowClick?: (row: TData | null) => void;
    hasGlobalFilter?: boolean;
}

export interface CustomColumnMeta<TData extends object, TValue> {
    Filter?: ComponentType<{ column: Column<TData, TValue> }>;
    enableGlobalFilter?: boolean;
}

declare module '@tanstack/table-core' {
    interface TableMeta<TData extends object> extends CustomTableMeta<TData> {}
    interface ColumnMeta<TData extends object, TValue> extends CustomColumnMeta<TData, TValue> {}
}

export type LogicColumnDef<T extends object> = Omit<MosaicColumnDef<T>, 'header' | 'cell' | 'meta'> & {
    meta?: { enableGlobalFilter?: boolean; }
};

export interface ColumnUIConfig<T extends object> {
    header?: ColumnDef<T, unknown>['header'] | ComponentType;
    cell?: ColumnDef<T, unknown>['cell'] | ComponentType;
    meta?: { Filter?: ComponentType<{ column: any }>; };
}

export type DataTableUIConfig<T extends object> = { [columnId in string]?: ColumnUIConfig<T>; };

export interface InteractionConfig<T extends object> { createPredicate: (row: T) => SQLAst | null; }

interface BaseDataTableLogicConfig<T extends object> {
    name: string;
    columns: LogicColumnDef<T>[];
    getBaseQuery: (filters: { where?: any; having?: any }) => Query;
    groupBy?: string[];
    hoverInteraction?: InteractionConfig<T>;
    clickInteraction?: InteractionConfig<T>;
}

interface LogicConfigWithoutRowSelection<T extends object> extends BaseDataTableLogicConfig<T> {
    primaryKey?: string[];
    options?: Omit<DataTableOptions<T>, 'meta' | 'enableRowSelection'> & { enableRowSelection?: false; };
}

interface LogicConfigWithRowSelection<T extends object> extends BaseDataTableLogicConfig<T> {
    primaryKey: string[];
    options: Omit<DataTableOptions<T>, 'meta' | 'enableRowSelection'> & { enableRowSelection: true; };
}

export type DataTableLogicConfig<T extends object> = | LogicConfigWithoutRowSelection<T> | LogicConfigWithRowSelection<T>;