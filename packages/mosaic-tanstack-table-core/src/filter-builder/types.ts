import type {
  ColumnType,
  ConditionComparableValue,
  ConditionValue,
  FacetSortMode,
  FilterOperator,
  MosaicTableSource,
} from '../types';
import type { Selection } from '@uwdata/mosaic-core';
import type {
  ArrayMultiselectConditionOperatorId,
  DateConditionOperatorId,
  DateRangeConditionOperatorId,
  FilterOperatorId,
  NumberConditionOperatorId,
  NumberRangeConditionOperatorId,
  ScalarMultiselectConditionOperatorId,
  SelectConditionOperatorId,
  TextConditionOperatorId,
} from './conditions';

export type FilterValueKind =
  | 'text'
  | 'facet-single'
  | 'facet-multi'
  | 'date'
  | 'date-range'
  | 'number'
  | 'number-range';

export type FilterBuilderDataType = 'string' | 'number' | 'date' | 'boolean';

/**
 * Discriminator for the app-level values stored on filter-builder Selection
 * clauses. `CONDITION` covers all predicates built from literal values.
 *
 * Future modes (e.g. subquery-backed filters) extend this union; readers must
 * treat unrecognized modes as "stored but unsupported" and never coerce them
 * into condition values.
 */
export type StoredFilterValueMode = 'CONDITION';

/**
 * The app-level value written to a filter-builder Selection clause. This is
 * what `selection.valueFor(source)` returns and what persisters serialize, so
 * it must remain JSON-serializable.
 */
export type StoredFilterValue = {
  mode: StoredFilterValueMode;
  operator: string | null;
  value?: unknown;
  valueTo?: unknown;
  dataType?: FilterBuilderDataType;
  filterId: string;
  scopeId: string;
};

/**
 * Normalized predicate request produced by operator-alias resolution and
 * consumed by predicate building. Each `kind` maps to one predicate builder;
 * the dispatch is exhaustive, so adding a kind (e.g. `subquery`) is a
 * compile-driven change.
 */
export type ResolvedFilter =
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

type FilterDefinitionBase<
  TValueKind extends FilterValueKind,
  TOperator extends FilterOperatorId,
> = {
  id: string;
  label: string;
  column: string;
  valueKind: TValueKind;
  operators: Array<TOperator>;
  defaultOperator?: TOperator;
  dataType?: FilterBuilderDataType;
  groupId?: string;
  description?: string;
  columnType?: ColumnType;
  facet?: {
    table: MosaicTableSource;
    sortMode?: FacetSortMode;
    /** @deprecated Prefer top-level FilterDefinition.columnType. */
    columnType?: ColumnType;
    limit?: number;
  };
};

export type TextFilterDefinition = FilterDefinitionBase<
  'text',
  TextConditionOperatorId
>;

export type SelectFilterDefinition = FilterDefinitionBase<
  'facet-single',
  SelectConditionOperatorId
>;

export type ScalarMultiselectFilterDefinition = FilterDefinitionBase<
  'facet-multi',
  ScalarMultiselectConditionOperatorId
> & {
  columnType?: 'scalar';
};

export type ArrayMultiselectFilterDefinition = FilterDefinitionBase<
  'facet-multi',
  ArrayMultiselectConditionOperatorId
> & {
  columnType: 'array';
};

export type DateFilterDefinition = FilterDefinitionBase<
  'date',
  DateConditionOperatorId
>;

export type DateRangeFilterDefinition = FilterDefinitionBase<
  'date-range',
  DateRangeConditionOperatorId
>;

export type NumberFilterDefinition = FilterDefinitionBase<
  'number',
  NumberConditionOperatorId
>;

export type NumberRangeFilterDefinition = FilterDefinitionBase<
  'number-range',
  NumberRangeConditionOperatorId
>;

export type FilterDefinition =
  | TextFilterDefinition
  | SelectFilterDefinition
  | ScalarMultiselectFilterDefinition
  | ArrayMultiselectFilterDefinition
  | DateFilterDefinition
  | DateRangeFilterDefinition
  | NumberFilterDefinition
  | NumberRangeFilterDefinition;

export interface FilterCollection {
  id: string;
  filters: Array<FilterDefinition>;
}

export interface FilterRuntime {
  definition: FilterDefinition;
  selection: Selection;
  scopeId: string;
}

export interface FilterBindingState {
  operator: string | null;
  value: unknown;
  valueTo: unknown;
}
