import * as React from 'react';

import type { FilterDefinition } from '@nozzleio/mosaic-tanstack-react-table';
import { getFilterCatalogSections } from '@/components/filter-builder/builder-state';

export interface AddFilterMenuProps {
  scopeId: string;
  title: string;
  availableDefinitions: Array<FilterDefinition>;
  searchTerm: string;
  onSearchTermChange: (next: string) => void;
  onAddFilter: (id: string) => void;
}

export function AddFilterMenu({
  scopeId,
  title,
  availableDefinitions,
  searchTerm,
  onSearchTermChange,
  onAddFilter,
}: AddFilterMenuProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const sections = React.useMemo(
    () => getFilterCatalogSections(availableDefinitions),
    [availableDefinitions],
  );

  const closeMenu = React.useCallback(() => {
    setIsOpen(false);
    onSearchTermChange('');
  }, [onSearchTermChange]);

  return (
    <div className="grid gap-2">
      <button
        type="button"
        className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 shadow-sm transition hover:border-slate-400"
        onClick={() => {
          if (isOpen) {
            closeMenu();
            return;
          }

          setIsOpen(true);
        }}
      >
        Add Filter
      </button>
      {isOpen && (
        <div className="grid min-w-[18rem] gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          <div className="grid gap-1">
            <p className="text-sm font-medium text-slate-900">{title}</p>
            <input
              aria-label={`${scopeId} filter search`}
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm"
              placeholder="Search filters..."
              value={searchTerm}
              onChange={(event) => onSearchTermChange(event.target.value)}
            />
          </div>
          {sections.length === 0 && (
            <p className="text-sm text-slate-500">
              All filters are already active for this scope.
            </p>
          )}
          {sections.map((section) => (
            <div key={section.id} className="grid gap-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {section.label}
              </p>
              <div className="grid gap-1">
                {section.filters.map((definition) => (
                  <button
                    key={definition.id}
                    type="button"
                    className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                    onClick={() => {
                      onAddFilter(definition.id);
                      closeMenu();
                    }}
                  >
                    <span>{definition.label}</span>
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      {definition.valueKind}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="flex justify-end">
            <button
              type="button"
              className="text-sm text-slate-500 transition hover:text-slate-700"
              onClick={closeMenu}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
