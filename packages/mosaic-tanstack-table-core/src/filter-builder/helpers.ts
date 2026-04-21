import {
  buildCollectionPredicate,
  buildConditionPredicate,
  buildEmptyValuePredicate,
} from '../condition-predicate';

import type {
  ColumnType,
  ConditionComparableValue,
  ConditionValue,
  FilterOperator,
} from '../types';
import type { Selection, SelectionClause } from '@uwdata/mosaic-core';
import type {
  FilterBindingState,
  FilterDefinition,
  FilterRuntime,
  FilterValueKind,
} from './types';

type FilterBuilderDataType = 'string' | 'number' | 'date' | 'boolean';

type ResolvedFilter =
  | {
      kind: 'condition';
      operator: FilterOperator;
      value?: ConditionValue | null;
      valueTo?: ConditionComparableValue | null;
    }
  | {
      kind: 'collection';
      columnType: ColumnType;
      dataType: FilterBuilderDataType;
      values: Array<ConditionComparableValue>;
      match: 'any' | 'all';
      negate: boolean;
    }
  | {
      kind: 'empty';
      columnType: ColumnType;
      dataType: FilterBuilderDataType;
      negate: boolean;
    };

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

const EMPTY_OPERATOR_IDS = new Set([
  'is_empty',
  'is_not_empty',
  'is_null',
  'not_null',
]);

function isFilterBuilderSource(value: unknown): value is FilterBuilderSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'column' in value &&
    'filterId' in value &&
    'scopeId' in value
  );
}

