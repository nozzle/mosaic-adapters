// apps/react-app/src/tables/precinctStats/ui.tsx
// This file provides the React-specific UI layer for the Precinct Statistics table.
// It imports the agnostic logic, defines renderers, and exports the final component.
import React from 'react';
import { createDataTable } from '@mosaic-tanstack/react';
import { precinctStatsLogicConfig } from './logic';
import { DataTableUIConfig } from '@mosaic-tanstack/core';

interface PrecinctStat {
    arrest_precinct: number;
    arrest_boro: string;
    total_arrests: number;
    avg_severity: number;
    felony_pct: number;
}

const precinctStatsUIConfig: DataTableUIConfig<PrecinctStat> = {
    'arrest_precinct': {
      header: 'Precinct'
    },
    'arrest_boro': {
      header: 'Borough'
    },
    'total_arrests': {
      header: 'Total Arrests',
      cell: (info: any) => (info.getValue() as number).toLocaleString()
    },
    'avg_severity': {
      header: 'Avg. Severity',
      cell: (info: any) => (info.getValue() as number).toFixed(2)
    },
    'felony_pct': {
      header: 'Felony %',
      cell: (info: any) => `${((info.getValue() as number) * 100).toFixed(1)}%`
    },
};

export const PrecinctStatsTable = createDataTable(precinctStatsLogicConfig, precinctStatsUIConfig);