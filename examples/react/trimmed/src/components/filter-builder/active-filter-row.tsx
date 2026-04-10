import * as React from 'react';
import { useFilterBinding } from '@nozzleio/mosaic-tanstack-react-table';

import type { FilterRuntime } from '@nozzleio/mosaic-tanstack-react-table';
import type { Selection as MosaicSelection } from '@uwdata/mosaic-core';
import { DynamicFilterEditor } from '@/components/filter-builder/dynamic-filter-editor';

const OPERATOR_LABELS: Record<string, string> = {
  contains: 'contains',
  does_not_contain: 'does not contain',
  starts_with: 'starts with',
  ends_with: 'ends with',
  is_exactly: 'is exactly',
  equals: 'equals',
  not_equals: 'does not equal',
  eq: 'equals',
  neq: 'does not equal',
  gt: 'is greater than',
  gte: 'is at least',
  lt: 'is before',
  lte: 'is at most',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  is: 'is',
  is_not: 'is not',
  is_any_of: 'is any of',
  is_not_any_of: 'is not any of',
  any_of: 'is any of',
  none_of: 'is not any of',
  includes_all: 'includes all',
  excludes_all: 'excludes all',
  between: 'between',
  before: 'before',
  after: 'after',
  on_or_before: 'on or before',
  on_or_after: 'on or after',
};

export function ActiveFilterRow({
  filter,
  filterBy,
  scopeId,
  scopeLabel,
  onRemoveFilter,
}: {
  filter: FilterRuntime;
  filterBy?: MosaicSelection;
  scopeId: string;
  scopeLabel: string;
  onRemoveFilter: (id: string) => void;
}) {
  const binding = useFilterBinding(filter);
  const showOperatorSelect = filter.definition.operators.length > 1;

  return (
    <div
      className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-[minmax(10rem,0.8fr)_minmax(11rem,0.9fr)_minmax(0,1.6fr)_auto] lg:items-start"
      data-testid={`${scopeId}-active-filter-${filter.definition.id}`}
    >
      <div className="grid gap-1">
        <p className="text-sm font-semibold text-slate-900">
          {filter.definition.label}
        </p>
        {filter.definition.description && (
          <p className="text-xs text-slate-500">
            {filter.definition.description}
          </p>
        )}
      </div>

      <div className="grid gap-1">
        <label
          className="text-xs font-semibold uppercase tracking-wide text-slate-500"
          htmlFor={`${scopeId}-${filter.definition.id}-operator`}
        >
          Operator
        </label>
        {showOperatorSelect ? (
          <select
            id={`${scopeId}-${filter.definition.id}-operator`}
            aria-label={`${scopeLabel} ${filter.definition.label} operator`}
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm"
            value={binding.operator ?? ''}
            onChange={(event) => binding.setOperator(event.target.value)}
          >
            {filter.definition.operators.map((operator) => (
              <option key={operator} value={operator}>
                {OPERATOR_LABELS[operator] ?? operator}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600">
            {OPERATOR_LABELS[binding.operator ?? ''] ??
              binding.operator ??
              'n/a'}
          </div>
        )}
      </div>

      <DynamicFilterEditor
        binding={binding}
        filter={filter}
        filterBy={filterBy}
        scopeId={scopeId}
        scopeLabel={scopeLabel}
      />

      <div className="flex items-start justify-end">
        <button
          type="button"
          className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 px-3 text-sm text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
          onClick={() => {
            binding.clear();
            onRemoveFilter(filter.definition.id);
          }}
          aria-label={`Remove ${filter.definition.label} filter from ${scopeLabel}`}
        >
          Remove
        </button>
      </div>
    </div>
  );
}
