// apps/react-app/src/tables/flights/ui.tsx
// This file provides the React-specific UI layer for the Flights table.
import React from 'react';
import { createDataTable } from '@mosaic-tanstack/react';
import { flightsLogicConfig } from './logic';
import { Flight, DataTableUIConfig } from '@mosaic-tanstack/core';

// Standard checkbox component for row selection, now with custom Select All logic
const IndeterminateCheckbox = ({ table }: { table: any }) => {
    const isSelectAll = table.getState().isSelectAll;
    const isSomeRowsSelected = table.getIsSomeRowsSelected();

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        table.options.meta?.toggleSelectAll?.(e.target.checked);
    };

    const ref = React.useRef<HTMLInputElement>(null!);
    React.useEffect(() => {
        if (typeof ref.current.indeterminate === 'boolean') {
            ref.current.indeterminate = isSomeRowsSelected && !isSelectAll;
        }
    }, [ref, isSomeRowsSelected, isSelectAll]);

    return <input type="checkbox" ref={ref} checked={isSelectAll} onChange={handleChange} style={{ width: '20px', height: '20px' }} />;
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

    return <input type="text" value={value as string} onChange={e => setValue(e.target.value)} placeholder={`Search...`} onClick={(e) => e.stopPropagation()} style={{ width: '100%', border: '1px solid #ccc', borderRadius: '4px' }} />;
};

const flightsUIConfig: DataTableUIConfig<Flight> = {
    'select': {
      header: ({ table }: any) => <IndeterminateCheckbox table={table} />, 
      cell: ({ row }: any) => <input type="checkbox" checked={row.getIsSelected()} disabled={!row.getCanSelect()} onChange={row.getToggleSelectedHandler()} style={{ width: '20px', height: '20px' }} />
    },
    'id': {
      header: 'ID',
      meta: { Filter }
    },
    'delay': {
      header: 'Arrival Delay (min)',
      cell: (info: any) => (info.getValue() as number).toFixed(0),
      meta: { Filter }
    },
    'distance': {
      header: 'Distance (miles)',
      cell: (info: any) => (info.getValue() as number).toLocaleString(),
      meta: { Filter }
    },
    'time': {
      header: 'Departure Time (hour)',
      cell: (info: any) => (info.getValue() as number).toFixed(2),
      meta: { Filter }
    },
  };

export const FlightsTable = createDataTable(flightsLogicConfig, flightsUIConfig);