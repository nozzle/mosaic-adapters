// src/tables/vendor/ui.tsx
// This file provides the React-specific UI layer for the Vendor Stats table.
// It imports the agnostic logic, defines renderers (including the Sparkline), and exports the final component.
import React from 'react';
import { createDataTable } from '@nozzle/mosaic-tanstack-react-table';
import { vendorStatsLogicConfig } from './logic';
import {
  VendorSummary,
  DataTableUIConfig,
} from '@nozzle/mosaic-tanstack-table-core';
import { Sparkline } from '../../ui/Sparkline';

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

const vendorStatsUIConfig: DataTableUIConfig<VendorSummary> = {
  vendor_id: { header: 'Vendor ID', meta: { Filter } },
  daily_revenue: {
    header: 'Daily Revenue Trend',
    cell: ({ row }: any) => (
      <Sparkline
        data={row.original.daily_revenue}
        startDate={row.original.start_date}
        endDate={row.original.end_date}
      />
    ),
  },
  trip_count: {
    header: 'Trip Count',
    cell: (info: any) => (info.getValue() as number).toLocaleString(),
    meta: { Filter },
  },
  market_share: {
    header: 'Market Share',
    cell: (info: any) => `${((info.getValue() as number) * 100).toFixed(1)}%`,
  },
  total_revenue: {
    header: 'Total Revenue',
    cell: (info: any) => formatCurrency.format(info.getValue() as number),
  },
  avg_fare: {
    header: 'Avg. Fare',
    cell: (info: any) => formatCurrency.format(info.getValue() as number),
  },
  avg_tip_pct: {
    header: 'Avg. Tip %',
    cell: (info: any) => `${((info.getValue() as number) * 100).toFixed(1)}%`,
  },
  avg_distance: {
    header: 'Avg. Distance (mi)',
    cell: (info: any) => (info.getValue() as number).toFixed(2),
  },
};

export const VendorStatsTable = createDataTable(
  vendorStatsLogicConfig,
  vendorStatsUIConfig,
);
