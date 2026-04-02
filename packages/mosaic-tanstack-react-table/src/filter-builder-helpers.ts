import { buildConditionPredicate } from '@nozzleio/mosaic-tanstack-table-core';

import type {
  ConditionComparableValue,
  ConditionValue,
  FilterOperator,
} from '@nozzleio/mosaic-tanstack-table-core';
import type { Selection, SelectionClause } from '@uwdata/mosaic-core';
import type {
  FilterDefinition,
  FilterRuntime,
  FilterValueKind,
} from './filter-builder-types';

type FilterBuilderDataType = 'string' | 'number' | 'date' | 'boolean';

export interface FilterBindingState {
  operator: string | null;
  value: unknown;
  valueTo: unknown;
}

type StoredFilterValue = {
  mode: 'CONDITION';
  operator: string | null;
  value?: unknown;
  valueTo?: unknown;
  dataType?: FilterBuilderDataType;
  filterId: string;
  scopeId: string;
};

type FilterBuilderSource = {
  id: string;
  column: string;
  debugName: string;
  filterId: string;
  scopeId: string;
};

const FILTER_SOURCE_BY_SELECTION = new WeakMap<
  Selection,
  FilterBuilderSource
>();

const DIRECT_OPERATOR_IDS = new Set<FilterOperator>([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'not_contains',
  'starts_with',
  'not_starts_with',
  'ends_with',
  'not_ends_with',
  'is_null',
  'not_null',
  'between',
  'in',
  'not_in',
]);

const UNARY_OPERATOR_IDS = new Set([
  'is_empty',
  'is_not_empty',
  'is_null',
  'not_null',
]);

function getFilterSource(filter: FilterRuntime): FilterBuilderSource {
  const existingSource = FILTER_SOURCE_BY_SELECTION.get(filter.selection);

  if (existingSource) {
    return existingSource;
  }

  const nextSource: FilterBuilderSource = {
    id: `filter-builder:${filter.scopeId}:${filter.definition.id}`,
    column: filter.definition.column,
    debugName: `filter-builder:${filter.scopeId}:${filter.definition.id}`,
    filterId: filter.definition.id,
    scopeId: filter.scopeId,
  };

  FILTER_SOURCE_BY_SELECTION.set(filter.selection, nextSource);

  return nextSource;
}

function inferDataType(definition: FilterDefinition): FilterBuilderDataType {
  if (definition.dataType) {
    return definition.dataType;
  }

  switch (definition.valueKind) {
    case 'date':
    case 'date-range':
      return 'date';
    case 'number':
    case 'number-range':
      return 'number';
    default:
      return 'string';
  }
}

export function getDefaultFilterOperator(
  definition: FilterDefinition,
): string | null {
  if (definition.defaultOperator) {
    return definition.defaultOperator;
  }

  const firstOperator = definition.operators[0];
  if (firstOperator) {
    return firstOperator;
  }

  switch (definition.valueKind) {
    case 'text':
      return 'contains';
    case 'facet-single':
    case 'facet-multi':
      return 'is';
    case 'date-range':
    case 'number-range':
      return 'between';
    default:
      return 'eq';
  }
}

function isRangeValueKind(valueKind: FilterValueKind) {
  return valueKind === 'date-range' || valueKind === 'number-range';
}

function isMultiValueKind(valueKind: FilterValueKind) {
  return valueKind === 'facet-multi';
}

function normalizeRangeTuple(
  value: unknown,
  valueTo: unknown,
): [unknown | null, unknown | null] {
  if (Array.isArray(value)) {
    const nextFrom = value[0] ?? null;
    const nextTo = value[1] ?? null;
    return [nextFrom, nextTo];
  }

  return [value ?? null, valueTo ?? null];
}

function normalizeStoredValue(
  definition: FilterDefinition,
  value: unknown,
): unknown {
  if (isRangeValueKind(definition.valueKind)) {
    const [rangeFrom, rangeTo] = normalizeRangeTuple(value, null);
    return [rangeFrom, rangeTo];
  }

  if (definition.valueKind === 'facet-single') {
    if (Array.isArray(value)) {
      return value[0] ?? null;
    }

    return value ?? null;
  }

  if (definition.valueKind === 'facet-multi') {
    if (Array.isArray(value)) {
      return value;
    }

    if (value === null || value === undefined || value === '') {
      return [];
    }

    return [value];
  }

  return value ?? null;
}

