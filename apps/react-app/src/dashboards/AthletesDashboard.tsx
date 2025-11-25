// apps/react-app/src/dashboards/AthletesDashboard.tsx

import React, { useState, useEffect, useRef } from 'react';
import * as vg from '@uwdata/vgplot';
import { Vgplot } from '../utils/vgplot';
import { AthletesTable } from '../tables';
import { useMosaicSelection } from '@mosaic-tanstack/react';

export function AthletesDashboard() {
  const [dashboard, setDashboard] = useState<HTMLElement | null>(null);
  // NEW: Add a state to track when the initial data setup is complete.
  const [isDataReady, setIsDataReady] = useState(false);
  const setupRan = useRef(false);
  
  const categorySel = useMosaicSelection('athlete_category');
  const brushSel = useMosaicSelection('athlete_brush');
  const externalFilterSel = useMosaicSelection('athlete_external_filter');
  const querySel = useMosaicSelection('athlete_query'); 
  const hoverSel = useMosaicSelection('athlete_hover');
  const hoverRawSel = useMosaicSelection('athlete_hover_raw');
  const rowSelectionSel = useMosaicSelection('athlete_rowSelection');
  const internalFilterSel = useMosaicSelection('athlete_internal_filter');

  useEffect(() => {
    if (setupRan.current) return;
    setupRan.current = true;

    async function setupDashboard() {
      const fileURL = 'https://pub-1da360b43ceb401c809f68ca37c7f8a4.r2.dev/data/athletes.parquet';
      await vg.coordinator().exec([
          `CREATE OR REPLACE TABLE athletes AS SELECT * FROM '${fileURL}'`
      ]);

      // NEW: Set the flag to true after the CREATE TABLE command completes.
      setIsDataReady(true);

      const plotDashboard = vg.vconcat(
        vg.hconcat(
          vg.menu({ label: "Sport", as: categorySel, from: "athletes", column: "sport" }),
          vg.menu({ label: "Sex", as: categorySel, from: "athletes", column: "sex" }),
          vg.search({
            label: "Name", filterBy: categorySel, as: categorySel, from: "athletes",
            column: "name", type: "contains"
          })
        ),
        vg.vspace(10),
        vg.plot(
          vg.dot(vg.from("athletes", { filterBy: querySel }), { x: "weight", y: "height", fill: "sex", r: 2, opacity: 0.1 }),
          vg.regressionY(vg.from("athletes", { filterBy: querySel }), { x: "weight", y: "height", stroke: "sex" }),
          vg.intervalXY({ as: brushSel, brush: { fillOpacity: 0, stroke: "black" } }),
          vg.dot(vg.from("athletes", { filterBy: hoverSel }), { x: "weight", y: "height", fill: "sex", stroke: "currentColor", strokeWidth: 1.5, r: 4 }),
          vg.xyDomain(vg.Fixed), vg.colorDomain(vg.Fixed),
          vg.margins({ left: 35, top: 20, right: 1 }),
          vg.width(570), vg.height(350)
        )
      );
      
      setDashboard(plotDashboard);
    }
    
    setupDashboard();
  }, [categorySel, brushSel, querySel, hoverSel]);

  return (
    <div>
      <Vgplot plot={dashboard} />
      <div style={{ marginTop: '5px' }}>
        {/* NEW: Conditionally render the table ONLY when data is ready. */}
        {isDataReady ? (
          <AthletesTable
            filterBy={externalFilterSel}
            internalFilterAs={internalFilterSel}
            rowSelectionAs={rowSelectionSel}
            hoverAs={hoverRawSel}
          />
        ) : (
          <div>Loading athlete data...</div>
        )}
      </div>
    </div>
  );
}