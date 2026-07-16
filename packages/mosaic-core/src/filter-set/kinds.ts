/**
 * Built-in {@link FilterKind}s and kind factories.
 *
 * `point`/`points`/`interval`/`match` delegate to upstream Mosaic clause
 * factories (`clausePoint`/`clausePoints`/`clauseInterval`/`clauseMatch`) with
 * a throwaway source and copy the resulting `{ predicate, meta }` — this keeps
 * the emitted SQL and optimizer `meta` byte-identical to native Mosaic clauses.
 *
 * `condition` builds condition/collection/empty predicates with operator-alias
 * resolution, keyed on `(operator, value, valueTo)`. Condition emissions carry
 * NO `meta` (they are not point/interval-shaped).
 *
 * `subqueryFilterKind` builds `column [NOT] IN (SELECT ...)` predicates via the
 * shared subquery builders; its emissions likewise carry NO `meta`.
 */
import { clauseMatch, clausePoint, clausePoints } from '@uwdata/mosaic-core';
import * as mSql from '@uwdata/mosaic-sql';
import {
  SqlIdentifier,
  createStructAccess,
  createTypedAccess,
  escapeSqlLikePattern,
} from '../sql-access';
import {
  buildSubqueryClauseParts,
  normalizeSubqueryFilterQuery,
} from '../subquery-predicate';
import { formatRange } from './format';
import type { ClauseMetadata, ClauseSource } from '@uwdata/mosaic-core';
import type { ExprNode } from '@uwdata/mosaic-sql';
import type { SubqueryFilterQuery } from '../subquery-predicate';
import type {
  FilterKind,
  FilterKindArgs,
  FilterSpec,
  OperatorDescriptor,
} from './types';

/** A throwaway source for the upstream clause factories we only read from. */
const SCRATCH_SOURCE: ClauseSource = {};

/**
 * Runs an upstream clause factory and extracts its predicate + meta. Returns
 * `null` when the factory produced no predicate (empty/undefined input), which
 * the caller maps to an inactive spec.
 */
function extractClause(clause: {
  predicate: ExprNode | null;
  fields: Array<ExprNode>;
  meta?: ClauseMetadata;
}): {
  predicate: ExprNode;
  fields: Array<ExprNode>;
  meta?: ClauseMetadata;
} | null {
  if (clause.predicate == null) {
    return null;
  }
  // Carry `fields` through verbatim: the upstream factory populated it with
  // the exact node instances referenced in `predicate`, which the
  // PreAggregator matches by identity.
  return {
    predicate: clause.predicate,
    fields: clause.fields,
    meta: clause.meta,
  };
}

/**
 * `point` — single-value equality. `undefined` value → inactive; `null` value
 * publishes a SQL NULL match (mirrors the bridge's `equals`).
 */
export const pointFilterKind: FilterKind = {
  emit: (args) => {
    if (args.spec.value === undefined) {
      return [];
    }
    const extracted = extractClause(
      clausePoint(args.column, args.spec.value, { source: SCRATCH_SOURCE }),
    );
    if (extracted === null) {
      return [];
    }
    return [
      {
        clause: {
          value: args.spec.value,
          predicate: extracted.predicate,
          fields: extracted.fields,
          meta: extracted.meta,
        },
      },
    ];
  },
};

/** A multi-column points envelope: parallel `columns` and `tuples`. */
interface PointsTupleEnvelope {
  columns: Array<string>;
  tuples: Array<Array<unknown>>;
}

function isPointsTupleEnvelope(value: unknown): value is PointsTupleEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as PointsTupleEnvelope).columns) &&
    Array.isArray((value as PointsTupleEnvelope).tuples)
  );
}

/**
 * `points` — multi-value membership. `spec.value` is either a plain array of
 * scalars (single column) or a `{ columns, tuples }` envelope (multi-column,
 * used by rows publish.into). Empty array / empty tuples → inactive.
 */
