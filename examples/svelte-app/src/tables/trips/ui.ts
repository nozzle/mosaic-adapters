// src/lib/tables/trips/ui.ts
// This file provides the Svelte-specific UI layer configuration for the Trips table.
import type {
	DataTableUIConfig,
	TripSummary,
} from "@nozzle/mosaic-tanstack-table-core";
import Filter from "../../ui/Filter.svelte";

const formatCurrency = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
});

export const tripsUIConfig: DataTableUIConfig<TripSummary> = {
	dropoff_zone: { header: () => "Dropoff Zone", meta: { Filter } },
	trip_count: {
		header: () => "Trip Count",
		cell: (info: any) => (info.getValue() as number).toLocaleString(),
		meta: { Filter },
	},
	avg_fare: {
		header: () => "Avg. Fare",
		cell: (info: any) => formatCurrency.format(info.getValue() as number),
		meta: { Filter },
	},
	avg_distance: {
		header: () => "Avg. Distance (mi)",
		cell: (info: any) => (info.getValue() as number).toFixed(2),
		meta: { Filter },
	},
	avg_tip_pct: {
		header: () => "Avg. Tip %",
		cell: (info: any) => `${((info.getValue() as number) * 100).toFixed(1)}%`,
		meta: { Filter },
	},
};
