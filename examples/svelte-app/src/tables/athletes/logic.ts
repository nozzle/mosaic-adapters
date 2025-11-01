// src/lib/tables/athletes/logic.ts
// This file contains the framework-agnostic data and logic configuration for the Athletes table.
import type {
	DataTableLogicConfig,
	Athlete,
} from "@nozzle/mosaic-tanstack-table-core";
import * as vg from "@uwdata/vgplot";
import { desc, Query, eq, literal } from "@uwdata/mosaic-sql";

export const athletesLogicConfig: DataTableLogicConfig<Athlete> = {
	name: "AthletesTable",
	primaryKey: ["name", "nationality", "sport", "sex", "height", "weight"],
	columns: [
		{ id: "select", size: 40, enableSorting: false, enableColumnFilter: false },
		{
			id: "rank",
			accessorKey: "rank",
			enableSorting: true,
			enableColumnFilter: false,
		},
		...["name", "nationality", "sex", "height", "weight", "sport"].map(
			(id) => ({
				id: id,
				accessorKey: id as keyof Athlete,
				enableSorting: true,
				enableColumnFilter: true,
				meta: {
					enableGlobalFilter: ["name", "nationality", "sport"].includes(id),
				},
			})
		),
	],
	getBaseQuery: (filters) => {
		const { where = [] } = filters;
		const rankExpression = vg.rank().orderby(desc("height"));
		return Query.from("athletes")
			.where(where)
			.select("*", { rank: rankExpression });
	},
	hoverInteraction: {
		createPredicate: (row) => eq("name", literal(row.name)),
	},
	options: {
		enableRowSelection: true,
		autoResetPageIndex: false,
		autoResetRowSelection: false,
	},
};