export const pointsFilterKind: FilterKind = {
  explodeValues: true,
  emit: (args) => {
    const { spec } = args;

    if (isPointsTupleEnvelope(spec.value)) {
      const { columns, tuples } = spec.value;
      if (tuples.length === 0 || columns.length === 0) {
        return [];
      }
      const fields = columns.map((c) =>
        createStructAccess(SqlIdentifier.from(c)),
      );
      const extracted = extractClause(
        clausePoints(fields, tuples, { source: SCRATCH_SOURCE }),
      );
      if (extracted === null) {
        return [];
      }
      return [
        {
          clause: {
            value: spec.value,
            predicate: extracted.predicate,
            fields: extracted.fields,
            meta: extracted.meta,
          },
        },
      ];
    }

    if (!Array.isArray(spec.value) || spec.value.length === 0) {
      return [];
    }
    const extracted = extractClause(
      clausePoints(
        [args.column],
        spec.value.map((v) => [v]),
        { source: SCRATCH_SOURCE },
      ),
    );
    if (extracted === null) {
      return [];
    }
    return [
      {
        clause: {
          value: spec.value,
          predicate: extracted.predicate,
          fields: extracted.fields,
          meta: extracted.meta,
        },
      },
    ];
  },
};

/** Reads the two bounds of an interval spec (tuple, or value/valueTo). */
function readIntervalBounds(spec: FilterSpec): [unknown, unknown] {
  if (Array.isArray(spec.value)) {
    return [spec.value[0] ?? null, spec.value[1] ?? null];
  }
  return [spec.value ?? null, spec.valueTo ?? null];
}

/**
 * `interval` — a range. Both bounds → `BETWEEN` (interval meta). A half-open
 * range (one bound missing) is not BETWEEN-shaped, so it emits a `>=`/`<=`
 * predicate with NO meta. No bounds → inactive.
 */
export const intervalFilterKind: FilterKind = {
  emit: (args) => {
    const [lo, hi] = readIntervalBounds(args.spec);
    const hasLo = lo !== null && lo !== undefined;
    const hasHi = hi !== null && hi !== undefined;

    if (hasLo && hasHi) {
      // Build the BETWEEN predicate with literal bounds directly: delegating to
      // upstream `clauseInterval` treats non-numeric bounds (date strings) as
      // column identifiers. The clause still carries interval `meta` so the
      // PreAggregator recognizes its BETWEEN shape.
      return [
        {
          clause: {
            value: [lo, hi],
            predicate: mSql.isBetween(args.column, [
              mSql.literal(lo),
              mSql.literal(hi),
            ]),
            // `args.column` is the exact node the BETWEEN predicate references,
            // so the PreAggregator can match this interval clause by identity.
            fields: [args.column],
            meta: { type: 'interval' },
          },
        },
      ];
    }

    if (hasLo) {
      return [
        {
          clause: {
            value: [lo, hi],
            predicate: mSql.gte(args.column, mSql.literal(lo)),
          },
        },
      ];
    }

    if (hasHi) {
      return [
        {
          clause: {
            value: [lo, hi],
            predicate: mSql.lte(args.column, mSql.literal(hi)),
          },
        },
      ];
    }

    return [];
  },
  formatValue: (spec) => {
    const [lo, hi] = readIntervalBounds(spec);
    return formatRange(lo, hi);
  },
};

type MatchMethod = 'contains' | 'prefix' | 'suffix' | 'regexp';

const MATCH_METHODS = new Set<MatchMethod>([
  'contains',
  'prefix',
  'suffix',
  'regexp',
]);

function resolveMatchMethod(operator: string | undefined): MatchMethod {
  if (operator !== undefined && MATCH_METHODS.has(operator as MatchMethod)) {
    return operator as MatchMethod;
  }
  return 'contains';
}

