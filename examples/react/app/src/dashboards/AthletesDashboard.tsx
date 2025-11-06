// apps/react-app/src/dashboards/AthletesDashboard.tsx

import React, { useEffect, useRef, useState } from 'react';
import * as vg from '@uwdata/vgplot';
import { useMosaicSelection } from '@nozzleio/mosaic-tanstack-react-table';
import { Vgplot } from '../utils/vgplot';
import { AthletesTable } from '../tables';

export function AthletesDashboard() {
  const [dashboard, setDashboard] = useState<HTMLElement | null>(null);
  // Use a ref to ensure the expensive data setup runs only once per component lifecycle.
  const setupRan = useRef(false);

  // Retrieve all necessary selections from the global context using the custom hook.
  // This decouples the dashboard from the creation of selections, making it purely a consumer.
  const categorySel = useMosaicSelection('athlete_category');
  const brushSel = useMosaicSelection('athlete_brush');
  const externalFilterSel = useMosaicSelection('athlete_external_filter');
  const querySel = useMosaicSelection('athlete_query');
  const hoverSel = useMosaicSelection('athlete_hover');
  const hoverRawSel = useMosaicSelection('athlete_hover_raw');
  const rowSelectionSel = useMosaicSelection('athlete_rowSelection');
  const internalFilterSel = useMosaicSelection('athlete_internal_filter');

  // This effect is responsible for all one-time setup: data loading and vgplot object creation.
  useEffect(() => {
    if (setupRan.current) return;
    setupRan.current = true;

    async function setupDashboard() {
      // Ensure the data is available in the database for all components to query.
      const fileURL =
        'https://pub-1da360b43ceb401c809f68ca37c7f8a4.r2.dev/data/athletes.parquet';
      await vg
        .coordinator()
        .exec([
          `CREATE OR REPLACE TABLE athletes AS SELECT * FROM '${fileURL}'`,
        ]);

      // Programmatically define the layout and content of the vgplot-based portion
      // of the dashboard. This returns a standard HTMLElement.
      const plotDashboard = vg.vconcat(
        vg.hconcat(
          // Wire vgplot inputs to write to their designated atomic selections.
          vg.menu({
            label: 'Sport',
            as: categorySel,
            from: 'athletes',
            column: 'sport',
          }),
          vg.menu({
            label: 'Sex',
            as: categorySel,
            from: 'athletes',
            column: 'sex',
          }),
          vg.search({
            label: 'Name',
            filterBy: categorySel,
            as: categorySel,
            from: 'athletes',
            column: 'name',
            type: 'contains',
          }),
        ),
        vg.vspace(10),
        vg.plot(
          // Wire vgplot marks to be filtered by the master 'query' selection.
          vg.dot(vg.from('athletes', { filterBy: querySel }), {
            x: 'weight',
            y: 'height',
            fill: 'sex',
            r: 2,
            opacity: 0.1,
          }),
          vg.regressionY(vg.from('athletes', { filterBy: querySel }), {
            x: 'weight',
            y: 'height',
            stroke: 'sex',
          }),

          // The brush interactor writes its state to the dedicated 'brush' selection.
          vg.intervalXY({
            as: brushSel,
            brush: { fillOpacity: 0, stroke: 'black' },
          }),

          // The highlight layer is filtered by the context-aware 'hover' selection.
          vg.dot(vg.from('athletes', { filterBy: hoverSel }), {
            x: 'weight',
            y: 'height',
            fill: 'sex',
            stroke: 'currentColor',
            strokeWidth: 1.5,
            r: 4,
          }),
          vg.xyDomain(vg.Fixed),
          vg.colorDomain(vg.Fixed),
          vg.margins({ left: 35, top: 20, right: 1 }),
          vg.width(570),
          vg.height(350),
        ),
      );

      // Store the generated HTMLElement in React state to trigger a render.
      setDashboard(plotDashboard);
    }

    setupDashboard();
    // The dependency array ensures this effect runs if selection objects were to be re-created,
    // though in this provider-based architecture, they are stable.
  }, [categorySel, brushSel, querySel, hoverSel]);

  return (
    <div>
      {/* The Vgplot component safely renders the generated HTMLElement into the React DOM. */}
      <Vgplot plot={dashboard} />
      <div style={{ marginTop: '5px' }}>
        {/* 
          Render the AthletesTable, passing the correct selections as props.
          This declaratively wires the table into the dashboard's interaction graph.
          - `filterBy`: The table's data is filtered by external events (menus, brush).
          - `internalFilterAs`: The table broadcasts its internal state to this selection.
          - `rowSelectionAs`: The table broadcasts its checked rows to this selection.
          - `hoverAs`: The table broadcasts its hovered row to this selection.
        */}
        <AthletesTable
          filterBy={externalFilterSel}
          internalFilterAs={internalFilterSel}
          rowSelectionAs={rowSelectionSel}
          hoverAs={hoverRawSel}
        />
      </div>
    </div>
  );
}
