// src/FlightsDashboard.tsx
// UI component for the Flights dashboard, handling one-time data load
// and rendering vgplot visuals alongside the React data table.
import React, { useState, useEffect, useRef } from "react";
import * as vg from "@uwdata/vgplot";
import { Vgplot } from "../utils/vgplot";
import { useMosaicSelection } from "@nozzle/mosaic-tanstack-react-table";
import { FlightsTable } from "../tables";

export function FlightsDashboard() {
	const [dashboard, setDashboard] = useState<HTMLElement | null>(null);
	const [isReady, setIsReady] = useState(false);
	const setupRan = useRef(false);

	// The query selection no longer includes the internal table filter.
	const querySel = useMosaicSelection("flights_query");
	const brushSel = useMosaicSelection("flights_brush");
	const rowSelectionSel = useMosaicSelection("flights_rowSelection");
	const internalFilterSel = useMosaicSelection("flights_internal_filter");

	useEffect(() => {
		if (setupRan.current) return;
		setupRan.current = true;

		async function setupDashboard() {
			// UPDATED: Use the exact same URL and query as the Svelte version.
			const fileURL =
				"https://pub-1da360b43ceb401c809f68ca37c7f8a4.r2.dev/data/flights-10m.parquet";
			const dataSetupQuery = `
        CREATE OR REPLACE TABLE flights_10m AS 
        SELECT ROW_NUMBER() OVER () AS id,
          GREATEST(-60, LEAST(ARR_DELAY, 180))::DOUBLE AS delay, 
          DISTANCE AS distance, DEP_TIME AS time 
        FROM '${fileURL}'`;
			await vg.coordinator().exec(dataSetupQuery);

			const plotDashboard = vg.vconcat(
				vg.plot(
					vg.rectY(vg.from("flights_10m", { filterBy: querySel }), {
						x: vg.bin("delay"),
						y: vg.count(),
						fill: "steelblue",
						insetLeft: 0.5,
						insetRight: 0.5,
					}),
					vg.intervalX({ as: brushSel }),
					vg.xDomain(vg.Fixed),
					vg.xLabel("Arrival Delay (min) →"),
					vg.yTickFormat("s"),
					vg.width(600),
					vg.height(200)
				),
				vg.plot(
					vg.rectY(vg.from("flights_10m", { filterBy: querySel }), {
						x: vg.bin("time"),
						y: vg.count(),
						fill: "steelblue",
						insetLeft: 0.5,
						insetRight: 0.5,
					}),
					vg.intervalX({ as: brushSel }),
					vg.xDomain(vg.Fixed),
					vg.xLabel("Departure Time (hour) →"),
					vg.yTickFormat("s"),
					vg.width(600),
					vg.height(200)
				),
				vg.plot(
					vg.rectY(vg.from("flights_10m", { filterBy: querySel }), {
						x: vg.bin("distance"),
						y: vg.count(),
						fill: "steelblue",
						insetLeft: 0.5,
						insetRight: 0.5,
					}),
					vg.intervalX({ as: brushSel }),
					vg.xDomain(vg.Fixed),
					vg.xLabel("Flight Distance (miles) →"),
					vg.yTickFormat("s"),
					vg.width(600),
					vg.height(200)
				)
			);

			setDashboard(plotDashboard);
			setIsReady(true);
		}

		setupDashboard();
	}, [querySel, brushSel]);

	return (
		<div>
			<h2>10 Million US Flights</h2>
			<p>
				This dashboard shows three histograms of flight data. Brushing on one
				histogram (clicking and dragging) will cross-filter the other two,
				updating their distributions to reflect the selected data subset.
			</p>
			{isReady ? (
				<>
					<Vgplot plot={dashboard} />
					<div style={{ marginTop: "1rem" }}>
						{/* The table's filterBy prop correctly receives the external filters */}
						<FlightsTable
							filterBy={querySel}
							rowSelectionAs={rowSelectionSel}
							internalFilterAs={internalFilterSel}
						/>
					</div>
				</>
			) : (
				<div>Loading Flights Dashboard...</div>
			)}
		</div>
	);
}