/**
 * Descriptive operator vocabulary for {@link matchFilterKind}. The `id`s mirror
 * the {@link MatchMethod} set the kind actually resolves; all are `unary`
 * (single string value). Source of truth for {@link MatchOperator}.
 */
const MATCH_OPERATORS = [
  { id: 'contains', label: 'contains', arity: 'unary' },
  { id: 'prefix', label: 'starts with', arity: 'unary' },
  { id: 'suffix', label: 'ends with', arity: 'unary' },
  { id: 'regexp', label: 'matches regexp', arity: 'unary' },
] as const satisfies ReadonlyArray<OperatorDescriptor>;

/** Compile-time-safe operator id accepted by {@link matchFilterKind}. */
export type MatchOperator = (typeof MATCH_OPERATORS)[number]['id'];

/**
 * `match` — text search. `spec.operator` selects the method
 * (`contains` default | `prefix` | `suffix` | `regexp`). Empty/blank string
 * value → inactive.
 */
export const matchFilterKind: FilterKind = {
  operators: MATCH_OPERATORS,
  emit: (args) => {
    const { value } = args.spec;
    if (typeof value !== 'string' || value.length === 0) {
      return [];
    }
    const method = resolveMatchMethod(args.spec.operator);
    const extracted = extractClause(
      clauseMatch(args.column, value, { source: SCRATCH_SOURCE, method }),
    );
    if (extracted === null) {
      return [];
    }
    return [
      {
        clause: {
          value,
          predicate: extracted.predicate,
          meta: extracted.meta,
        },
      },
    ];
  },
};

/**
 * Options for {@link conditionFilterKind}.
 */
export interface ConditionKindOptions {
  /** `'array'` treats the column as a list (list_has_* / array emptiness). */
  columnType?: 'scalar' | 'array';
  /** Overrides the type coercion; defaults are inferred from the JS value. */
  dataType?: 'string' | 'number' | 'boolean' | 'date';
}

type CanonicalOperator =
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
  | 'not_in'
  | 'list_has_any'
  | 'list_has_all';

/** Alias → canonical operator. `excludes_all` maps to a negated list_has_any. */
const OPERATOR_ALIASES: Record<string, CanonicalOperator> = {
  equals: 'eq',
  is_exactly: 'eq',
  is: 'eq',
  not_equals: 'neq',
  is_not: 'neq',
  does_not_contain: 'not_contains',
  before: 'lt',
  after: 'gt',
  on_or_before: 'lte',
  on_or_after: 'gte',
  is_any_of: 'in',
  any_of: 'in',
  is_not_any_of: 'not_in',
  none_of: 'not_in',
  includes_all: 'list_has_all',
};

const CANONICAL_OPERATORS = new Set<CanonicalOperator>([
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
  'list_has_any',
  'list_has_all',
]);

/**
 * Descriptive operator vocabulary for {@link conditionFilterKind} — the
 * canonical operators plus the empty-value/collection operators the kind
 * special-cases (`is_empty`/`is_not_empty`/`excludes_all`). Ids the kind also
 * accepts as {@link OPERATOR_ALIASES} (e.g. `equals`, `is_any_of`) are not
 * listed here; they resolve to a canonical id already present. Source of truth
 * for {@link ConditionOperator}.
 */
