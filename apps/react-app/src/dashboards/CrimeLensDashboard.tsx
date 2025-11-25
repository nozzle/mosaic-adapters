// apps/react-app/src/dashboards/CrimeLensDashboard.tsx (FINAL & ROBUST)
import React, { useState, useEffect, useRef } from 'react';
import * as vg from '@uwdata/vgplot';
import { Vgplot } from '../utils/vgplot';
import { useMosaicSelection } from '@mosaic-tanstack/react';
import { PrecinctStatsTable } from '../tables';

export function CrimeLensDashboard() {
  const [plot, setPlot] = useState<HTMLElement | null>(null);
  const [isDataReady, setIsDataReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setupRan = useRef(false);

  const boroFilter = useMosaicSelection('crime_boro_filter');
  const sevFilter = useMosaicSelection('crime_sev_filter');
  const timelineBrush = useMosaicSelection('crime_timeline_brush');
  const masterQuery = useMosaicSelection('crime_master_query');

  useEffect(() => {
    if (setupRan.current) return;
    setupRan.current = true;

    async function setupDashboard() {
      try {
        const boroughsURL = 'https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services/NYC_Borough_Boundary/FeatureServer/0/query?where=1=1&outFields=*&outSR=4326&f=geojson';
        const crimeDataURL = 'https://fastopendata.org/crime_nypd_arrests/crime_nypd_arrests.parquet';
        
        const proxiedBoroughsURL = `http://localhost:3000/proxy?url=${encodeURIComponent(boroughsURL)}`;
        const proxiedCrimeDataURL = `http://localhost:3000/proxy?url=${encodeURIComponent(crimeDataURL)}`;

        const tableName = 'crime_analytics';
        
        const lon_min = 975000;
        const lon_max = 1005000;
        const lat_min = 190000;
        const lat_max = 240000;

        await vg.coordinator().exec([
            vg.loadExtension("spatial"),
            `CREATE OR REPLACE TABLE boroughs AS SELECT *, ST_Transform(geom, 'EPSG:4326', 'ESRI:102718') as projected_geom FROM ST_Read('${proxiedBoroughsURL}')`,
            `CREATE OR REPLACE TABLE ${tableName} AS SELECT
                *, boro as boro, EXTRACT(DOW FROM arrest_date) AS day_of_week,
                CASE law_cat_cd WHEN 'F' THEN 3 WHEN 'M' THEN 2 WHEN 'V' THEN 1 ELSE 0 END AS severity_score
            FROM read_parquet('${proxiedCrimeDataURL}')
            WHERE x_coord_cd IS NOT NULL AND y_coord_cd IS NOT NULL
            AND x_coord_cd BETWEEN ${lon_min} AND ${lon_max}
            AND y_coord_cd BETWEEN ${lat_min} AND ${lat_max}`
        ]);

        const severityOptions = [
            { label: 'Felony', value: 3 }, { label: 'Misdemeanor', value: 2 }, { label: 'Violation', value: 1 }
        ];

        const controls = vg.hconcat(
            vg.menu({ label: "Borough", from: 'crime_analytics', column: 'boro', as: boroFilter }),
            vg.menu({ label: "Severity", options: severityOptions, as: sevFilter, column: 'severity_score' })
        );

        const timelinePlot = vg.plot(
            vg.lineY(vg.from('crime_analytics', { filterBy: masterQuery }), {
                x: vg.sql`EXTRACT(YEAR FROM arrest_date)`, y: vg.count(),
                stroke: '#4e79a7', strokeWidth: 2, marker: 'circle'
            }),
            vg.intervalX({ as: timelineBrush }),
            vg.yScale('symlog'), vg.xDomain(vg.Fixed), vg.xLabel("Year →"),
            vg.width(400), vg.height(150)
        );
        
        const mainMap = vg.plot(
            vg.geo(vg.from('boroughs'), {
                geometry: 'projected_geom', fill: '#333', stroke: '#666', strokeWidth: 0.5
            }),
            vg.raster(vg.from('crime_analytics', { filterBy: masterQuery }), { 
                x: 'x_coord_cd', y: 'y_coord_cd', fill: 'density', bandwidth: 5
            }),
            vg.colorScale('symlog'), vg.colorScheme('ylgnbu'), vg.colorReverse(true),
            vg.xDomain([lon_min, lon_max]), vg.yDomain([lat_min, lat_max]),
            vg.xyDomain(vg.Fixed), vg.width(600), vg.height(600),
            vg.xAxis(null), vg.yAxis(null),
            // --- THE FINAL FIX ---
            // Set a background color for the plot area itself. This ensures that
            // even if the heatmap layer renders before the geo layer, it renders
            // against a dark background, making the race condition visually seamless.
            vg.style({ background: '#333' })
        );

        setPlot(vg.hconcat(vg.vconcat(controls, timelinePlot), mainMap));
        setIsDataReady(true);
      } catch (e: any) {
        console.error("Error setting up CrimeLens Dashboard:", e);
        setError(e.message || 'An unknown error occurred.');
      }
    }
    setupDashboard();
  }, [boroFilter, sevFilter, timelineBrush, masterQuery]);

  if (error) { 
      return (
          <div style={{ padding: '1rem', color: 'red', border: '1px solid red', backgroundColor: '#fff5f5' }}>
              <h2>Error Loading CrimeLens Dashboard</h2>
              <p>There was a problem fetching or processing the crime dataset. Please check the browser's developer console for a more specific error message.</p>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{error}</pre>
          </div>
      );
  }

  return (
    <div>
        <h2>NYC CrimeLens: Arrest Hotspot Analysis</h2>
        <p>Use the controls to filter arrests by borough, severity, and time. The map shows the density of arrests for the selected criteria, and the table below provides a statistical breakdown by precinct.</p>
        <Vgplot plot={plot} />
        <div style={{ marginTop: '1rem', borderTop: '1px solid #ccc', paddingTop: '1rem' }}>
            <h3>Precinct Statistics</h3>
            {isDataReady ? <PrecinctStatsTable filterBy={masterQuery} /> : <div>Loading crime data for table...</div>}
        </div>
    </div>
  );
}