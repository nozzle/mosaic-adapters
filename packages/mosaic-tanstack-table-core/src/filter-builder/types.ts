import type { ColumnType, FacetSortMode, MosaicTableSource } from '../types';
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
  dataType?: 'string' | 'number' | 'date' | 'boolean';
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