const CONDITION_OPERATORS = [
  { id: 'eq', label: 'equals', arity: 'unary' },
  { id: 'neq', label: 'does not equal', arity: 'unary' },
  { id: 'gt', label: 'greater than', arity: 'unary' },
  { id: 'gte', label: 'greater than or equal', arity: 'unary' },
  { id: 'lt', label: 'less than', arity: 'unary' },
  { id: 'lte', label: 'less than or equal', arity: 'unary' },
  { id: 'contains', label: 'contains', arity: 'unary' },
  { id: 'not_contains', label: 'does not contain', arity: 'unary' },
  { id: 'starts_with', label: 'starts with', arity: 'unary' },
  { id: 'not_starts_with', label: 'does not start with', arity: 'unary' },
  { id: 'ends_with', label: 'ends with', arity: 'unary' },
  { id: 'not_ends_with', label: 'does not end with', arity: 'unary' },
  { id: 'is_null', label: 'is null', arity: 'none' },
  { id: 'not_null', label: 'is not null', arity: 'none' },
  { id: 'is_empty', label: 'is empty', arity: 'none' },
  { id: 'is_not_empty', label: 'is not empty', arity: 'none' },
  { id: 'between', label: 'between', arity: 'range' },
  { id: 'in', label: 'is any of', arity: 'set' },
  { id: 'not_in', label: 'is not any of', arity: 'set' },
  { id: 'list_has_any', label: 'has any of', arity: 'set' },
  { id: 'list_has_all', label: 'has all of', arity: 'set' },
  { id: 'excludes_all', label: 'excludes all of', arity: 'set' },
] as const satisfies ReadonlyArray<OperatorDescriptor>;

/** Compile-time-safe operator id accepted by {@link conditionFilterKind}. */
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number]['id'];

function inferDataType(value: unknown): 'string' | 'number' | 'boolean' {
  if (typeof value === 'number') {
    return 'number';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  return 'string';
}

function typedColumn(
  column: ExprNode,
  dataType: 'string' | 'number' | 'boolean' | 'date',
): ExprNode {
  if (dataType === 'number') {
    return createTypedAccess(column, 'number');
  }
  if (dataType === 'date') {
    return createTypedAccess(column, 'date');
  }
  return column;
}

function isFilled(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '';
}

function likePattern(
  value: unknown,
  position: 'contains' | 'starts_with' | 'ends_with',
): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  const escaped = escapeSqlLikePattern(value);
  if (position === 'contains') {
    return `%${escaped}%`;
  }
  if (position === 'starts_with') {
    return `${escaped}%`;
  }
  return `%${escaped}`;
}

function inList(values: Array<unknown>): ReturnType<typeof mSql.sql> {
  const literals = values.map((item) => mSql.literal(item));
  return mSql.sql`(${literals.join(', ')})`;
}

function listLiteral(values: Array<unknown>): ReturnType<typeof mSql.sql> {
  const [first, ...rest] = values;
  const content = rest.reduce<ReturnType<typeof mSql.sql>>(
    (acc, item) => mSql.sql`${acc}, ${mSql.literal(item)}`,
    mSql.sql`${mSql.literal(first)}`,
  );
  return mSql.sql`[${content}]`;
}

/**
 * Builds the empty-value predicate for `is_empty`/`is_not_empty`, honoring
 * array columns (NULL-or-empty-array) and string columns (NULL-or-`''`).
 */
function buildEmptyPredicate(
  column: ExprNode,
  options: Required<ConditionKindOptions>,
  negate: boolean,
): ExprNode {
  if (options.columnType === 'array') {
    return negate
      ? mSql.sql`${column} IS NOT NULL AND array_length(${column}) > 0`
      : mSql.sql`${column} IS NULL OR array_length(${column}) = 0`;
  }
  if (options.dataType === 'string') {
    return negate
      ? mSql.sql`${column} IS NOT NULL AND ${column} != ''`
      : mSql.sql`${column} IS NULL OR ${column} = ''`;
  }
  return negate ? mSql.sql`${column} IS NOT NULL` : mSql.sql`${column} IS NULL`;
}

/**
 * Builds a scalar/array collection predicate for `in`/`not_in`/`list_has_*`.
 * Empty value list → `null` (inactive).
 */
