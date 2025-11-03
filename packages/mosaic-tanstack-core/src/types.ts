// packages/mosaic-tanstack-core/src/types.ts
// This file centralizes all TypeScript type definitions. It has been refactored
// to make the `DataTableOptions` the single source of truth for configuration,
// accepting a `logic` config and an optional `ui` config directly, which
// simplifies the API contract for creating a new DataTable instance.
import { Selection, type SQLAst } from '@uwdata/mosaic-core';
import { 
    type TableOptions, type ColumnDef, type TableState
} from '@tanstack/table-core';

export interface CustomTableMeta<TData extends object> {
    onRowHover?: (row: TData | null) => void;
    onRowClick?: (row: TData | null) => void;
    hasGlobalFilter?: boolean;
    toggleSelectAll?: (value: boolean) => void;
}

export interface CustomColumnMeta<TData extends object, TValue> {
    Filter?: any;
    enableGlobalFilter?: boolean;
}

declare module '@tanstack/table-core' {
    interface TableMeta<TData extends object> extends CustomTableMeta<TData> {}
    interface ColumnMeta<TData extends object, TValue> extends CustomColumnMeta<TData, TValue> {}
    interface TableState {
        isSelectAll: boolean;
    }
}

export interface MosaicColumnDef<TData extends object> extends ColumnDef<TData> {
    sql?: string | SQLAst;
}

export type LogicColumnDef<T extends object> = Omit<MosaicColumnDef<T>, 'header' | 'cell' | 'meta'> & {
    meta?: { enableGlobalFilter?: boolean; }
};

export interface ColumnUIConfig<T extends object> {
    header?: ColumnDef<T, unknown>['header'] | any;
    cell?: ColumnDef<T, unknown>['cell'] | any;
    meta?: { Filter?: any; };
}

export type DataTableUIConfig<T extends object> = { [columnId in string]?: ColumnUIConfig<T>; };

export interface InteractionConfig<T extends object> { createPredicate: (row: T) => SQLAst | null; }

export interface DataTableLogicConfig<T extends object> {
    name: string;
    sourceTable?: string; 
    columns: LogicColumnDef<T>[];
    getBaseQuery: (filters: { where?: any; having?: any }) => any; // Return type is Query
    groupBy?: string[];
    primaryKey?: string[];
    hoverInteraction?: InteractionConfig<T>;
    clickInteraction?: InteractionConfig<T>;
    options?: Omit<TableOptions<T>, 'data' | 'columns' | 'state' | 'onStateChange' | 'renderFallbackValue' | 'pageCount' | 'meta' | 'getRowId'>;
}

export interface DataTableOptions<TData extends object> {
  logic: DataTableLogicConfig<TData>;
  ui?: DataTableUIConfig<TData>;
  initialState?: Partial<TableState>;
  filterBy?: Selection;
  internalFilter?: Selection;
  rowSelectionAs?: Selection;
  hoverAs?: Selection;
  clickAs?: Selection;
}

export interface DataTableSnapshot<TData extends object> {
    table: any; // Return type is Table<TData>
    data: TData[];
    totalRows: number;
    isDataLoaded: boolean;
    isFetching: boolean;
    isLookupPending: boolean;
    error: Error | null;
}

export type LoadingState = 'idle' | 'fetching' | 'lookup';

export enum QueryType {
    DATA = 'DATA',
    TOTAL_COUNT = 'TOTAL_COUNT',
}