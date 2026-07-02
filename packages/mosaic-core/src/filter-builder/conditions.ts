type ConditionRegistry = Record<string, string>;

type ConditionValue<TRegistry extends ConditionRegistry> =
  TRegistry[keyof TRegistry];

export const TEXT_CONDITIONS = {
  CONTAINS: 'contains',
  DOES_NOT_CONTAIN: 'does_not_contain',
  STARTS_WITH: 'starts_with',
  ENDS_WITH: 'ends_with',
  IS_EXACTLY: 'is_exactly',
  EQUALS: 'equals',
  NOT_EQUALS: 'not_equals',
  IS_EMPTY: 'is_empty',
  IS_NOT_EMPTY: 'is_not_empty',
} as const;

export const SELECT_CONDITIONS = {
  IS: 'is',
  IS_NOT: 'is_not',
  IS_EMPTY: 'is_empty',
  IS_NOT_EMPTY: 'is_not_empty',
} as const;

export const MULTISELECT_SCALAR_CONDITIONS = {
  IS_ANY_OF: 'is_any_of',
  IS_NOT_ANY_OF: 'is_not_any_of',
  ANY_OF: 'any_of',
  NONE_OF: 'none_of',
  IS_EMPTY: 'is_empty',
  IS_NOT_EMPTY: 'is_not_empty',
} as const;

export const MULTISELECT_ARRAY_CONDITIONS = {
  IS_ANY_OF: 'is_any_of',
  IS_NOT_ANY_OF: 'is_not_any_of',
  ANY_OF: 'any_of',
  NONE_OF: 'none_of',
  INCLUDES_ALL: 'includes_all',
  EXCLUDES_ALL: 'excludes_all',
  IS_EMPTY: 'is_empty',
  IS_NOT_EMPTY: 'is_not_empty',
} as const;

export const DATE_CONDITIONS = {
  BEFORE: 'before',
  AFTER: 'after',
  ON_OR_BEFORE: 'on_or_before',
  ON_OR_AFTER: 'on_or_after',
  EQUALS: 'equals',
  NOT_EQUALS: 'not_equals',
  IS_EMPTY: 'is_empty',
  IS_NOT_EMPTY: 'is_not_empty',
} as const;

export const DATE_RANGE_CONDITIONS = {
  BETWEEN: 'between',
  BEFORE: 'before',
  AFTER: 'after',
  ON_OR_BEFORE: 'on_or_before',
  ON_OR_AFTER: 'on_or_after',
  IS_EMPTY: 'is_empty',
  IS_NOT_EMPTY: 'is_not_empty',
} as const;

export const NUMBER_CONDITIONS = {
  EQ: 'eq',
  NEQ: 'neq',
  GT: 'gt',
  GTE: 'gte',
  LT: 'lt',
  LTE: 'lte',
  EQUALS: 'equals',
  NOT_EQUALS: 'not_equals',
  BEFORE: 'before',
  AFTER: 'after',
  ON_OR_BEFORE: 'on_or_before',
  ON_OR_AFTER: 'on_or_after',
  IS_EMPTY: 'is_empty',
  IS_NOT_EMPTY: 'is_not_empty',
} as const;

export const NUMBER_RANGE_CONDITIONS = {
  BETWEEN: 'between',
  BEFORE: 'before',
  AFTER: 'after',
  ON_OR_BEFORE: 'on_or_before',
  ON_OR_AFTER: 'on_or_after',
  IS_EMPTY: 'is_empty',
  IS_NOT_EMPTY: 'is_not_empty',
} as const;

export type TextConditionOperatorId = ConditionValue<typeof TEXT_CONDITIONS>;
export type SelectConditionOperatorId = ConditionValue<
  typeof SELECT_CONDITIONS
>;
export type ScalarMultiselectConditionOperatorId = ConditionValue<
  typeof MULTISELECT_SCALAR_CONDITIONS
>;
export type ArrayMultiselectConditionOperatorId = ConditionValue<
  typeof MULTISELECT_ARRAY_CONDITIONS
>;
export type DateConditionOperatorId = ConditionValue<typeof DATE_CONDITIONS>;
export type DateRangeConditionOperatorId = ConditionValue<
  typeof DATE_RANGE_CONDITIONS
>;
export type NumberConditionOperatorId = ConditionValue<
  typeof NUMBER_CONDITIONS
>;
export type NumberRangeConditionOperatorId = ConditionValue<
  typeof NUMBER_RANGE_CONDITIONS
>;

export type FilterOperatorId =
  | TextConditionOperatorId
  | SelectConditionOperatorId
  | ScalarMultiselectConditionOperatorId
  | ArrayMultiselectConditionOperatorId
  | DateConditionOperatorId
  | DateRangeConditionOperatorId
  | NumberConditionOperatorId
  | NumberRangeConditionOperatorId;
