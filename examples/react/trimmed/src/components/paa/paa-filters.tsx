// Filter components for the Nozzle PAA view, refactored to delegate logic to Core.

import * as React from 'react';
import { useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import {
  useMosaicFacetMenu,
  useMosaicFilter,
} from '@nozzleio/mosaic-tanstack-react-table';
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface FilterProps {
  label: string;
  table: string;
  column: string;
  selection: Selection;
  filterBy?: Selection;
  externalContext?: Selection;
}

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

  const { displayOptions, setSearchTerm, toggle, selectedValues } =
    useMosaicFacetMenu({
      table,
      column,
      selection,
      filterBy,
      additionalContext: externalContext,
      limit: 50,
      sortMode: 'count',
      debugName: `Facet:${label}`,
    });

  const handleSearchChange = (val: string) => {
    setSearchValue(val);
    setSearchTerm(val);
  };

  const handleSelect = (val: string | null) => {
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
              onChange={(e) => handleSearchChange(e.target.value)}
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
 */
export function SelectFilter({
  label,
  table,
  column,
  selection,
  filterBy,
  externalContext,
}: FilterProps) {
  const { displayOptions, toggle, selectedValues } = useMosaicFacetMenu({
    table,
    column,
    selection,
    filterBy,
    additionalContext: externalContext,
    limit: 50,
    sortMode: 'count',
  });

  const handleChange = (val: string) => {
    toggle(null); // Clear previous (Single Select behavior)
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
          {displayOptions.map((opt) => (
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

  const { displayOptions, setSearchTerm, toggle, selectedValues } =
    useMosaicFacetMenu({
      table,
      column,
      selection,
      filterBy,
      additionalContext: externalContext,
      limit: 100,
      sortMode: 'alpha',
      isArrayColumn: true,
      debugName: `FacetArray:${label}`,
    });

  const handleSearchChange = (val: string) => {
    setSearchValue(val);
    setSearchTerm(val);
  };

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
              onChange={(e) => handleSearchChange(e.target.value)}
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
 * Refactored: Uses useMosaicFilter hook
 */
export function TextFilter({ label, column, selection }: FilterProps) {
  const filter = useMosaicFilter({
    selection,
    column,
    mode: 'TEXT',
    debounceTime: 300,
  });

  const [val, setVal] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setVal(value);
    filter.setValue(value);
  };

  return (
    <div className="flex flex-col gap-1 w-[180px]">
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
        {label}
      </label>
      <Input
        value={val}
        onChange={handleChange}
        className="h-9 bg-white border-slate-200"
        placeholder="Search..."
      />
    </div>
  );
}

/**
 * COMPONENT: DateRangeFilter
 * Refactored: Uses useMosaicFilter hook
 */
export function DateRangeFilter({ label, column, selection }: FilterProps) {
  const filter = useMosaicFilter({
    selection,
    column,
    mode: 'DATE_RANGE',
  });

  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  React.useEffect(() => {
    filter.setValue([start || null, end || null]);
  }, [start, end, filter]);

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
