// src/tables/flights/logic.ts
// This file contains the framework-agnostic data and logic configuration for the Flights table.
import { DataTableLogicConfig, Flight } from '@mosaic-tanstack/core';
import { Query } from '@uwdata/mosaic-sql';

export const flightsLogicConfig: DataTableLogicConfig<Flight> = {
    name: 'FlightsTable',
    // A unique ID is required for row selection to work correctly.
    primaryKey: ['id'],
    columns: [
        { id: 'select', size: 40, enableSorting: false, enableColumnFilter: false },
        { id: 'id', accessorKey: 'id', enableSorting: true, enableColumnFilter: true, meta: { enableGlobalFilter: true } },
        { id: 'delay', accessorKey: 'delay', enableSorting: true, enableColumnFilter: true },
        { id: 'distance', accessorKey: 'distance', enableSorting: true, enableColumnFilter: true },
        { id: 'time', accessorKey: 'time', enableSorting: true, enableColumnFilter: true },
    ],
    // The base query is simple as we are showing raw (not aggregated) data.
    // The `where` filter will be applied automatically by the adapter.
    // FIX: Explicitly select all columns, including `id`, to ensure it's always
    // present in the data payload, which fixes both the SQL Binder Error and
    // the React key warning.
    getBaseQuery: (filters) => {
        const { where = [] } = filters;
        return Query.from('flights_10m').where(where).select('id', 'delay', 'distance', 'time');
    },
    // Enable row selection so this table can filter the histograms.
    options: {
        enableRowSelection: true,
        autoResetPageIndex: false,
        autoResetRowSelection: false,
    }
};