function buildCollectionPredicate(
  rawColumn: ExprNode,
  values: Array<unknown>,
  match: 'any' | 'all',
  negate: boolean,
  options: Required<ConditionKindOptions>,
): ExprNode | null {
  if (values.length === 0) {
    return null;
  }
  if (options.columnType === 'array') {
    const literal = listLiteral(values);
    const clause =
      match === 'all'
        ? mSql.sql`list_has_all(${rawColumn}, ${literal})`
        : mSql.sql`list_has_any(${rawColumn}, ${literal})`;
    return negate ? mSql.sql`NOT (${clause})` : clause;
  }
  if (match !== 'any') {
    return null;
  }
  const typedCol = typedColumn(rawColumn, options.dataType);
  if (negate) {
    return mSql.sql`${typedCol} NOT IN ${inList(values)}`;
  }
  return mSql.isInDistinct(
    typedCol,
    values.map((item) => mSql.literal(item)),
  );
}

/**
 * Resolves the two `between` bounds (value+valueTo, or a `[from, to]` array
 * value) into a predicate: both → BETWEEN; only from → `>=`; only to → `<=`.
 */
function buildBetweenPredicate(
  column: ExprNode,
  spec: FilterSpec,
): ExprNode | null {
  let from: unknown = spec.value;
  let to: unknown = spec.valueTo;
  if (Array.isArray(spec.value)) {
    from = spec.value[0];
    to = spec.value[1];
  }
  const hasFrom = isFilled(from);
  const hasTo = isFilled(to);
  if (hasFrom && hasTo) {
    return mSql.isBetween(column, [mSql.literal(from), mSql.literal(to)]);
  }
  if (hasFrom) {
    return mSql.gte(column, mSql.literal(from));
  }
  if (hasTo) {
    return mSql.lte(column, mSql.literal(to));
  }
  return null;
}

/**
 * Builds the predicate for a canonical condition operator, or `null` when the
 * value is missing/empty for a value-requiring operator (inactive).
 */
function buildConditionPredicate(
  operator: CanonicalOperator,
  rawColumn: ExprNode,
  spec: FilterSpec,
  options: Required<ConditionKindOptions>,
): ExprNode | null {
  const col = typedColumn(rawColumn, options.dataType);
  const { value } = spec;
  const filled = isFilled(value);

  switch (operator) {
    case 'is_null':
      return mSql.sql`${rawColumn} IS NULL`;
    case 'not_null':
      return mSql.sql`${rawColumn} IS NOT NULL`;
    case 'eq':
      return filled ? mSql.eq(col, mSql.literal(value)) : null;
    case 'neq':
      return filled ? mSql.sql`${col} != ${mSql.literal(value)}` : null;
    case 'gt':
      return filled ? mSql.gt(col, mSql.literal(value)) : null;
    case 'gte':
      return filled ? mSql.gte(col, mSql.literal(value)) : null;
    case 'lt':
      return filled ? mSql.lt(col, mSql.literal(value)) : null;
    case 'lte':
      return filled ? mSql.lte(col, mSql.literal(value)) : null;
    case 'contains': {
      const pattern = likePattern(value, 'contains');
      return pattern === null
        ? null
        : mSql.sql`${rawColumn} ILIKE ${mSql.literal(pattern)} ESCAPE '\\'`;
    }
    case 'not_contains': {
      const pattern = likePattern(value, 'contains');
      return pattern === null
        ? null
        : mSql.sql`${rawColumn} NOT ILIKE ${mSql.literal(pattern)} ESCAPE '\\'`;
    }
    case 'starts_with': {
      const pattern = likePattern(value, 'starts_with');
      return pattern === null
        ? null
        : mSql.sql`${rawColumn} ILIKE ${mSql.literal(pattern)} ESCAPE '\\'`;
    }
    case 'not_starts_with': {
      const pattern = likePattern(value, 'starts_with');
      return pattern === null
        ? null
        : mSql.sql`${rawColumn} NOT ILIKE ${mSql.literal(pattern)} ESCAPE '\\'`;
    }
    case 'ends_with': {
      const pattern = likePattern(value, 'ends_with');
      return pattern === null
        ? null
        : mSql.sql`${rawColumn} ILIKE ${mSql.literal(pattern)} ESCAPE '\\'`;
    }
    case 'not_ends_with': {
      const pattern = likePattern(value, 'ends_with');
      return pattern === null
        ? null
        : mSql.sql`${rawColumn} NOT ILIKE ${mSql.literal(pattern)} ESCAPE '\\'`;
    }
    case 'between':
      return buildBetweenPredicate(col, spec);
    case 'in':
      return Array.isArray(value)
        ? buildCollectionPredicate(rawColumn, value, 'any', false, options)
        : null;
    case 'not_in':
      return Array.isArray(value)
        ? buildCollectionPredicate(rawColumn, value, 'any', true, options)
        : null;
    case 'list_has_any':
      return Array.isArray(value)
        ? buildCollectionPredicate(rawColumn, value, 'any', false, {
            ...options,
            columnType: 'array',
          })
        : null;
    case 'list_has_all':
      return Array.isArray(value)
        ? buildCollectionPredicate(rawColumn, value, 'all', false, {
            ...options,
            columnType: 'array',
          })
        : null;
    default: {
      const exhaustive: never = operator;
      return exhaustive;
    }
  }
}

