// Filter components for the Nozzle PAA view, implementing multi-select logic and facet queries.

import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import * as mSql from '@uwdata/mosaic-sql';
import { Check, ChevronDown, X } from 'lucide-react';
import { useMosaicFacetMenu } from '@nozzleio/mosaic-tanstack-react-table';
import type { MosaicSQLExpression } from '@nozzleio/mosaic-tanstack-react-table';
import type { MosaicClient, Selection } from '@uwdata/mosaic-core';

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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Local helper to avoid importing from core package which can cause build issues in example
function createStructAccess(columnPath: string): MosaicSQLExpression {
  if (!columnPath.includes('.')) {
    return mSql.column(columnPath);
  }

  const [head, ...tail] = columnPath.split('.');
  if (!head) {
    throw new Error(`Invalid column path: ${columnPath}`);
  }

  let expr: MosaicSQLExpression = mSql.column(head);
  for (const part of tail) {
    expr = mSql.sql`${expr}.${mSql.column(part)}`;
  }
  return expr;
}

// NOTE: With multi-select enabled in the FacetMenu, this hook is strictly for external read-only display.
// The FacetMenu manages its own state now.
function useSelectionValue(selection: Selection, client: MosaicClient) {
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

interface FilterProps {
  label: string;
  table: string;
  column: string;
  selection: Selection;
  filterBy?: Selection;
  externalContext?: Selection;
}

/**
 * Helper component for dropdown items that shouldn't steal focus.
 */
function PassiveMenuItem({
  children,
  isSelected,
  onClick,
}: {
  children: React.ReactNode;
  isSelected?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'relative flex cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      )}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        {isSelected && <Check className="h-4 w-4" />}
      </span>
      {children}
    </div>
  );
}

/**
 * COMPONENT: SearchableSelectFilter
 * Updated to support Multi-Selection logic using `toggle`.
 */
export function SearchableSelectFilter({
  label,
  table,
  column,
  selection,
  filterBy,
  externalContext,
}: FilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');

  // Use the new hook which manages the core class instance
  const { options, setSearchTerm, toggle, selectedValues } = useMosaicFacetMenu(
    {
      table,
      column,
      selection,
      filterBy,
      additionalContext: externalContext,
      limit: 50,
      sortMode: 'count',
      debugName: `Facet:${label}`,
    },
  );

  // Merge selectedValues into options to ensure selected items never disappear
  // regardless of external filtering.
  const displayOptions = useMemo(() => {
    // 1. Convert DB options to a set for fast lookup
    const dbOptionsSet = new Set(options);

    // 2. Find selected values that are NOT in the DB response
    // (This happens when another filter excludes them)
    const missingSelected = selectedValues.filter(
      (val) => !dbOptionsSet.has(val),
    );

    // 3. Return Union: MissingSelected + DB Options
    // We prepend missing items so they appear at the top, making it obvious they are selected.
    return [...missingSelected, ...options];
  }, [options, selectedValues]);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchValue);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchValue, setSearchTerm]);

  const handleSelect = (val: string | null) => {
    toggle(val);
    // We don't close isOpen automatically on multi-select to allow selecting multiple items
    if (val === null) {
      setIsOpen(false);
    }
  };

  const renderTriggerLabel = () => {
    if (selectedValues.length === 0) {
      return 'All';
    }
    if (selectedValues.length === 1) {
      return String(selectedValues[0]);
    }
    return `${selectedValues.length} selected`;
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
            <span className="truncate">{renderTriggerLabel()}</span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent className="w-[200px] p-0" align="start">
          <div className="flex items-center border-b px-3">
            <input
              className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Search..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            />
            {selectedValues.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(null);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          <div className="max-h-[300px] overflow-y-auto p-1">
            <PassiveMenuItem
              isSelected={selectedValues.length === 0}
              onClick={() => handleSelect(null)}
            >
              All
            </PassiveMenuItem>

            {displayOptions.map((opt) => (
              <PassiveMenuItem
                key={String(opt)}
                isSelected={selectedValues.includes(opt)}
                onClick={() => handleSelect(String(opt))}
              >
                {String(opt)}
              </PassiveMenuItem>
            ))}

            {displayOptions.length === 0 && (
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
 * Refactored to use useMosaicFacetMenu.
 * NOTE: Select primitive doesn't support multi-select well visually,
 * so this remains single-select but uses the updated toggle API.
 */
export function SelectFilter({
  label,
  table,
  column,
  selection,
  filterBy,
  externalContext,
}: FilterProps) {
  const { options, toggle, selectedValues } = useMosaicFacetMenu({
    table,
    column,
    selection,
    filterBy,
    additionalContext: externalContext,
    limit: 50,
    sortMode: 'count',
  });

  const handleChange = (val: string) => {
    // If value is "ALL", we toggle null to clear.
    // If value matches current, we toggle it (which removes it).
    // But since this is a Single Select UI, we just want to SET the value.
    // To Set via Toggle: Clear first, then Toggle.
    toggle(null);
    if (val !== 'ALL') {
      toggle(val);
    }
  };

  const valueForSelect =
    selectedValues.length > 0 ? String(selectedValues[0]) : 'ALL';

  return (
    <div className="flex flex-col gap-1 w-[180px]">
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
        {label}
      </label>
      <Select onValueChange={handleChange} value={valueForSelect}>
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
 * COMPONENT: ArraySelectFilter
 * Refactored to use useMosaicFacetMenu with isArrayColumn=true.
 * Updated for Multi-Select.
 */
export function ArraySelectFilter({
  label,
  table,
  column,
  selection,
  filterBy,
  externalContext,
}: FilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');

  const { options, setSearchTerm, toggle, selectedValues } = useMosaicFacetMenu(
    {
      table,
      column,
      selection,
      filterBy,
      additionalContext: externalContext,
      limit: 100,
      sortMode: 'alpha', // Tags usually better alpha
      isArrayColumn: true, // Enable UNNEST logic
      debugName: `FacetArray:${label}`,
    },
  );

  // Merge selectedValues into options here as well
  const displayOptions = useMemo(() => {
    const dbOptionsSet = new Set(options);
    const missingSelected = selectedValues.filter(
      (val) => !dbOptionsSet.has(val),
    );
    // For alpha sort mode, we might want to resort, but prepending is safer for "Selected Visibility"
    return [...missingSelected, ...options];
  }, [options, selectedValues]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchValue);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchValue, setSearchTerm]);

  // Updated to accept any FacetValue (matched against core definitions)
  const handleSelect = (val: any | null) => {
    toggle(val);
    if (val === null) {
      setIsOpen(false);
    }
  };

  const renderTriggerLabel = () => {
    if (selectedValues.length === 0) {
      return 'All';
    }
    if (selectedValues.length === 1) {
      return String(selectedValues[0]);
    }
    return `${selectedValues.length} selected`;
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
            <span className="truncate">{renderTriggerLabel()}</span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent className="w-[180px] p-0" align="start">
          <div className="flex items-center border-b px-3">
            <input
              className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Search..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            />
            {selectedValues.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(null);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          <div className="max-h-[300px] overflow-y-auto p-1">
            <PassiveMenuItem
              isSelected={selectedValues.length === 0}
              onClick={() => handleSelect(null)}
            >
              All
            </PassiveMenuItem>

            {displayOptions.map((opt) => {
              // Fix: Convert non-primitive React children to string for display and key
              const strVal = String(opt);
              return (
                <PassiveMenuItem
                  key={strVal}
                  isSelected={selectedValues.includes(opt)}
                  onClick={() => handleSelect(opt)}
                >
                  {strVal}
                </PassiveMenuItem>
              );
            })}

            {displayOptions.length === 0 && (
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
 * COMPONENT: TextFilter
 * Remains mostly the same, but uses a stable memoized source object for identity.
 */
export function TextFilter({ label, column, selection }: FilterProps) {
  const [val, setVal] = useState('');

  // Stable Source
  const filterSource = useMemo(() => ({ id: `filter-${column}` }), [column]);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (val.trim() === '') {
        selection.update({
          source: filterSource,
          value: null,
          predicate: null,
        });
        return;
      }

      const colExpr = createStructAccess(column);
      const predicate = mSql.sql`${colExpr} ILIKE ${mSql.literal('%' + val + '%')}`;

      selection.update({
        source: filterSource,
        value: val,
        predicate,
      });
    }, 300);

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
 * COMPONENT: DateRangeFilter
 * Remains mostly the same.
 */
export function DateRangeFilter({ label, column, selection }: FilterProps) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const filterSource = useMemo(
    () => ({ id: `filter-${column}-date` }),
    [column],
  );

  useEffect(() => {
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
