// src/tables/trips/ui.tsx
// This file provides the React-specific UI layer for the Trips table.
// It imports the agnostic logic, defines renderers, and exports the final component.
import React from 'react';
import { createDataTable } from '@nozzle/mosaic-tanstack-react-table';
import { tripsLogicConfig } from './logic';
import type {
  DataTableUIConfig,
  TripSummary,
} from '@nozzle/mosaic-tanstack-table-core';

const formatCurrency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const Filter = ({ column }: { column: any }) => {
  const columnFilterValue = column.getFilterValue() ?? '';
  const [value, setValue] = React.useState(columnFilterValue);

  React.useEffect(() => {
    const timeout = setTimeout(() => {
      column.setFilterValue(value);
    }, 300);
    return () => clearTimeout(timeout);
  }, [value, column]);

  React.useEffect(() => {
    setValue(columnFilterValue);
  }, [columnFilterValue]);

  return (
    <input
      type="text"
      value={value as string}
      onChange={(e) => setValue(e.target.value)}
      placeholder={`Search...`}
      onClick={(e) => e.stopPropagation()}
      style={{ width: '100%', border: '1px solid #ccc', borderRadius: '4px' }}
    />
  );
};

const tripsUIConfig: DataTableUIConfig<TripSummary> = {
  dropoff_zone: {
    header: 'Dropoff Zone',
    meta: { Filter },
  },
  trip_count: {
    header: 'Trip Count',
    cell: (info: any) => (info.getValue() as number).toLocaleString(),
    meta: { Filter },
  },
  avg_fare: {
    header: 'Avg. Fare',
    cell: (info: any) => formatCurrency.format(info.getValue() as number),
    meta: { Filter },
  },
  avg_distance: {
    header: 'Avg. Distance (mi)',
    cell: (info: any) => (info.getValue() as number).toFixed(2),
    meta: { Filter },
  },
  avg_tip_pct: {
    header: 'Avg. Tip %',
    cell: (info: any) => `${((info.getValue() as number) * 100).toFixed(1)}%`,
    meta: { Filter },
  },
};

export const TripsTable = createDataTable(tripsLogicConfig, tripsUIConfig);