function getFilterSource(filter: FilterRuntime): FilterBuilderSource {
  const existingSource = FILTER_SOURCE_BY_SELECTION.get(filter.selection);

  if (existingSource) {
    return existingSource;
  }

  const currentSource = filter.selection.clauses
    .map((clause) => clause.source)
    .find((source): source is FilterBuilderSource => {
      if (!isFilterBuilderSource(source)) {
        return false;
      }

      return (
        source.id === `filter-builder:${filter.scopeId}:${filter.definition.id}`
      );
    });

  if (currentSource) {
    FILTER_SOURCE_BY_SELECTION.set(filter.selection, currentSource);
    return currentSource;
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

function getDefinitionColumnType(definition: FilterDefinition): ColumnType {
  if ('columnType' in definition && definition.columnType) {
    return definition.columnType;
  }

  return definition.facet?.columnType ?? 'scalar';
}

function getEffectiveColumnType(definition: FilterDefinition): ColumnType {
  if (definition.valueKind !== 'facet-multi') {
    return 'scalar';
  }

  return getDefinitionColumnType(definition);
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
      return 'is';
    case 'facet-multi':
      return 'is_any_of';
    case 'date':
      return 'equals';
    case 'date-range':
    case 'number-range':
      return 'between';
    case 'number':
      return 'eq';
    default:
      return null;
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

function toComparableValues(value: unknown): Array<ConditionComparableValue> {
  if (!Array.isArray(value)) {
    const comparableValue = toComparableValue(value);
    return comparableValue === null ? [] : [comparableValue];
  }

  return value
    .map((item) => toComparableValue(item))
    .filter((item): item is ConditionComparableValue => item !== null);
}

function toConditionValue(value: unknown): ConditionValue | null {
  const values = toComparableValues(value);

  if (Array.isArray(value)) {
    if (values.length === 0) {
      return null;
    }

    return values;
  }

  return values[0] ?? null;
}

function getComparableBound(
  definition: FilterDefinition,
  value: unknown,
  valueTo: unknown,
  bound: 'from' | 'to' = 'from',
) {
  if (isRangeValueKind(definition.valueKind)) {
    const [rangeFrom, rangeTo] = normalizeRangeTuple(value, valueTo);
    return toComparableValue(bound === 'from' ? rangeFrom : rangeTo);
  }

  return toComparableValue(value);
}

function resolveRangeCondition(
  definition: FilterDefinition,
  value: unknown,
  valueTo: unknown,
): ResolvedFilter | null {
  const fromValue = getComparableBound(definition, value, valueTo, 'from');
  const toValue = getComparableBound(definition, value, valueTo, 'to');

  if (fromValue !== null && toValue !== null) {
    return {
      kind: 'condition',
      operator: 'between',
      value: fromValue,
      valueTo: toValue,
    };
  }

  if (fromValue !== null) {
    return {
      kind: 'condition',
      operator: 'gte',
      value: fromValue,
    };
  }

  if (toValue !== null) {
    return {
      kind: 'condition',
      operator: 'lte',
      value: toValue,
    };
  }

  return null;
}

function resolveOperatorAlias(
  definition: FilterDefinition,
  operator: string | null,
  value: unknown,
  valueTo: unknown,
): ResolvedFilter | null {
  if (!operator) {
    return null;
  }

  const dataType = inferDataType(definition);
  const columnType = getEffectiveColumnType(definition);

  if (EMPTY_OPERATOR_IDS.has(operator)) {
    return {
      kind: 'empty',
      columnType,
      dataType,
      negate: operator === 'is_not_empty' || operator === 'not_null',
    };
  }

  if (DIRECT_OPERATOR_IDS.has(operator as FilterOperator)) {
    if (operator === 'between' && isRangeValueKind(definition.valueKind)) {
      return resolveRangeCondition(definition, value, valueTo);
    }

    return {
      kind: 'condition',
      operator: operator as FilterOperator,
      value: toConditionValue(value),
      valueTo: toComparableValue(valueTo),
    };
  }

  switch (operator) {
    case 'does_not_contain':
      return {
        kind: 'condition',
        operator: 'not_contains',
        value: toConditionValue(value),
      };
    case 'is_exactly':
    case 'equals':
      return {
        kind: 'condition',
        operator: 'eq',
        value: toConditionValue(value),
      };
    case 'not_equals':
      return {
        kind: 'condition',
        operator: 'neq',
        value: toConditionValue(value),
      };
    case 'is':
      if (definition.valueKind === 'facet-multi') {
        return {
          kind: 'collection',
          columnType,
          dataType,
          values: toComparableValues(value),
          match: 'any',
          negate: false,
        };
      }
      return {
        kind: 'condition',
        operator: 'eq',
        value: toConditionValue(value),
      };
    case 'is_not':
      if (definition.valueKind === 'facet-multi') {
        return {
          kind: 'collection',
          columnType,
          dataType,
          values: toComparableValues(value),
          match: 'any',
          negate: true,
        };
      }
      return {
        kind: 'condition',
        operator: 'neq',
        value: toConditionValue(value),
      };
    case 'is_any_of':
    case 'any_of':
      return {
        kind: 'collection',
        columnType,
        dataType,
        values: toComparableValues(value),
        match: 'any',
        negate: false,
      };
    case 'is_not_any_of':
    case 'none_of':
    case 'excludes_all':
      return {
        kind: 'collection',
        columnType,
        dataType,
        values: toComparableValues(value),
        match: 'any',
        negate: true,
      };
    case 'includes_all':
      return {
        kind: 'collection',
        columnType,
        dataType,
        values: toComparableValues(value),
        match: 'all',
        negate: false,
      };
    case 'before':
      return {
        kind: 'condition',
        operator: 'lt',
        value: getComparableBound(definition, value, valueTo),
      };
    case 'after':
      return {
        kind: 'condition',
        operator: 'gt',
        value: getComparableBound(definition, value, valueTo),
      };
    case 'on_or_before':
      return {
        kind: 'condition',
        operator: 'lte',
        value: getComparableBound(definition, value, valueTo),
      };
    case 'on_or_after':
      return {
        kind: 'condition',
        operator: 'gte',
        value: getComparableBound(definition, value, valueTo),
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

function resolveAppliedFilterSelection(
  filter: FilterRuntime,
  state: FilterBindingState,
): {
  operator: string;
  normalizedValue: unknown;
  predicate: SelectionClause['predicate'];
} | null {
  const operator =
    state.operator ?? getDefaultFilterOperator(filter.definition);

  if (!operator) {
    return null;
  }

  const normalizedValue = normalizeStoredValue(filter.definition, state.value);

  if (!EMPTY_OPERATOR_IDS.has(operator)) {
    if (isValueEmpty(normalizedValue) && isValueEmpty(state.valueTo)) {
      return null;
    }
  }

  const resolvedOperator = resolveOperatorAlias(
    filter.definition,
    operator,
    state.value,
    state.valueTo,
  );

  if (!resolvedOperator) {
    return null;
  }

  const predicate = buildResolvedPredicate(
    filter,
    resolvedOperator,
  ) as SelectionClause['predicate'];

  if (!predicate) {
    return null;
  }

  return {
    operator,
    normalizedValue,
    predicate,
  };
}

function resolveCommittedFilterSelectionState(
  filter: FilterRuntime,
  rawValue: unknown,
): FilterBindingState | null {
  if (rawValue === null || rawValue === undefined) {
    return null;
  }

  const state = normalizeFilterBindingState(filter.definition, rawValue);
  return resolveAppliedFilterSelection(filter, state) ? state : null;
}

function readResolvedFilterSelectionState(filter: FilterRuntime): {
  hasCommittedState: boolean;
  state: FilterBindingState;
} {
  const currentValue = filter.selection.valueFor(getFilterSource(filter));
  const currentState = resolveCommittedFilterSelectionState(
    filter,
    currentValue,
  );

  if (currentState) {
    return {
      hasCommittedState: true,
      state: currentState,
    };
  }

  const activeClauses = filter.selection.clauses;
  if (activeClauses.length === 1) {
    const [clause] = activeClauses;
    if (clause && clause.value !== null && clause.value !== undefined) {
      const fallbackState = resolveCommittedFilterSelectionState(
        filter,
        clause.value,
      );

      if (fallbackState) {
        return {
          hasCommittedState: true,
          state: fallbackState,
        };
      }
    }
  }

  return {
    hasCommittedState: false,
    state: createEmptyFilterBindingState(filter.definition),
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

export function readFilterSelectionState(
  filter: FilterRuntime,
): FilterBindingState {
  return readResolvedFilterSelectionState(filter).state;
}

function buildResolvedPredicate(
  filter: FilterRuntime,
  resolvedFilter: ResolvedFilter,
) {
  switch (resolvedFilter.kind) {
    case 'condition':
      return buildConditionPredicate({
        column: filter.definition.column,
        operator: resolvedFilter.operator,
        value: resolvedFilter.value,
        valueTo: resolvedFilter.valueTo,
        dataType: inferDataType(filter.definition),
      });
    case 'empty':
      return buildEmptyValuePredicate({
        column: filter.definition.column,
        dataType: resolvedFilter.dataType,
        columnType: resolvedFilter.columnType,
        negate: resolvedFilter.negate,
      });
    case 'collection':
      return buildCollectionPredicate({
        column: filter.definition.column,
        values: resolvedFilter.values,
        dataType: resolvedFilter.dataType,
        columnType: resolvedFilter.columnType,
        match: resolvedFilter.match,
        negate: resolvedFilter.negate,
      });
  }
}

export function applyFilterSelection(
  filter: FilterRuntime,
  state: FilterBindingState,
): void {
  const resolvedSelection = resolveAppliedFilterSelection(filter, state);

  if (!resolvedSelection) {
    clearFilterSelection(filter);
    return;
  }

  filter.selection.update({
    source: getFilterSource(filter),
    value: createStoredFilterValue(filter, {
      operator: resolvedSelection.operator,
      value: resolvedSelection.normalizedValue,
      valueTo: state.valueTo,
    }),
    predicate: resolvedSelection.predicate,
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
