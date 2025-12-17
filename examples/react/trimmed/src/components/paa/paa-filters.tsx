// Standalone filter components that directly interact with Mosaic Selections and DuckDB.

import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import * as mSql from '@uwdata/mosaic-sql';
import * as vg from '@uwdata/vgplot';
import { isArrowTable } from '@uwdata/mosaic-core';
import { UniqueColumnValuesClient } from '@nozzleio/mosaic-tanstack-react-table';
import type { FacetClientConfig } from '@nozzleio/mosaic-tanstack-react-table';
import type { Selection } from '@uwdata/mosaic-core';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface FilterProps {
  label: string;
  table: string;
  column: string;
  selection: Selection; // The global filter to update
}

// Local helper to avoid importing from core package which can cause build issues in example
function createStructAccess(columnPath: string): any {
  if (!columnPath.includes('.')) {
    return mSql.column(columnPath);
  }

  const parts = columnPath.split('.');
  return parts.reduce((acc, part, index) => {
    if (index === 0) {
      return mSql.column(part);
    }
    // Correctly wrap child parts in column() to ensure quoting (e.g. "table"."col")
    return mSql.sql`${acc}.${mSql.column(part)}`;
  }, null as any);
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
  const [options, setOptions] = useState<Array<any>>([]);

  useEffect(() => {
    // Instantiate a transient Mosaic Client.
    // This client connects to the coordinator, runs a `SELECT DISTINCT column...` query,
    // and disconnects on unmount.
    const client = new UniqueColumnValuesClient({
      source: config.source,
      column: config.column,
      coordinator: config.coordinator || vg.coordinator(),
      // FIX: Cast values to any[] because the generic inference from FacetClientConfig
      // incorrectly infers the spread argument as `unknown` instead of `unknown[]`.
      onResult: (values: any) =>
        setOptions((values as Array<any>).filter((v) => v != null)),
      sortMode: config.sortMode,
      limit: config.limit,
      __debugName: `useUniqueColumnValues(Facet):${config.column}`,
    });

    client.connect();
    client.requestUpdate();

    return () => client.disconnect();
  }, [config.source, config.column, config.sortMode, config.limit]);

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
    sortMode: 'count',
    limit: 50,
  });

  // FIX: Create a stable object reference for the selection source.
  // Mosaic requires `source` to be an object (not a string) to track identity.
  const filterSource = useMemo(() => ({ id: `filter-${column}` }), [column]);

  const handleChange = (val: string) => {
    // FIX: Use createStructAccess to handle nested columns safely
    const colExpr = createStructAccess(column);

    // If 'ALL', we send null to remove the WHERE clause for this column
    const predicate =
      val === 'ALL' ? null : mSql.eq(colExpr, mSql.literal(val));

    selection.update({
      source: filterSource,
      value: val === 'ALL' ? null : val, // FIX: Added required 'value' property
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

  // FIX: Create a stable object reference for the selection source.
  const filterSource = useMemo(() => ({ id: `filter-${column}` }), [column]);

  useEffect(() => {
    const handler = setTimeout(() => {
      // Clear filter if input is empty
      if (val.trim() === '') {
        selection.update({
          source: filterSource,
          value: null, // FIX: Added required 'value' property
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
        source: filterSource,
        value: val, // FIX: Added required 'value' property
        predicate,
      });
    }, 300); // 300ms debounce

    return () => clearTimeout(handler);
  }, [val, column, selection, filterSource]);

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

/**
 * COMPONENT: ArraySelectFilter
 * Designed for VARCHAR[] columns (e.g. keyword_groups).
 * 1. Uses UNNEST() to find unique tags for the dropdown.
 * 2. Uses list_contains() for the filter predicate.
 */
export function ArraySelectFilter({
  label,
  table,
  column,
  selection,
}: FilterProps) {
  const [options, setOptions] = useState<Array<string>>([]);
  const filterSource = useMemo(
    () => ({ id: `filter-${column}-array` }),
    [column],
  );

  // 1. Fetch Unique Tags (UNNEST)
  useEffect(() => {
    async function loadTags() {
      // We manually construct this query because the generic clients don't support UNNEST well yet
      // Note: We interpolate ${column} directly here as a string.
      // If column contains a dot, it works in DuckDB SQL as struct access.
      const sql = `
        SELECT DISTINCT UNNEST(${column}) as tag 
        FROM ${table} 
        WHERE ${column} IS NOT NULL 
        ORDER BY tag ASC 
        LIMIT 100
      `;

      const result = await vg.coordinator().query(sql);

      // Parse Arrow result
      if (isArrowTable(result)) {
        const rows = result.toArray();
        const tags = rows
          .map((r: any) => r.tag)
          .filter((t: any) => t != null)
          .map(String);
        setOptions(tags);
      }
    }
    loadTags();
  }, [table, column]);

  const handleChange = (val: string) => {
    // FIX: Use createStructAccess to handle nested columns safely
    const colExpr = createStructAccess(column);

    // If 'ALL', we send null to remove the WHERE clause for this column
    const predicate =
      val === 'ALL' ? null : mSql.listContains(colExpr, mSql.literal(val));

    selection.update({
      source: filterSource,
      value: val === 'ALL' ? null : val,
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
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * COMPONENT: DateRangeFilter
 * Native Date inputs for TIMESTAMP columns.
 */
export function DateRangeFilter({ label, column, selection }: FilterProps) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const filterSource = useMemo(
    () => ({ id: `filter-${column}-date` }),
    [column],
  );

  useEffect(() => {
    // 1. Build Predicate based on Start/End presence
    // FIX: Use createStructAccess to handle nested columns safely
    const colRef = createStructAccess(column);
    let predicate = null;
    let valueDisplay = null;

    if (start && end) {
      predicate = mSql.isBetween(colRef, [
        mSql.literal(new Date(start)),
        mSql.literal(new Date(end)),
      ]);
      valueDisplay = `${start} to ${end}`;
    } else if (start) {
      predicate = mSql.gte(colRef, mSql.literal(new Date(start)));
      valueDisplay = `>= ${start}`;
    } else if (end) {
      predicate = mSql.lte(colRef, mSql.literal(new Date(end)));
      valueDisplay = `<= ${end}`;
    }

    // 2. Update Selection
    selection.update({
      source: filterSource,
      value: valueDisplay,
      predicate,
    });
  }, [start, end, column, selection, filterSource]);

  return (
    <div className="flex flex-col gap-1 w-[260px]">
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="date"
          className="h-9 w-full px-2 text-sm border border-slate-200 rounded bg-white outline-none focus:border-blue-500"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
        <span className="text-slate-400">-</span>
        <input
          type="date"
          className="h-9 w-full px-2 text-sm border border-slate-200 rounded bg-white outline-none focus:border-blue-500"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
        />
      </div>
    </div>
  );
}
