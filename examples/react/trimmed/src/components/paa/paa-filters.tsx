// examples/react/trimmed/src/components/paa/paa-filters.tsx

// Standalone filter components that directly interact with Mosaic Selections and DuckDB.

import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import * as mSql from '@uwdata/mosaic-sql';
import * as vg from '@uwdata/vgplot';
import { MosaicClient, isArrowTable } from '@uwdata/mosaic-core';
import { UniqueColumnValuesClient } from '@nozzleio/mosaic-tanstack-react-table';
import { Check, ChevronDown } from 'lucide-react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

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

function useSelectionValue(selection: Selection, client: any) {
  const [value, setValue] = useState(selection.valueFor(client));

  useEffect(() => {
    const handler = () => {
      setValue(selection.valueFor(client));
    };
    selection.addEventListener('value', handler);
    return () => selection.removeEventListener('value', handler);
  }, [selection, client]);

  return value;
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
  const [searchTerm, setSearchTerm] = useState('');

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

  // Propagate search term to client without re-creating logic
  useEffect(() => {
    if (clientInstance) {
      clientInstance.setSearchTerm(searchTerm);
    }
  }, [clientInstance, searchTerm]);

  return { options, client: clientInstance, setSearchTerm };
}

/**
 * COMPONENT: SearchableSelectFilter
 * A Combobox (Input + Dropdown) that:
 * 1. Fetches unique values from DuckDB for the given column.
 * 2. Allows server-side searching via ILIKE.
 * 3. Updates the passed Mosaic Selection on change.
 * 4. Respects `filterBy` for cascading options.
 */
export function SearchableSelectFilter({
  label,
  table,
  column,
  selection,
  filterBy,
}: FilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');

  const { options, client, setSearchTerm } = useUniqueColumnValues({
    source: table,
    column: column,
    filterBy: filterBy,
    sortMode: 'count',
    limit: 50,
  });

  // Debounce search input to the Mosaic Client
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchValue);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchValue, setSearchTerm]);

  // Read current value from selection for display
  const selectedValue = useSelectionValue(selection, client);

  const handleSelect = (val: string | null) => {
    if (!client) {
      return;
    }

    // FIX: Use createStructAccess to handle nested columns safely
    const colExpr = createStructAccess(column);

    // If null/All, we send null to remove the WHERE clause for this column
    const predicate = val === null ? null : mSql.eq(colExpr, mSql.literal(val));

    selection.update({
      source: client,
      value: val,
      predicate,
    });
    setIsOpen(false);
  };

  return (
    <div className="flex flex-col gap-1 w-[200px]">
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
        {label}
      </label>

      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            className="w-full justify-between bg-white font-normal h-9 border-slate-200"
          >
            <span className="truncate">
              {selectedValue ? String(selectedValue) : 'All'}
            </span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent className="w-[200px] p-0" align="start">
          {/* Search Input Area */}
          <div className="flex items-center border-b px-3">
            <input
              className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Search..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              // Prevent auto-close on click
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div className="max-h-[300px] overflow-y-auto p-1">
            <DropdownMenuItem onSelect={() => handleSelect(null)}>
              <Check
                className={`mr-2 h-4 w-4 ${!selectedValue ? 'opacity-100' : 'opacity-0'}`}
              />
              All
            </DropdownMenuItem>

            {options.map((opt) => (
              <DropdownMenuItem
                key={String(opt)}
                onSelect={() => handleSelect(String(opt))}
              >
                <Check
                  className={`mr-2 h-4 w-4 ${selectedValue === String(opt) ? 'opacity-100' : 'opacity-0'}`}
                />
                {String(opt)}
              </DropdownMenuItem>
            ))}

            {options.length === 0 && (
              <div className="py-6 text-center text-sm text-slate-500">
                No results found.
              </div>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * COMPONENT: SelectFilter
 * Keeps basic select functionality but uses the useUniqueColumnValues hook.
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

    const colExpr = createStructAccess(column);
    const predicate =
      val === 'ALL' ? null : mSql.eq(colExpr, mSql.literal(val));

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
 * 4. Supports Server-Side Search on unnested tags.
 */
export function ArraySelectFilter({
  label,
  table,
  column,
  selection,
  filterBy,
}: FilterProps) {
  const [options, setOptions] = useState<Array<string>>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // FIX: Create a real MosaicClient instance for identity.
  // This satisfies strict typing for `filterBy.predicate(client)`
  // and allows correct cross-filtering behavior.
  const client = useMemo(() => new MosaicClient(filterBy), [filterBy]);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchValue);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchValue]);

  // 1. Fetch Unique Tags (UNNEST) - Reactively!
  useEffect(() => {
    let active = true;

    async function loadTags() {
      // Resolve the cascading filter predicate.
      const rawPredicate = filterBy ? filterBy.predicate(client) : null;

      const safePredicate = Array.isArray(rawPredicate)
        ? mSql.and(...rawPredicate)
        : rawPredicate;

      const colExpr = createStructAccess(column);

      // Base query: UNNEST -> DISTINCT -> ORDER
      let query = mSql.Query.from(table)
        .select({ tag: mSql.unnest(colExpr) })
        .distinct()
        .orderby(mSql.asc('tag'))
        .limit(100);

      // Apply Context Filters
      if (safePredicate) {
        query = query.where(safePredicate);
      }

      // Apply Search Filter (on the alias 'tag')
      if (searchTerm) {
        // We filter on the unnested alias 'tag'
        query.where(
          mSql.sql`tag ILIKE ${mSql.literal('%' + searchTerm + '%')}`,
        );
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

    // Load on mount, search change, or context change
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
  }, [table, column, filterBy, client, searchTerm]);

  // Read current value from selection
  const selectedValue = useSelectionValue(selection, client);

  const handleSelect = (val: string | null) => {
    const colExpr = createStructAccess(column);

    const predicate =
      val === null ? null : mSql.listContains(colExpr, mSql.literal(val));

    selection.update({
      source: client,
      value: val,
      predicate,
    });
    setIsOpen(false);
  };

  return (
    <div className="flex flex-col gap-1 w-[180px]">
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
        {label}
      </label>

      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            className="w-full justify-between bg-white font-normal h-9 border-slate-200"
          >
            <span className="truncate">
              {selectedValue ? String(selectedValue) : 'All'}
            </span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent className="w-[180px] p-0" align="start">
          {/* Search Input Area */}
          <div className="flex items-center border-b px-3">
            <input
              className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Search..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div className="max-h-[300px] overflow-y-auto p-1">
            <DropdownMenuItem onSelect={() => handleSelect(null)}>
              <Check
                className={`mr-2 h-4 w-4 ${!selectedValue ? 'opacity-100' : 'opacity-0'}`}
              />
              All
            </DropdownMenuItem>

            {options.map((opt) => (
              <DropdownMenuItem key={opt} onSelect={() => handleSelect(opt)}>
                <Check
                  className={`mr-2 h-4 w-4 ${selectedValue === opt ? 'opacity-100' : 'opacity-0'}`}
                />
                {opt}
              </DropdownMenuItem>
            ))}

            {options.length === 0 && (
              <div className="py-6 text-center text-sm text-slate-500">
                No results found.
              </div>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
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
