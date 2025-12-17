// examples/react/trimmed/src/components/paa/paa-filters.tsx

// Standalone filter components that directly interact with Mosaic Selections and DuckDB.

import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import * as mSql from '@uwdata/mosaic-sql';
import * as vg from '@uwdata/vgplot';
import { MosaicClient, isArrowTable } from '@uwdata/mosaic-core';
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
  selection: Selection; // The output selection to write to
  filterBy?: Selection; // The input selection to read from (for cascading)
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
 * Now returns the client instance to allow using it as the update source.
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
  const [clientInstance, setClientInstance] =
    useState<UniqueColumnValuesClient | null>(null);

  useEffect(() => {
    // Instantiate a Mosaic Client.
    // This client connects to the coordinator, runs a `SELECT DISTINCT column...` query,
    // and disconnects on unmount.
    const client = new UniqueColumnValuesClient({
      source: config.source,
      column: config.column,
      coordinator: config.coordinator || vg.coordinator(),
      // Pass the context filter (cascading context)
      filterBy: config.filterBy,
      // FIX: Cast values to any[] because the generic inference from FacetClientConfig
      // incorrectly infers the spread argument as `unknown` instead of `unknown[]`.
      onResult: (values: any) =>
        setOptions((values as Array<any>).filter((v) => v != null)),
      sortMode: config.sortMode,
      limit: config.limit,
      __debugName: `useUniqueColumnValues(Facet):${config.column}`,
    });

    setClientInstance(client);
    client.connect();
    client.requestUpdate();

    return () => client.disconnect();
  }, [
    config.source,
    config.column,
    config.sortMode,
    config.limit,
    config.filterBy, // Re-create if the context changes
  ]);

  return { options, client: clientInstance };
}

/**
 * COMPONENT: SelectFilter
 * A Dropdown that:
 * 1. Fetches unique values from DuckDB for the given column.
 * 2. Updates the passed Mosaic Selection on change.
 * 3. Respects `filterBy` for cascading options.
 */
export function SelectFilter({
  label,
  table,
  column,
  selection,
  filterBy,
}: FilterProps) {
  const { options, client } = useUniqueColumnValues({
    source: table,
    column: column,
    filterBy: filterBy, // Pass cascading context
    sortMode: 'count',
    limit: 50,
  });

  const handleChange = (val: string) => {
    if (!client) {
      return;
    }

    // FIX: Use createStructAccess to handle nested columns safely
    const colExpr = createStructAccess(column);

    // If 'ALL', we send null to remove the WHERE clause for this column
    const predicate =
      val === 'ALL' ? null : mSql.eq(colExpr, mSql.literal(val));

    selection.update({
      source: client, // Use the client as the source to enable Cross-Filtering
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
          value: null,
          predicate: null,
        });
        return;
      }

      // Handle Struct Columns (dot notation)
      const colExpr = createStructAccess(column);

      // Construct the ILIKE predicate
      const predicate = mSql.sql`${colExpr} ILIKE ${mSql.literal('%' + val + '%')}`;

      selection.update({
        source: filterSource,
        value: val,
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
 * 3. Handles cascading updates via manual subscription.
 */
export function ArraySelectFilter({
  label,
  table,
  column,
  selection,
  filterBy,
}: FilterProps) {
  const [options, setOptions] = useState<Array<string>>([]);

  // FIX: Create a real MosaicClient instance for identity.
  // This satisfies strict typing for `filterBy.predicate(client)`
  // and allows correct cross-filtering behavior.
  const client = useMemo(() => new MosaicClient(filterBy), [filterBy]);

  // 1. Fetch Unique Tags (UNNEST) - Reactively!
  useEffect(() => {
    let active = true;

    async function loadTags() {
      // Resolve the cascading filter predicate.
      // If we are part of a cross-filter group, passing `client` ensures we exclude ourselves.
      const rawPredicate = filterBy ? filterBy.predicate(client) : null;

      // Ensure the predicate is a valid SQL Node for query builder.
      // If predicate is an array (implicit AND), wrap it.
      const safePredicate = Array.isArray(rawPredicate)
        ? mSql.and(...rawPredicate)
        : rawPredicate;

      // FIX: Use Mosaic Query Builder instead of manual string interpolation
      // This prevents syntax errors like '... "table" 'WHERE ...' ORDER BY ...'
      // where the WHERE clause was being treated as a string literal.
      const colExpr = createStructAccess(column);

      let query = mSql.Query.from(table)
        .select({ tag: mSql.unnest(colExpr) })
        .distinct()
        .orderby(mSql.asc('tag'))
        .limit(100);

      if (safePredicate) {
        query = query.where(safePredicate);
      }

      try {
        const result = await vg.coordinator().query(query.toString());

        if (active && isArrowTable(result)) {
          const rows = result.toArray();
          const tags = rows
            .map((r: any) => r.tag)
            .filter((t: any) => t != null)
            .map(String);
          setOptions(tags);
        }
      } catch (err) {
        console.error('ArraySelectFilter query error:', err);
      }
    }

    // Initial Load
    loadTags();

    // Subscribe to context changes (cascading)
    const handler = () => {
      loadTags();
    };

    if (filterBy) {
      filterBy.addEventListener('value', handler);
    }

    return () => {
      active = false;
      if (filterBy) {
        filterBy.removeEventListener('value', handler);
      }
    };
  }, [table, column, filterBy, client]);

  const handleChange = (val: string) => {
    // FIX: Use createStructAccess to handle nested columns safely
    const colExpr = createStructAccess(column);

    // If 'ALL', we send null to remove the WHERE clause for this column
    const predicate =
      val === 'ALL' ? null : mSql.listContains(colExpr, mSql.literal(val));

    selection.update({
      source: client,
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
