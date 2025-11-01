// src/lib/tables/vendor/ui.ts
// This file provides the Svelte-specific UI layer configuration for the Vendor Stats table.
import type {
	DataTableUIConfig,
	VendorSummary,
} from "@nozzle/mosaic-tanstack-table-core";
import Filter from "../../ui/Filter.svelte";
import Sparkline from "../../ui/Sparkline.svelte";

const formatCurrency = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
});

export const vendorStatsUIConfig: DataTableUIConfig<VendorSummary> = {
	vendor_id: { header: () => "Vendor ID", meta: { Filter } },
	daily_revenue: { header: () => "Daily Revenue Trend", cell: Sparkline },
	trip_count: {
		header: () => "Trip Count",
		cell: (info: any) => (info.getValue() as number).toLocaleString(),
		meta: { Filter },
	},
	market_share: {
		header: () => "Market Share",
		cell: (info: any) => `${((info.getValue() as number) * 100).toFixed(1)}%`,
	},
	total_revenue: {
		header: () => "Total Revenue",
		cell: (info: any) => formatCurrency.format(info.getValue() as number),
	},
	avg_fare: {
		header: () => "Avg. Fare",
		cell: (info: any) => formatCurrency.format(info.getValue() as number),
	},
	avg_tip_pct: {
		header: () => "Avg. Tip %",
		cell: (info: any) => `${((info.getValue() as number) * 100).toFixed(1)}%`,
	},
	avg_distance: {
		header: () => "Avg. Distance (mi)",
		cell: (info: any) => (info.getValue() as number).toFixed(2),
	},
};