/**
 * `condition` kind factory. The bare `'condition'` registration is
 * `conditionFilterKind()`. Builds condition/collection/empty predicates with
 * operator-alias resolution, keyed on `(operator, value, valueTo)`. Emissions
 * carry NO `meta`.
 */
export function conditionFilterKind(
  options?: ConditionKindOptions,
): FilterKind {
  const columnType = options?.columnType ?? 'scalar';

  return {
    operators: CONDITION_OPERATORS,
    emit: (args) => {
      const { spec } = args;
      const operator = spec.operator ?? 'eq';
      const dataType =
        options?.dataType ??
        (columnType === 'array' ? 'string' : inferDataType(spec.value));
      const resolved: Required<ConditionKindOptions> = { columnType, dataType };

      let predicate: ExprNode | null = null;

      if (operator === 'is_empty' || operator === 'is_not_empty') {
        predicate = buildEmptyPredicate(
          args.column,
          resolved,
          operator === 'is_not_empty',
        );
      } else if (operator === 'excludes_all') {
        const values = Array.isArray(spec.value) ? spec.value : [];
        predicate = buildCollectionPredicate(args.column, values, 'any', true, {
          ...resolved,
          columnType: 'array',
        });
      } else {
        const canonical = (
          CANONICAL_OPERATORS.has(operator as CanonicalOperator)
            ? operator
            : OPERATOR_ALIASES[operator]
        ) as CanonicalOperator | undefined;
        if (canonical !== undefined) {
          predicate = buildConditionPredicate(
            canonical,
            args.column,
            spec,
            resolved,
          );
        }
      }

      if (predicate === null) {
        return [];
      }
      return [{ clause: { value: spec.value, predicate } }];
    },
  };
}

/**
 * Builds a `column [NOT] IN (SELECT ...)` membership kind from a query
 * factory. NOT registered by default (a membership query is consumer logic).
 * Emissions never carry `meta`; the set publishes them via `createSubqueryClause`.
 */
export function subqueryFilterKind(
  build: (args: FilterKindArgs) => SubqueryFilterQuery,
): FilterKind {
  return {
    emit: (args) => {
      const normalized = normalizeSubqueryFilterQuery(build(args));
      if (normalized === null) {
        return [];
      }
      const { predicate, field } = buildSubqueryClauseParts({
        column: args.spec.column,
        query: normalized.query,
        negate: normalized.negate,
      });
      return [
        { clause: { value: args.spec.value, predicate, fields: [field] } },
      ];
    },
  };
}

/**
 * The default kind registry. A {@link FilterSet} merges `options.kinds` over
 * this map.
 */
export const builtinFilterKinds: Record<string, FilterKind> = {
  point: pointFilterKind,
  points: pointsFilterKind,
  interval: intervalFilterKind,
  match: matchFilterKind,
  condition: conditionFilterKind(),
};
