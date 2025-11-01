// apps/react-app/src/dashboards/NycTaxiDashboard.tsx

import React, { useEffect, useRef, useState } from 'react';
import * as vg from '@uwdata/vgplot';
import { useMosaicSelection } from '@nozzle/mosaic-tanstack-react-table';
import { Vgplot } from '../utils/vgplot';
import { TripsTable, VendorStatsTable } from '../tables';

export function NycTaxiDashboard() {
  const [dashboard, setDashboard] = useState<HTMLElement | null>(null);
  const [isDataReady, setIsDataReady] = useState(false);
  const setupRan = useRef(false);

  // --- CORRECTED: Use the new, explicit selection names from the provider ---
  const brushSel = useMosaicSelection('taxi_brush');
  const externalFilterSel = useMosaicSelection('taxi_external_filter');
  const querySel = useMosaicSelection('taxi_query');
  const hoverSel = useMosaicSelection('taxi_hover');
  const hoverRawSel = useMosaicSelection('taxi_hover_raw');
  const rowSelectionSel = useMosaicSelection('taxi_rowSelection');
  const tripsInternalFilterSel = useMosaicSelection(
    'taxi_trips_internal_filter',
  );
  const vendorInternalFilterSel = useMosaicSelection(
    'taxi_vendor_internal_filter',
  );

  useEffect(() => {
    if (setupRan.current) return;
    setupRan.current = true;

    async function setupDashboard() {
      // One-time data loading and transformation using Mosaic's SQL helpers.
      // This is a complex setup that involves loading spatial data, performing transformations,
      // and creating a final, cleaned 'trips' table for the dashboard to use.
      const fileURL =
        'https://pub-1da360b43ceb401c809f68ca37c7f8a4.r2.dev/data/nyc-rides-2010.parquet';
      await vg.coordinator().exec([
        vg.loadExtension('spatial'),
        vg.loadParquet('rides', fileURL, {
          select: [
            'pickup_datetime::TIMESTAMP AS datetime',
            "ST_Transform(ST_Point(pickup_latitude, pickup_longitude), 'EPSG:4326', 'ESRI:102718') AS pick",
            "ST_Transform(ST_Point(dropoff_latitude, dropoff_longitude), 'EPSG:4326', 'ESRI:102718') AS drop",
            'trip_distance',
            'fare_amount',
            'tip_amount',
            'total_amount',
            'vendor_id',
          ],
        }),
        `CREATE OR REPLACE TABLE trips AS SELECT
          (HOUR(datetime) + MINUTE(datetime)/60) AS time,
          MONTH(datetime) AS month,
          ST_X(pick) AS px, ST_Y(pick) AS py,
          ST_X(drop) AS dx, ST_Y(drop) AS dy,
          trip_distance, fare_amount, tip_amount, total_amount, vendor_id
        FROM rides
        WHERE fare_amount > 0 AND trip_distance > 0`,
      ]);

      setIsDataReady(true);

      // Define the vgplot portion of the dashboard.
      const plotDashboard = vg.vconcat(
        vg.hconcat(
          vg.plot(
            // The raster and dot layers are filtered by the master 'query' selection.
            vg.raster(vg.from('trips', { filterBy: querySel }), {
              x: 'px',
              y: 'py',
              bandwidth: 0,
            }),
            vg.dot(vg.from('trips', { filterBy: hoverSel }), {
              x: 'px',
              y: 'py',
              fill: 'red',
              r: 3,
              stroke: 'white',
              strokeWidth: 1,
            }),
            // The brush interaction writes to the dedicated 'brush' selection.
            vg.intervalXY({ as: brushSel }),
            vg.text([{ label: 'Taxi Pickups' }], {
              dx: 10,
              dy: 10,
              text: 'label',
              fill: 'black',
              fontSize: '1.2em',
              frameAnchor: 'top-left',
            }),
            vg.width(335),
            vg.height(550),
            vg.margin(0),
            vg.xAxis(null),
            vg.yAxis(null),
            vg.xDomain([975000, 1005000]),
            vg.yDomain([190000, 240000]),
            vg.colorScale('symlog'),
            vg.colorScheme('blues'),
          ),
          vg.hspace(10),
          vg.plot(
            vg.raster(vg.from('trips', { filterBy: querySel }), {
              x: 'dx',
              y: 'dy',
              bandwidth: 0,
            }),
            vg.dot(vg.from('trips', { filterBy: hoverSel }), {
              x: 'dx',
              y: 'dy',
              fill: 'yellow',
              r: 4,
              stroke: 'black',
              strokeWidth: 1,
            }),
            vg.intervalXY({ as: brushSel }),
            vg.text([{ label: 'Taxi Dropoffs' }], {
              dx: 10,
              dy: 10,
              text: 'label',
              fill: 'black',
              fontSize: '1.2em',
              frameAnchor: 'top-left',
            }),
            vg.width(335),
            vg.height(550),
            vg.margin(0),
            vg.xAxis(null),
            vg.yAxis(null),
            vg.xDomain([975000, 1005000]),
            vg.yDomain([190000, 240000]),
            vg.colorScale('symlog'),
            vg.colorScheme('oranges'),
          ),
        ),
        vg.vspace(10),
        vg.plot(
          vg.rectY(vg.from('trips', { filterBy: querySel }), {
            x: vg.bin('time'),
            y: vg.count(),
            fill: 'steelblue',
            inset: 0.5,
          }),
          vg.intervalX({ as: brushSel }),
          vg.xDomain(vg.Fixed),
          vg.yTickFormat('s'),
          vg.xLabel('Pickup Hour →'),
          vg.width(680),
          vg.height(100),
        ),
      );

      setDashboard(plotDashboard);
    }

    setupDashboard();
  }, [brushSel, querySel, hoverSel]); // Dependencies are the stable selection objects.

  return (
    <div>
      <Vgplot plot={dashboard} />
      <div style={{ marginTop: '5px', display: 'flex', gap: '20px' }}>
        {isDataReady ? (
          <>
            <div style={{ flex: 1 }}>
              <h3>Top Dropoff Zones</h3>
              {/* Pass the correct selection props to the table components */}
              <TripsTable
                filterBy={externalFilterSel}
                internalFilterAs={tripsInternalFilterSel}
                rowSelectionAs={rowSelectionSel}
                hoverAs={hoverRawSel}
              />
            </div>
            <div style={{ flex: 1 }}>
              <h3>Vendor Performance</h3>
              <VendorStatsTable
                filterBy={externalFilterSel}
                internalFilterAs={vendorInternalFilterSel}
                rowSelectionAs={rowSelectionSel}
              />
            </div>
          </>
        ) : (
          <div>Loading table data...</div>
        )}
      </div>
    </div>
  );
}
