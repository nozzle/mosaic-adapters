import * as React from 'react';
import { useFilterFacet } from '@nozzleio/mosaic-tanstack-react-table';

import type {
  FilterBinding,
  FilterRuntime,
} from '@nozzleio/mosaic-tanstack-react-table';
import type { Selection as MosaicSelection } from '@uwdata/mosaic-core';

const UNARY_OPERATORS = new Set(['is_empty', 'is_not_empty']);

function isUnaryOperator(operator: string | null) {
  if (!operator) {
    return false;
  }

  return UNARY_OPERATORS.has(operator);
}

function isEmptyFacetValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return value === null || value === undefined || value === '';
}

function toInputValue(value: unknown) {
  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'string') {
    return value;
  }

  return '';
}

function toSingleInputValue(value: unknown) {
  if (Array.isArray(value)) {
    return toInputValue(value[0]);
  }

  return toInputValue(value);
}

function normalizeNumberValue(rawValue: string) {
  if (!rawValue) {
    return null;
  }

  return Number(rawValue);
}

export function DynamicFilterEditor({
  binding,
  filter,
  filterBy,
  scopeId,
  scopeLabel,
}: {
  binding: FilterBinding;
  filter: FilterRuntime;
  filterBy?: MosaicSelection;
  scopeId: string;
  scopeLabel: string;
}) {
  const isFacetFilter =
    filter.definition.valueKind === 'facet-single' ||
    filter.definition.valueKind === 'facet-multi';
  const facet = useFilterFacet({
    filter,
    filterBy,
    enabled: isFacetFilter,
  });
  const [facetSearchTerm, setFacetSearchTerm] = React.useState('');
  const [pendingFacetApply, setPendingFacetApply] = React.useState(0);
  const lastAppliedFacetToken = React.useRef(0);
  const previousOperator = React.useRef(binding.operator);
  const suppressNextFacetSingleBlur = React.useRef(false);
  const unary = isUnaryOperator(binding.operator);

  React.useEffect(() => {
    if (pendingFacetApply === 0) {
      return;
    }

    if (pendingFacetApply === lastAppliedFacetToken.current) {
      return;
    }

    lastAppliedFacetToken.current = pendingFacetApply;
    binding.apply();
  }, [binding, pendingFacetApply]);

  React.useEffect(() => {
    if (!isFacetFilter) {
      previousOperator.current = binding.operator;
      return;
    }

    if (previousOperator.current === binding.operator) {
      return;
    }

    previousOperator.current = binding.operator;
    if (unary || isEmptyFacetValue(binding.value)) {
      return;
    }

    binding.apply();
  }, [binding, isFacetFilter, unary]);

  if (filter.definition.valueKind === 'text') {
    return (
      <FilterValueShell label="Value">
        {unary ? (
          <ApplyUnaryButton
            binding={binding}
            filterLabel={filter.definition.label}
            scopeLabel={scopeLabel}
          />
        ) : (
          <input
            aria-label={`${scopeLabel} ${filter.definition.label} value`}
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm"
            type="text"
            value={toSingleInputValue(binding.value)}
            onChange={(event) => binding.setValue(event.target.value)}
            onBlur={() => binding.apply()}
          />
        )}
      </FilterValueShell>
    );
  }

  if (filter.definition.valueKind === 'facet-single') {
    const value = Array.isArray(binding.value)
      ? toSingleInputValue(binding.value)
      : toInputValue(binding.value);

    return (
      <FilterValueShell label="Value">
        {unary ? (
          <ApplyUnaryButton
            binding={binding}
            filterLabel={filter.definition.label}
            scopeLabel={scopeLabel}
          />
        ) : (
          <select
            aria-label={`${scopeLabel} ${filter.definition.label} value`}
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm"
            value={value}
            onChange={(event) => {
              const nextValue = event.target.value;
              if (!nextValue) {
                suppressNextFacetSingleBlur.current = true;
                binding.clear();
                return;
              }

              suppressNextFacetSingleBlur.current = false;
              binding.setValue(nextValue);
              setPendingFacetApply((previousValue) => previousValue + 1);
            }}
            onBlur={() => {
              if (suppressNextFacetSingleBlur.current) {
                suppressNextFacetSingleBlur.current = false;
                return;
              }

              if (isEmptyFacetValue(binding.value)) {
                return;
              }

              binding.apply();
            }}
          >
            <option value="">All</option>
            {facet.options.map((option) => {
              const optionValue = toInputValue(option);
              return (
                <option key={optionValue} value={optionValue}>
                  {optionValue}
                </option>
              );
            })}
          </select>
        )}
      </FilterValueShell>
    );
  }

  if (filter.definition.valueKind === 'facet-multi') {
    const selectedValues = Array.isArray(binding.value) ? binding.value : [];

    return (
      <FilterValueShell label="Values">
        {unary ? (
          <ApplyUnaryButton
            binding={binding}
            filterLabel={filter.definition.label}
            scopeLabel={scopeLabel}
          />
        ) : (
          <div className="grid gap-2">
            <input
              aria-label={`${scopeId} ${filter.definition.label} option search`}
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm"
              placeholder="Search options..."
              value={facetSearchTerm}
              onChange={(event) => {
                const nextValue = event.target.value;
                setFacetSearchTerm(nextValue);
                facet.setSearchTerm(nextValue);
              }}
            />
            <div className="max-h-36 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2">
              <div className="grid gap-2">
                {facet.options.map((option) => {
                  const optionLabel = toInputValue(option);
                  const checked = selectedValues.some((selectedValue) =>
                    Object.is(selectedValue, option),
                  );

                  return (
                    <label
                      key={optionLabel}
                      className="flex items-center gap-2 text-sm text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const nextValues = checked
                            ? selectedValues.filter(
                                (selectedValue) =>
                                  !Object.is(selectedValue, option),
                              )
                            : [...selectedValues, option];

                          binding.setValue(nextValues);
                          setPendingFacetApply(
                            (previousValue) => previousValue + 1,
                          );
                        }}
                      />
                      <span>{optionLabel}</span>
                    </label>
                  );
                })}
                {facet.loading && (
                  <p className="text-sm text-slate-500">Loading options…</p>
                )}
                {!facet.loading && facet.options.length === 0 && (
                  <p className="text-sm text-slate-500">
                    No facet options found.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </FilterValueShell>
    );
  }

  if (
    filter.definition.valueKind === 'date-range' ||
    filter.definition.valueKind === 'number-range'
  ) {
    const rangeValue = Array.isArray(binding.value)
      ? binding.value
      : [binding.value, binding.valueTo];
    const fromValue = rangeValue[0] ?? null;
    const toValue = rangeValue[1] ?? null;
    const inputType =
      filter.definition.valueKind === 'date-range' ? 'date' : 'number';

    return (
      <FilterValueShell label="Value">
        {unary ? (
          <ApplyUnaryButton
            binding={binding}
            filterLabel={filter.definition.label}
            scopeLabel={scopeLabel}
          />
        ) : (
          <div className="grid gap-2">
            <div className="grid gap-2 md:grid-cols-2">
              <input
                aria-label={`${scopeLabel} ${filter.definition.label} start`}
                className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm"
                type={inputType}
                value={toInputValue(fromValue)}
                onChange={(event) => {
                  const nextValue =
                    inputType === 'number'
                      ? normalizeNumberValue(event.target.value)
                      : event.target.value || null;
                  binding.setValue(nextValue);
                }}
              />
              {binding.operator === 'between' && (
                <input
                  aria-label={`${scopeLabel} ${filter.definition.label} end`}
                  className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm"
                  type={inputType}
                  value={toInputValue(toValue)}
                  onChange={(event) => {
                    const nextValue =
                      inputType === 'number'
                        ? normalizeNumberValue(event.target.value)
                        : event.target.value || null;
                    binding.setValueTo(nextValue);
                  }}
                />
              )}
            </div>
            <div className="flex justify-start">
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 px-3 text-sm text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                onClick={() => binding.apply()}
              >
                Apply
              </button>
            </div>
          </div>
        )}
      </FilterValueShell>
    );
  }

  return (
    <FilterValueShell label="Value">
      <p className="text-sm text-slate-500">Unsupported filter editor.</p>
    </FilterValueShell>
  );
}

function FilterValueShell({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="grid gap-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      {children}
    </div>
  );
}

function ApplyUnaryButton({
  binding,
  filterLabel,
  scopeLabel,
}: {
  binding: FilterBinding;
  filterLabel: string;
  scopeLabel: string;
}) {
  return (
    <div className="flex justify-start">
      <button
        type="button"
        className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 px-3 text-sm text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
        onClick={() => binding.apply()}
        aria-label={`Apply ${scopeLabel} ${filterLabel} filter`}
      >
        Apply
      </button>
    </div>
  );
}