function isStoredFilterValue(value: unknown): value is StoredFilterValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'mode' in value &&
    value.mode === 'CONDITION'
  );
}

function isValueEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === '') {
    return true;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return true;
    }

    return value.every(
      (item) => item === null || item === undefined || item === '',
    );
  }

  return false;
}

function toComparableValue(value: unknown): ConditionComparableValue | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof Date
  ) {
    return value;
  }

  return null;
}

function toConditionValue(value: unknown): ConditionValue | null {
  if (Array.isArray(value)) {
    const values = value
      .map((item) => toComparableValue(item))
      .filter((item): item is ConditionComparableValue => item !== null);

    if (values.length === 0) {
      return null;
    }

    return values;
  }

  return toComparableValue(value);
}

function resolveOperatorAlias(
  definition: FilterDefinition,
  operator: string | null,
  value: unknown,
  valueTo: unknown,
): {
  operator: FilterOperator;
  value?: ConditionValue | null;
  valueTo?: ConditionComparableValue | null;
} | null {
  if (!operator) {
    return null;
  }

  if (UNARY_OPERATOR_IDS.has(operator)) {
    return {
      operator: operator === 'is_empty' ? 'is_null' : 'not_null',
    };
  }

  if (DIRECT_OPERATOR_IDS.has(operator as FilterOperator)) {
    if (operator === 'between' && isRangeValueKind(definition.valueKind)) {
      const [rangeFrom, rangeTo] = normalizeRangeTuple(value, valueTo);
      const fromValue = toComparableValue(rangeFrom);
      const toValue = toComparableValue(rangeTo);

      if (fromValue !== null && toValue !== null) {
        return {
          operator: 'between',
          value: fromValue,
          valueTo: toValue,
        };
      }

      if (fromValue !== null) {
        return {
          operator: 'gte',
          value: fromValue,
        };
      }

      if (toValue !== null) {
        return {
          operator: 'lte',
          value: toValue,
        };
      }

      return null;
    }

    return {
      operator: operator as FilterOperator,
      value: toConditionValue(value),
      valueTo: toComparableValue(valueTo),
    };
  }

  switch (operator) {
    case 'is':
      if (definition.valueKind === 'facet-multi') {
        return {
          operator: 'in',
          value: toConditionValue(value),
        };
      }
      return {
        operator: 'eq',
        value: toConditionValue(value),
      };
    case 'is_not':
      if (definition.valueKind === 'facet-multi') {
        return {
          operator: 'not_in',
          value: toConditionValue(value),
        };
      }
      return {
        operator: 'neq',
        value: toConditionValue(value),
      };
    case 'before':
      return {
        operator: 'lt',
        value: toConditionValue(
          isRangeValueKind(definition.valueKind)
            ? normalizeRangeTuple(value, valueTo)[0]
            : value,
        ),
      };
    case 'after':
      return {
        operator: 'gt',
        value: toConditionValue(
          isRangeValueKind(definition.valueKind)
            ? normalizeRangeTuple(value, valueTo)[0]
            : value,
        ),
      };
    case 'on_or_before':
      return {
        operator: 'lte',
        value: toConditionValue(
          isRangeValueKind(definition.valueKind)
            ? normalizeRangeTuple(value, valueTo)[0]
            : value,
        ),
      };
    case 'on_or_after':
      return {
        operator: 'gte',
        value: toConditionValue(
          isRangeValueKind(definition.valueKind)
            ? normalizeRangeTuple(value, valueTo)[0]
            : value,
        ),
      };
    case 'equals':
      return {
        operator: 'eq',
        value: toConditionValue(value),
      };
    case 'not_equals':
      return {
        operator: 'neq',
        value: toConditionValue(value),
      };
    case 'any_of':
      return {
        operator: 'in',
        value: toConditionValue(value),
      };
    case 'none_of':
      return {
        operator: 'not_in',
        value: toConditionValue(value),
      };
    default:
      return null;
  }
}

