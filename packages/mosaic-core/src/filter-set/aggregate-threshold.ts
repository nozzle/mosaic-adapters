/**
 * `aggregateThresholdFilterKind` — "groups whose aggregate passes a threshold".
 *
 * One spec compares a per-group aggregate (`max(volume)`, `count(*)`, …)
 * against `spec.value` and emits two clauses:
 *
 * 1. `targets.having` — `<aggregate> <op> <value>`, for the widget that runs
 *    the grouped query itself (consumed through `havingBy`);
 * 2. `targets.members` — `<column> IN (SELECT <column> FROM <from>
 *    WHERE <context> GROUP BY <column> HAVING <aggregate> <op> <value>)`, so
 *    every other widget narrows to the groups that pass.
 *
 * The group key is the spec's own `column`.
 */
import * as mSql from '@uwdata/mosaic-sql';
import type { ExprNode, TableRefNode } from '@uwdata/mosaic-sql';

import { SqlIdentifier, identifierAccess } from '../sql-access';
import { buildSubqueryClauseParts } from '../subquery-predicate';
import { formatFilterValue } from './format';
import type { FilterKind, FilterSpec, OperatorDescriptor } from './types';

/**
 * Operator vocabulary of {@link aggregateThresholdFilterKind} (all `unary`:
 * the threshold is `spec.value`). Source of truth for {@link ThresholdOperator}.
 */
export const THRESHOLD_OPERATORS = [
  { id: 'gt', label: 'greater than', arity: 'unary' },
  { id: 'gte', label: 'at least', arity: 'unary' },
  { id: 'lt', label: 'less than', arity: 'unary' },
  { id: 'lte', label: 'at most', arity: 'unary' },
] as const satisfies ReadonlyArray<OperatorDescriptor>;

/** Compile-time-safe operator id accepted by {@link aggregateThresholdFilterKind}. */
export type ThresholdOperator = (typeof THRESHOLD_OPERATORS)[number]['id'];

/** The operator a spec without `operator` resolves to. */
const DEFAULT_THRESHOLD_OPERATOR: ThresholdOperator = 'gte';

const THRESHOLD_COMPARATORS: Record<
  ThresholdOperator,
  (left: ExprNode, right: ExprNode) => ExprNode
> = {
  gt: mSql.gt,
  gte: mSql.gte,
  lt: mSql.lt,
  lte: mSql.lte,
};

const THRESHOLD_GLYPHS: Record<ThresholdOperator, string> = {
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
};

const THRESHOLD_DESCRIPTORS = new Map<string, (typeof THRESHOLD_OPERATORS)[number]>(
  THRESHOLD_OPERATORS.map((descriptor) => [descriptor.id, descriptor]),
);

function isThresholdOperator(value: unknown): value is ThresholdOperator {
  return typeof value === 'string' && THRESHOLD_DESCRIPTORS.has(value);
}

/**
 * Options for {@link aggregateThresholdFilterKind}.
 */
export interface AggregateThresholdKindOptions {
  /**
   * Table the membership subquery groups. A string is one table name (quoted
   * as a single identifier); pass a `TableRefNode` (e.g.
   * `new TableRefNode(['main', 'events'])`) for a schema-qualified table.
   */
  from: string | TableRefNode;
  /**
   * The per-group aggregate compared against the threshold, e.g.
   * `max('search_volume')` or `count()`. Each emission gets its own node: a
   * function is called once per emission, and a node is deep-cloned.
   */
  aggregate: ExprNode | (() => ExprNode);
  /** Target names for the two emissions; they must differ. */
  targets: {
    /** Receives the bare aggregate comparison (consume with `havingBy`). */
    having: string;
    /** Receives the `column IN (SELECT … HAVING …)` membership predicate. */
    members: string;
  };
  /**
   * Operators the kind accepts and advertises, in menu order. Defaults to
   * every {@link THRESHOLD_OPERATORS} entry. A spec with any other operator
   * is inactive.
   */
  operators?: ReadonlyArray<ThresholdOperator>;
}

/** Reads a spec's operator: `undefined` → `'gte'`; unsupported → `null`. */
function resolveOperator(
  operator: string | undefined,
  allowed: ReadonlySet<ThresholdOperator>,
): ThresholdOperator | null {
  const resolved = operator ?? DEFAULT_THRESHOLD_OPERATOR;
  if (!isThresholdOperator(resolved) || !allowed.has(resolved)) {
    return null;
  }
  return resolved;
}

