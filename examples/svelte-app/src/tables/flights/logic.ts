// src/lib/tables/flights/logic.ts
// This file contains the framework-agnostic data and logic configuration for the Flights table.
import type {
	DataTableLogicConfig,
	Flight,
} from "@nozzle/mosaic-tanstack-table-core";
import { Query } from "@uwdata/mosaic-sql";

export const flightsLogicConfig: DataTableLogicConfig<Flight> = {
	name: "FlightsTable",
	primaryKey: ["id"],
	columns: [
		{ id: "select", size: 40, enableSorting: false, enableColumnFilter: false },
		{
			id: "id",
			accessorKey: "id",
			enableSorting: true,
			enableColumnFilter: true,
			meta: { enableGlobalFilter: true },
		},
		{
			id: "delay",
			accessorKey: "delay",
			enableSorting: true,
			enableColumnFilter: true,
		},
		{
			id: "distance",
			accessorKey: "distance",
			enableSorting: true,
			enableColumnFilter: true,
		},
		{
			id: "time",
			accessorKey: "time",
			enableSorting: true,
			enableColumnFilter: true,
		},
	],
	getBaseQuery: (filters) => {
		const { where = [] } = filters;
		return Query.from("flights_10m")
			.where(where)
			.select("id", "delay", "distance", "time");
	},
	options: {
		enableRowSelection: true,
		autoResetPageIndex: false,
		autoResetRowSelection: false,
	},
};