export function createEmptyFilterBindingState(
  definition: FilterDefinition,
): FilterBindingState {
  const operator = getDefaultFilterOperator(definition);

  if (isRangeValueKind(definition.valueKind)) {
    return {
      operator,
      value: [null, null],
      valueTo: null,
    };
  }

  if (isMultiValueKind(definition.valueKind)) {
    return {
      operator,
      value: [],
      valueTo: null,
    };
  }

  return {
    operator,
    value: null,
    valueTo: null,
  };
}

export function normalizeFilterBindingState(
  definition: FilterDefinition,
  rawValue: unknown,
): FilterBindingState {
  const fallbackState = createEmptyFilterBindingState(definition);

  if (rawValue === null || rawValue === undefined) {
    return fallbackState;
  }

  if (isStoredFilterValue(rawValue)) {
    const normalizedValue = normalizeStoredValue(definition, rawValue.value);

    if (isRangeValueKind(definition.valueKind)) {
      const [rangeFrom, rangeTo] = normalizeRangeTuple(
        normalizedValue,
        rawValue.valueTo,
      );
      return {
        operator: rawValue.operator ?? fallbackState.operator,
        value: [rangeFrom, rangeTo],
        valueTo: rangeTo,
      };
    }

    return {
      operator: rawValue.operator ?? fallbackState.operator,
      value: normalizedValue,
      valueTo: rawValue.valueTo ?? null,
    };
  }

  if (isRangeValueKind(definition.valueKind)) {
    const [rangeFrom, rangeTo] = normalizeRangeTuple(rawValue, null);
    return {
      operator: fallbackState.operator,
      value: [rangeFrom, rangeTo],
      valueTo: rangeTo,
    };
  }

  return {
    operator: fallbackState.operator,
    value: normalizeStoredValue(definition, rawValue),
    valueTo: null,
  };
}

function createStoredFilterValue(
  filter: FilterRuntime,
  state: FilterBindingState,
): StoredFilterValue {
  return {
    mode: 'CONDITION',
    operator: state.operator,
    value: state.value,
    valueTo: state.valueTo,
    dataType: inferDataType(filter.definition),
    filterId: filter.definition.id,
    scopeId: filter.scopeId,
  };
}

export function areFilterBindingStatesEqual(
  left: FilterBindingState,
  right: FilterBindingState,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function clearFilterSelection(filter: FilterRuntime): void {
  filter.selection.update({
    source: getFilterSource(filter),
    value: null,
    predicate: null,
  });
}

export function applyFilterSelection(
  filter: FilterRuntime,
  state: FilterBindingState,
): void {
  const operator =
    state.operator ?? getDefaultFilterOperator(filter.definition);

  if (!operator) {
    clearFilterSelection(filter);
    return;
  }

  if (!UNARY_OPERATOR_IDS.has(operator)) {
    const normalizedValue = normalizeStoredValue(
      filter.definition,
      state.value,
    );
    if (isValueEmpty(normalizedValue) && isValueEmpty(state.valueTo)) {
      clearFilterSelection(filter);
      return;
    }
  }

  const resolvedOperator = resolveOperatorAlias(
    filter.definition,
    operator,
    state.value,
    state.valueTo,
  );

  if (!resolvedOperator) {
    clearFilterSelection(filter);
    return;
  }

  const predicate = buildConditionPredicate({
    column: filter.definition.column,
    operator: resolvedOperator.operator,
    value: resolvedOperator.value,
    valueTo: resolvedOperator.valueTo,
    dataType: inferDataType(filter.definition),
  }) as SelectionClause['predicate'];

  if (!predicate) {
    clearFilterSelection(filter);
    return;
  }

  filter.selection.update({
    source: getFilterSource(filter),
    value: createStoredFilterValue(filter, {
      operator,
      value: normalizeStoredValue(filter.definition, state.value),
      valueTo: state.valueTo,
    }),
    predicate,
  });
}

export function getFacetSelectedValues(
  definition: FilterDefinition,
  state: FilterBindingState,
): Array<unknown> {
  if (definition.valueKind === 'facet-multi') {
    return Array.isArray(state.value) ? state.value : [];
  }

  if (state.value === null || state.value === undefined || state.value === '') {
    return [];
  }

  return [state.value];
}
