// src/tables/trips/logic.ts
// This file contains the framework-agnostic data and logic configuration for the Trips table.
// It has no dependencies on React or any UI library.
import {
	DataTableLogicConfig,
	TripSummary,
} from "../../../../../packages/mosaic-tanstack-table-core/src";
import * as vg from "@uwdata/vgplot";
import { Query, sql, and, eq, literal } from "@uwdata/mosaic-sql";

export const tripsLogicConfig: DataTableLogicConfig<TripSummary> = {
	name: "TripsSummaryTable",
	groupBy: ["zone_x", "zone_y"],
	columns: [
		{
			id: "dropoff_zone",
			accessorKey: "dropoff_zone",
			enableSorting: false,
			enableColumnFilter: false,
		},
		{ id: "trip_count", accessorKey: "trip_count", enableColumnFilter: false },
		{ id: "avg_fare", accessorKey: "avg_fare", enableColumnFilter: false },
		{
			id: "avg_distance",
			accessorKey: "avg_distance",
			enableColumnFilter: false,
		},
		{
			id: "avg_tip_pct",
			accessorKey: "avg_tip_pct",
			enableColumnFilter: false,
		},
	],
	getBaseQuery: (filters) => {
		const { where = [], having = [] } = filters;
		const ZONE_SIZE = 1000;

		const aggregation = Query.from("trips")
			.where(where)
			.select({
				zone_x: vg.sql`round(dx / ${ZONE_SIZE})`,
				zone_y: vg.sql`round(dy / ${ZONE_SIZE})`,
				trip_count: vg.count(),
				avg_fare: vg.avg("total_amount"),
				avg_distance: vg.avg("trip_distance"),
				avg_tip_pct: vg.avg(vg.sql`tip_amount / fare_amount`),
			})
			.groupby("zone_x", "zone_y")
			.having(having);

		return Query.from(aggregation).select("*", {
			dropoff_zone: vg.sql`'(' || zone_x || ', ' || zone_y || ')'`,
		});
	},
	hoverInteraction: {
		createPredicate: (row) => {
			if (row.zone_x == null || row.zone_y == null) return null;
			const ZONE_SIZE = 1000;
			return and(
				eq(sql`round(dx / ${ZONE_SIZE})`, literal(row.zone_x)),
				eq(sql`round(dy / ${ZONE_SIZE})`, literal(row.zone_y))
			);
		},
	},
	options: {
		enableRowSelection: false,
		autoResetPageIndex: false,
		initialState: {
			sorting: [{ id: "trip_count", desc: true }],
		},
	},
};
