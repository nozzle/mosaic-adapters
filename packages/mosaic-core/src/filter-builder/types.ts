import type { Selection } from '@uwdata/mosaic-core';
import type { ExprNode } from '@uwdata/mosaic-sql';
import type { FacetInputs, FacetSortMode, QuerySource } from '../types';
import type { SubqueryFilterQuery } from './subquery-predicate';
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

// ── Condition value primitives ───────────────────────────────────────────────

/** Whether the filtered column holds scalars or DuckDB lists. */
export type ColumnType = 'scalar' | 'array';

export type ConditionComparableValue = string | number | boolean | Date;

export type ConditionValue =
  | ConditionComparableValue
  | Array<ConditionComparableValue>;

/** Canonical (post-alias-resolution) predicate operators. */
export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'not_starts_with'
  | 'ends_with'
  | 'not_ends_with'
  | 'is_null'
  | 'not_null'
  | 'between'
  | 'in'
  | 'not_in';

// ── Definitions ──────────────────────────────────────────────────────────────

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
 * clauses. `CONDITION` covers all predicates built from literal values;
 * `SUBQUERY` marks values whose predicate is rebuilt through the
 * definition's `subquery` factory.
 *
 * Future modes extend this union; readers must treat unrecognized modes as
 * "stored but unsupported" and never coerce them into condition values.
 */
export type StoredFilterValueMode = 'CONDITION' | 'SUBQUERY';

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
    }
  | {
      kind: 'subquery';
      /** The committed binding state handed to the definition's `subquery` factory. */
      state: FilterBindingState;
    };

/** Arguments passed to a filter definition's `subquery` factory. */
export interface FilterSubqueryFactoryArgs {
  /** The committed binding state (operator, value, valueTo). */
  state: FilterBindingState;
  /**
   * The AND of sibling filter predicates from the runtime's `context`
   * Selection, with this filter's own clause excluded. `null` when no
   * context is attached or no sibling filters are active.
   *
   * Mosaic does not push other Selection clauses into scalar subqueries;
   * embed this predicate in the subquery if it should respect sibling
   * filters. The clause is rebuilt automatically when the context changes.
   */
  contextPredicate: ExprNode | null;
}

/**
 * Builds the membership subquery for a subquery-backed filter definition.
 * The resulting predicate is `definition.column [NOT] IN (<query>)`.
 *
 * Must be pure and cheap: it runs on every apply, on hydration, and during
 * committed-state reads.
 */
export type FilterSubqueryFactory = (
  args: FilterSubqueryFactoryArgs,
) => SubqueryFilterQuery;

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
  /**
   * When present, this filter's predicate is built as
   * `column [NOT] IN (<subquery>)` instead of a literal-value condition: the
   * factory receives the committed binding state (and sibling context, when
   * a runtime `context` Selection is attached) and returns the membership
   * query. Operator/value semantics are interpreted by the factory.
   *
   * The binding state stays JSON-serializable, so persistence works
   * unchanged: hydration rebuilds the predicate through this factory.
   */
  subquery?: FilterSubqueryFactory;
  /** Facet-option sourcing for `facet-single` / `facet-multi` filters. */
  facet?: {
    /** Base relation the options are read from (a facet-client query source). */
    from: QuerySource<FacetInputs>;
    sortMode?: FacetSortMode;
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
  /**
   * Optional Selection providing sibling-filter context to this filter's
   * `subquery` factory (e.g. the scope's composed context). Clauses sourced
   * by this filter itself are excluded automatically, so passing a context
   * that mirrors the filter's own selection is safe.
   *
   * When attached, subquery predicates are rebuilt whenever the context
   * changes. Avoid making two subquery filters mutually context-dependent:
   * each rebuild embeds the other's previous predicate and never converges.
   */
  context?: Selection;
}

export interface FilterBindingState {
  operator: string | null;
  value: unknown;
  valueTo: unknown;
}
