// src/tables/flights/ui.tsx
// This file provides the React-specific UI layer for the Flights table.
import React from 'react';
import { createDataTable } from '@nozzle/mosaic-tanstack-react-table';
import { flightsLogicConfig } from './logic';
import { Flight, DataTableUIConfig } from '@nozzle/mosaic-tanstack-table-core';

// Standard checkbox component for row selection, copied from athletes/ui.tsx
const IndeterminateCheckbox = ({ table, ...rest }: { table: any }) => {
  const ref = React.useRef<HTMLInputElement>(null!);
  React.useEffect(() => {
    if (typeof ref.current.indeterminate === 'boolean') {
      ref.current.indeterminate = table.getIsSomeRowsSelected();
    }
  }, [ref, table.getIsSomeRowsSelected()]);
  return (
    <input
      type="checkbox"
      ref={ref}
      checked={table.getIsAllRowsSelected()}
      onChange={table.getToggleAllRowsSelectedHandler()}
      style={{ width: '20px', height: '20px' }}
      {...rest}
    />
  );
};

// Standard filter component for columns, copied from athletes/ui.tsx
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

const flightsUIConfig: DataTableUIConfig<Flight> = {
  select: {
    header: ({ table }: any) => <IndeterminateCheckbox table={table} />,
    cell: ({ row }: any) => (
      <input
        type="checkbox"
        checked={row.getIsSelected()}
        disabled={!row.getCanSelect()}
        onChange={row.getToggleSelectedHandler()}
        style={{ width: '20px', height: '20px' }}
      />
    ),
  },
  id: {
    header: 'ID',
    meta: { Filter },
  },
  delay: {
    header: 'Arrival Delay (min)',
    cell: (info: any) => (info.getValue() as number).toFixed(0),
    meta: { Filter },
  },
  distance: {
    header: 'Distance (miles)',
    cell: (info: any) => (info.getValue() as number).toLocaleString(),
    meta: { Filter },
  },
  time: {
    header: 'Departure Time (hour)',
    cell: (info: any) => (info.getValue() as number).toFixed(2),
    meta: { Filter },
  },
};

export const FlightsTable = createDataTable(
  flightsLogicConfig,
  flightsUIConfig,
);
