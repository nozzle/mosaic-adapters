// Standalone filter components that directly interact with Mosaic Selections and DuckDB.

import * as React from 'react';
import { useState, useEffect } from 'react';
import * as vg from '@uwdata/vgplot';
import * as mSql from '@uwdata/mosaic-sql';
import {
  UniqueColumnValuesClient,
  type FacetClientConfig,
  createStructAccess,
} from '@nozzleio/mosaic-tanstack-react-table';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import type { Selection } from '@uwdata/mosaic-core';

interface FilterProps {
  label: string;
  table: string;
  column: string;
  selection: Selection; // The global filter to update
}

/**
 * HOOK: useUniqueColumnValues
 * Wrapper around UniqueColumnValuesClient to simplify usage in React components.
 */
function useUniqueColumnValues(
  config: Omit<
    FacetClientConfig<Array<unknown>>,
    'onResult' | 'coordinator' | 'getFilterExpressions'
  > & {
    coordinator?: FacetClientConfig<Array<unknown>>['coordinator'];
  },
) {
  const [options, setOptions] = useState<any[]>([]);

  useEffect(() => {
    // Instantiate a transient Mosaic Client.
    // This client connects to the coordinator, runs a `SELECT DISTINCT column...` query,
    // and disconnects on unmount.
    const client = new UniqueColumnValuesClient({
      source: config.source,
      column: config.column,
      coordinator: config.coordinator || vg.coordinator(),
      onResult: (values) => setOptions(values.filter((v) => v != null)),
      sort: config.sort,
      limit: config.limit,
    });

    client.connect();
    client.requestUpdate();

    return () => client.disconnect();
  }, [config.source, config.column, config.sort, config.limit]);

  return options;
}

/**
 * COMPONENT: SelectFilter
 * A Dropdown that:
 * 1. Fetches unique values from DuckDB for the given column.
 * 2. Updates the passed Mosaic Selection on change.
 */
export function SelectFilter({ label, table, column, selection }: FilterProps) {
  const options = useUniqueColumnValues({
    source: table,
    column: column,
    // OPTIMIZATION:
    // Sort by frequency (Count DESC) and limit to top 50.
    // This prevents rendering performance issues and ensures relevant data is seen first.
    sort: 'count',
    limit: 50,
  });

  const handleChange = (val: string) => {
    // If 'ALL', we send null to remove the WHERE clause for this column
    const predicate =
      val === 'ALL' ? null : mSql.eq(mSql.column(column), mSql.literal(val));

    selection.update({
      source: `filter-${column}`, // Unique ID for this filter source
      predicate,
    });
  };

  return (
    <div className="flex flex-col gap-1 w-[180px]">
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
        {label}
      </label>
      <Select onValueChange={handleChange}>
        <SelectTrigger className="h-9 bg-white border-slate-200">
          <SelectValue placeholder="All" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All</SelectItem>
          {options.map((opt) => (
            <SelectItem key={String(opt)} value={String(opt)}>
              {String(opt)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * COMPONENT: TextFilter
 * A Text Input that debounces typing and updates the Mosaic Selection with an ILIKE clause.
 */
export function TextFilter({ label, column, selection }: FilterProps) {
  const [val, setVal] = useState('');

  useEffect(() => {
    const handler = setTimeout(() => {
      // Clear filter if input is empty
      if (val.trim() === '') {
        selection.update({
          source: `filter-${column}`,
          predicate: null,
        });
        return;
      }

      // ARCHITECTURE NOTE:
      // Handle Struct Columns (dot notation) e.g. "related_phrase.phrase"
      // We use the shared util to generate "col".field
      const colExpr = createStructAccess(column);

      // Construct the ILIKE predicate
      const predicate = mSql.sql`${colExpr} ILIKE ${mSql.literal('%' + val + '%')}`;

      selection.update({
        source: `filter-${column}`,
        predicate,
      });
    }, 300); // 300ms debounce

    return () => clearTimeout(handler);
  }, [val, column, selection]);

  return (
    <div className="flex flex-col gap-1 w-[180px]">
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
        {label}
      </label>
      <Input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="h-9 bg-white border-slate-200"
        placeholder="Search..."
      />
    </div>
  );
}