function validateOptions(options: AggregateThresholdKindOptions): void {
  const { having, members } = options.targets;
  if (having.trim().length === 0 || members.trim().length === 0) {
    throw new Error('[mosaic-core] aggregateThresholdFilterKind targets must be non-empty names.');
  }
  if (having === members) {
    throw new Error(
      `[mosaic-core] aggregateThresholdFilterKind targets.having and targets.members must differ (both are '${having}').`,
    );
  }
  const operators = options.operators;
  if (operators === undefined) {
    return;
  }
  if (operators.length === 0) {
    throw new Error('[mosaic-core] aggregateThresholdFilterKind operators must not be empty.');
  }
  const unknown = operators.filter((operator) => !isThresholdOperator(operator));
  if (unknown.length > 0) {
    throw new Error(
      `[mosaic-core] aggregateThresholdFilterKind received unknown operators: ${unknown.join(', ')}.`,
    );
  }
}

/**
 * Builds a two-target "aggregate threshold" {@link FilterKind}: a spec
 * `{ column, operator, value }` keeps the `column` groups whose aggregate
 * passes `operator value`.
 *
 * - The `having` emission is `<aggregate> <op> <value>` with `fields: []` (an
 *   aggregate has no input column to match for pre-aggregation).
 * - The `members` emission is `<column> IN (SELECT <column> FROM <from>
 *   [WHERE <contextPredicate>] GROUP BY <column> HAVING <aggregate> <op>
 *   <value>)`, with `fields` set to the outer column node. Embedding
 *   `contextPredicate` marks the spec context-dependent, so the set rebuilds
 *   the subquery when the context Selection changes.
 *
 * `spec.operator` is one of `operators` (default `'gte'` when omitted);
 * `spec.value` must be a finite number. Anything else makes the spec
 * inactive. Throws on invalid options (empty or equal target names, an empty
 * or unknown `operators` entry).
 */
export function aggregateThresholdFilterKind(options: AggregateThresholdKindOptions): FilterKind {
  validateOptions(options);

  const { from, aggregate, targets } = options;
  const allowedIds = [
    ...new Set(options.operators ?? THRESHOLD_OPERATORS.map((descriptor) => descriptor.id)),
  ];
  const allowed: ReadonlySet<ThresholdOperator> = new Set(allowedIds);
  const operators: ReadonlyArray<OperatorDescriptor> = allowedIds.flatMap((id) => {
    const descriptor = THRESHOLD_DESCRIPTORS.get(id);
    return descriptor === undefined ? [] : [descriptor];
  });

  // A fresh node per emission: the HAVING clause and the membership subquery
  // must not share AST instances.
  const freshAggregate = (): ExprNode =>
    typeof aggregate === 'function' ? aggregate() : mSql.deepClone(aggregate);

  return {
    operators,
    emit: (args) => {
      const { spec } = args;
      const operator = resolveOperator(spec.operator, allowed);
      const value = spec.value;
      if (operator === null || typeof value !== 'number' || !Number.isFinite(value)) {
        return [];
      }

      const compare = THRESHOLD_COMPARATORS[operator];
      const havingPredicate = compare(freshAggregate(), mSql.literal(value));

      const groupKey = identifierAccess(SqlIdentifier.from(spec.column), spec.columnPaths);
      const subquery = mSql.Query.select({ [spec.column]: groupKey })
        .from(from)
        .groupby(groupKey)
        .having(compare(freshAggregate(), mSql.literal(value)));
      const contextPredicate = args.contextPredicate;
      if (contextPredicate !== null) {
        subquery.where(contextPredicate);
      }

      const members = buildSubqueryClauseParts({
        column: spec.column,
        columnPaths: spec.columnPaths,
        query: subquery,
      });

      return [
        {
          target: targets.having,
          clause: { value, predicate: havingPredicate, fields: [] },
        },
        {
          target: targets.members,
          clause: { value, predicate: members.predicate, fields: members.fields },
        },
      ];
    },
    formatValue: (spec: FilterSpec) => {
      const operator = spec.operator ?? DEFAULT_THRESHOLD_OPERATOR;
      const value = formatFilterValue(spec.value);
      if (!isThresholdOperator(operator)) {
        return value;
      }
      return `${THRESHOLD_GLYPHS[operator]} ${value}`;
    },
  };
}
