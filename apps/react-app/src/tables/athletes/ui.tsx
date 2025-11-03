// apps/react-app/src/tables/athletes/ui.tsx
// This file provides the React-specific UI layer for the Athletes table.
// It imports the agnostic logic, defines renderers, and exports the final component.
import React from 'react';
import { createDataTable } from '@mosaic-tanstack/react';
import { athletesLogicConfig } from './logic';
import { Athlete, DataTableUIConfig } from '@mosaic-tanstack/core';

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

const athletesUIConfig: DataTableUIConfig<Athlete> = {
    'select': {
      header: ({ table }: any) => <IndeterminateCheckbox table={table} />, 
      cell: ({ row }: any) => <input type="checkbox" checked={row.getIsSelected()} disabled={!row.getCanSelect()} onChange={row.getToggleSelectedHandler()} style={{ width: '20px', height: '20px' }} />
    },
    'rank': {
      header: 'Rank'
    },
    'name': {
      header: 'Name',
      meta: { Filter }
    },
    'nationality': {
      header: 'Nationality',
      meta: { Filter }
    },
    'sex': {
      header: 'Sex',
      meta: { Filter }
    },
    'height': {
      header: 'Height',
      meta: { Filter }
    },
    'weight': {
      header: 'Weight',
      meta: { Filter }
    },
    'sport': {
      header: 'Sport',
      meta: { Filter }
    }
  };

export const AthletesTable = createDataTable(athletesLogicConfig, athletesUIConfig);