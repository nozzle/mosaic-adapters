// apps/react-app/src/tables/precinctStats/logic.ts
// This file contains the framework-agnostic data and logic configuration for
// the Precinct Statistics table, which shows aggregated crime data.
import { DataTableLogicConfig } from '@mosaic-tanstack/core';
import * as vg from '@uwdata/vgplot';
import { Query, desc, eq, literal } from '@uwdata/mosaic-sql';

// Define the shape of the aggregated data
interface PrecinctStat {
    arrest_precinct: number;
    arrest_boro: string;
    total_arrests: number;
    avg_severity: number;
    felony_pct: number;
}

export const precinctStatsLogicConfig: DataTableLogicConfig<PrecinctStat> = {
    name: 'PrecinctStatsTable',
    groupBy: ['arrest_precinct', 'arrest_boro'],
    primaryKey: ['arrest_precinct'],
    columns: [
        { id: 'arrest_precinct', accessorKey: 'arrest_precinct', header: 'Precinct' },
        { id: 'arrest_boro', accessorKey: 'arrest_boro', header: 'Borough' },
        { id: 'total_arrests', accessorKey: 'total_arrests', header: 'Total Arrests' },
        { id: 'avg_severity', accessorKey: 'avg_severity', header: 'Avg. Severity' },
        { id: 'felony_pct', accessorKey: 'felony_pct', header: 'Felony %' },
    ],
    getBaseQuery: (filters) => {
        const { where = [] } = filters;
        return Query.from('crime_analytics')
            .where(where)
            .select({
                arrest_precinct: 'arrest_precinct',
                arrest_boro: 'arrest_boro',
                total_arrests: vg.count(),
                avg_severity: vg.avg('severity_score'),
                felony_pct: vg.avg(vg.sql`CASE WHEN law_cat_cd = 'F' THEN 1 ELSE 0 END`)
            })
            .groupby('arrest_precinct', 'arrest_boro');
    },
    hoverInteraction: {
        createPredicate: (row) => eq('arrest_precinct', literal(row.arrest_precinct)),
    },
    options: {
        enableRowSelection: false,
        autoResetPageIndex: false,
        initialState: {
            sorting: [{ id: 'total_arrests', desc: true }]
        }
    }
};