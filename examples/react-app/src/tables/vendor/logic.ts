// src/tables/vendor/logic.ts
// This file contains the framework-agnostic data and logic configuration for the Vendor Stats table.
// It has no dependencies on React or any UI library and encapsulates a complex multi-CTE SQL query.
import {
	DataTableLogicConfig,
	VendorSummary,
} from "@nozzle/mosaic-tanstack-table-core";
import * as vg from "@uwdata/vgplot";
import { Query } from "@uwdata/mosaic-sql";

export const vendorStatsLogicConfig: DataTableLogicConfig<VendorSummary> = {
	name: "VendorStatsTable",
	groupBy: ["vendor_id"],
	columns: [
		{
			id: "vendor_id",
			accessorKey: "vendor_id",
			enableSorting: true,
			enableColumnFilter: true,
			meta: { enableGlobalFilter: true },
		},
		{
			id: "daily_revenue",
			accessorKey: "daily_revenue",
			enableSorting: false,
			enableColumnFilter: false,
			size: 200,
		},
		{ id: "trip_count", accessorKey: "trip_count", enableColumnFilter: false },
		{
			id: "market_share",
			accessorKey: "market_share",
			enableColumnFilter: false,
		},
		{
			id: "total_revenue",
			accessorKey: "total_revenue",
			enableColumnFilter: false,
		},
		{ id: "avg_fare", accessorKey: "avg_fare", enableColumnFilter: false },
		{
			id: "avg_tip_pct",
			accessorKey: "avg_tip_pct",
			enableColumnFilter: false,
		},
		{
			id: "avg_distance",
			accessorKey: "avg_distance",
			enableColumnFilter: false,
		},
	],
	getBaseQuery: (filters) => {
		const { where = [], having = [] } = filters;

		const transformedRidesCTE = Query.from("rides").select("*", {
			day: vg.sql`DATE_TRUNC('day', datetime)`,
			time: vg.sql`(HOUR(datetime) + MINUTE(datetime)/60)`,
			px: vg.sql`ST_X(pick)`,
			py: vg.sql`ST_Y(pick)`,
			dx: vg.sql`ST_X(drop)`,
			dy: vg.sql`ST_Y(drop)`,
		});

		// FIX: The filteredRidesCTE must have a selection list. Added .select('*').
		// This ensures all columns from transformed_rides are passed through after filtering.
		const filteredRidesCTE = Query.from("transformed_rides")
			.where(where)
			.select("*");

		const dailyRevenuesSparseCTE = Query.from("filtered_rides")
			.select({
				vendor_id: "vendor_id",
				day: "day",
				total_revenue: vg.sum("total_amount"),
			})
			.groupby("vendor_id", "day");
		const allDaysCTE = Query.from("filtered_rides")
			.select({ day: "day" })
			.distinct();
		const allVendorsCTE = Query.from("filtered_rides")
			.select({ vendor_id: "vendor_id" })
			.distinct();
		const scaffoldCTE = Query.from("all_vendors", "all_days").select("*");
		const denseDailyRevenuesCTE = Query.from(
			vg.sql`(SELECT s.vendor_id, s.day, COALESCE(drs.total_revenue, 0) AS total_revenue FROM scaffold AS s LEFT JOIN daily_revenues_sparse AS drs ON s.vendor_id = drs.vendor_id AND s.day = drs.day)`
		).select("*");
		const dailyRevenuesNestedCTE = Query.from("dense_daily_revenues")
			.select({
				vendor_id: "vendor_id",
				daily_revenue: vg.sql`ARRAY_AGG(total_revenue ORDER BY day)`,
				start_date: vg.min("day"),
				end_date: vg.max("day"),
			})
			.groupby("vendor_id");
		const vendorStatsCTE = Query.from("filtered_rides")
			.select({
				vendor_id: "vendor_id",
				trip_count: vg.count(),
				market_share: vg.sql`count(*) / (SELECT count(*) FROM filtered_rides)`,
				total_revenue: vg.sum("total_amount"),
				avg_fare: vg.avg("total_amount"),
				avg_tip_pct: vg.avg(
					vg.sql`CASE WHEN fare_amount > 0 THEN tip_amount / fare_amount ELSE 0 END`
				),
				avg_distance: vg.avg("trip_distance"),
			})
			.groupby("vendor_id")
			.having(having);
		const joinedData = Query.from("vendor_stats", "daily_revenues_nested")
			.where(vg.sql`vendor_stats.vendor_id = daily_revenues_nested.vendor_id`)
			.select({
				vendor_id: "vendor_stats.vendor_id",
				trip_count: "vendor_stats.trip_count",
				market_share: "vendor_stats.market_share",
				total_revenue: "vendor_stats.total_revenue",
				avg_fare: "vendor_stats.avg_fare",
				avg_tip_pct: "vendor_stats.avg_tip_pct",
				avg_distance: "vendor_stats.avg_distance",
				daily_revenue: "daily_revenues_nested.daily_revenue",
				start_date: "daily_revenues_nested.start_date",
				end_date: "daily_revenues_nested.end_date",
			});

		return Query.with({
			transformed_rides: transformedRidesCTE,
			filtered_rides: filteredRidesCTE,
			daily_revenues_sparse: dailyRevenuesSparseCTE,
			all_days: allDaysCTE,
			all_vendors: allVendorsCTE,
			scaffold: scaffoldCTE,
			dense_daily_revenues: denseDailyRevenuesCTE,
			daily_revenues_nested: dailyRevenuesNestedCTE,
			vendor_stats: vendorStatsCTE,
		})
			.from(joinedData)
			.select("*");
	},
	options: {
		enableRowSelection: false,
		autoResetPageIndex: false,
		initialState: {
			sorting: [{ id: "trip_count", desc: true }],
		},
	},
};
