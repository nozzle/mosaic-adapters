// src/AthletesDashboard.tsx
// UI component for the Athletes dashboard, handling one-time data load
// and rendering vgplot visuals alongside the React data table.
import React, { useState, useEffect, useRef } from 'react';
import * as vg from '@uwdata/vgplot';
import { Vgplot } from '../utils/vgplot';
import { AthletesTable } from '../tables';
import { useMosaicSelection } from '@mosaic-tanstack/react';

export function AthletesDashboard() {
  const [dashboard, setDashboard] = useState<HTMLElement | null>(null);
  const setupRan = useRef(false);
  
  // Retrieve all necessary selections for the dashboard.
  const categorySel = useMosaicSelection('athlete_category');
  const querySel = useMosaicSelection('athlete_query'); // This is now just external filters.
  const hoverSel = useMosaicSelection('athlete_hover');
  const hoverRawSel = useMosaicSelection('athlete_hover_raw');
  const rowSelectionSel = useMosaicSelection('athlete_rowSelection');
  const internalFilterSel = useMosaicSelection('athlete_internal_filter');

  useEffect(() => {
    if (setupRan.current) return;
    setupRan.current = true;

    async function setupDashboard() {
      // UPDATED: Use the same public URL as the Svelte version.
      const fileURL = 'https://pub-1da360b43ceb401c809f68ca37c7f8a4.r2.dev/data/athletes.parquet';
      // UPDATED: Use CREATE OR REPLACE TABLE for idempotent setup.
      await vg.coordinator().exec([
          `CREATE OR REPLACE TABLE athletes AS SELECT * FROM '${fileURL}'`
      ]);

      const plotDashboard = vg.vconcat(
        vg.hconcat(
          vg.menu({ label: "Sport", as: categorySel, from: "athletes", column: "sport" }),
          vg.menu({ label: "Sex", as: categorySel, from: "athletes", column: "sex" }),
          vg.search({
            label: "Name", filterBy: categorySel, as: querySel, from: "athletes",
            column: "name", type: "contains"
          })
        ),
        vg.vspace(10),
        vg.plot(
          // The main plot layers are now filtered by the simplified query selection.
          vg.dot(vg.from("athletes", { filterBy: querySel }), { x: "weight", y: "height", fill: "sex", r: 2, opacity: 0.1 }),
          vg.regressionY(vg.from("athletes", { filterBy: querySel }), { x: "weight", y: "height", stroke: "sex" }),
          vg.intervalXY({ as: querySel, brush: { fillOpacity: 0, stroke: "black" } }),
          // The hover dots correctly listen to the composite `athlete_hover` selection.
          vg.dot(vg.from("athletes", { filterBy: hoverSel }), { x: "weight", y: "height", fill: "sex", stroke: "currentColor", strokeWidth: 1.5, r: 4 }),
          vg.xyDomain(vg.Fixed), vg.colorDomain(vg.Fixed),
          vg.margins({ left: 35, top: 20, right: 1 }),
          vg.width(570), vg.height(350)
        )
      );

      setDashboard(plotDashboard);
    }

    setupDashboard();
  }, [categorySel, querySel, hoverSel]);

  return (
    <div>
      <Vgplot plot={dashboard} />
      <div style={{ marginTop: '5px' }}>
        {/* The AthletesTable `filterBy` prop now correctly receives ONLY external filters */}
        <AthletesTable
          filterBy={querySel}
          internalFilterAs={internalFilterSel}
          rowSelectionAs={rowSelectionSel}
          hoverAs={hoverRawSel}
        />
      </div>
    </div>
  );
}