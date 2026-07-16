/**
 * The FilterKind registry, built from the spec. The app ships GENERIC behavior
 * factories (keyed by behavior name); the spec's `filter_kinds:` section
 * instantiates them with config. Nothing here hard-codes a table, column, or
 * target — every domain value arrives through {@link AggregateThresholdConfig}.
 *
 * The one shipped behavior, `aggregate-threshold`, compares a per-group
 * aggregate against a threshold and emits two clauses —
 *
 * 1. `config.having_target` — `<aggregate> >/< N` on the widget's own grouped
 *    query, and
 * 2. `config.members_target` — `<group_by> IN (SELECT <group_by> FROM <table>
 *    WHERE <context predicate> GROUP BY <group_by> HAVING <aggregate cmp N>)`,
 *    so every sibling narrows to the matching subset.
 *
 * Reading `contextPredicate` registers the spec as context-dependent, so the
 * set rebuilds the subquery on context changes.
 */
import * as mSql from '@uwdata/mosaic-sql';
import {
  SqlIdentifier,
  buildSubqueryClauseParts,
  builtinFilterKinds,
  createStructAccess,
} from '@nozzleio/react-mosaic';
import type {
  FilterKind,
  FilterKindArgs,
  OperatorDescriptor,
} from '@nozzleio/react-mosaic';
import type {
  AggregateThresholdConfig,
  DashboardSpec,
  FilterKindDef,
  ThresholdOperator,
} from './schema';

// ── Threshold operator vocabulary ─────────────────────────────────────────────

/** mosaic-sql comparison builder per operator id. */
const COMPARATORS: Record<
  ThresholdOperator,
  (left: mSql.ExprNode, right: mSql.ExprNode) => mSql.ExprNode
> = {
  gt: mSql.gt,
  lt: mSql.lt,
  gte: mSql.gte,
  lte: mSql.lte,
};

/** Descriptor metadata per operator id (for UI enumeration). */
const OPERATOR_META: Record<ThresholdOperator, OperatorDescriptor> = {
  gt: { id: 'gt', label: 'greater than', arity: 'unary' },
  lt: { id: 'lt', label: 'less than', arity: 'unary' },
  gte: { id: 'gte', label: 'at least', arity: 'unary' },
  lte: { id: 'lte', label: 'at most', arity: 'unary' },
};

/** Chip glyph per operator id. */
const OPERATOR_GLYPH: Record<ThresholdOperator, string> = {
  gt: '>',
  lt: '<',
  gte: '≥',
  lte: '≤',
};

function isThresholdOperator(value: unknown): value is ThresholdOperator {
  return value === 'gt' || value === 'lt' || value === 'gte' || value === 'lte';
}

// ── The `aggregate-threshold` behavior factory ────────────────────────────────

/**
 * Build a {@link FilterKind} from an aggregate-threshold config. The `aggregate`
 * string compiles to a raw mosaic-sql fragment; `group_by` routes through
 * `SqlIdentifier` + `createStructAccess`. The kind advertises exactly the
 * configured operators; `emit` is the source of truth.
 */
export function aggregateThresholdBehavior(
  config: AggregateThresholdConfig,
): FilterKind {
  const allowed = new Set<ThresholdOperator>(config.operators);
  const operators: ReadonlyArray<OperatorDescriptor> = config.operators.map(
    (id) => OPERATOR_META[id],
  );
  const aggExpr = (): mSql.ExprNode => mSql.sql`${config.aggregate}`;

  return {
    operators,
    emit: (args: FilterKindArgs) => {
      const operator = args.spec.operator;
      const value = args.spec.value;
      if (
        !isThresholdOperator(operator) ||
        !allowed.has(operator) ||
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < 0
      ) {
        return [];
      }

      const compare = COMPARATORS[operator];
      const havingPredicate = compare(aggExpr(), mSql.literal(value));

      const groupKey = createStructAccess(SqlIdentifier.from(config.group_by));
      const subquery = mSql.Query.select({ member: groupKey })
        .from(config.table)
        .groupby(groupKey)
        .having(compare(aggExpr(), mSql.literal(value)));
      const contextPredicate = args.contextPredicate;
      if (contextPredicate !== null) {
        subquery.where(contextPredicate);
      }

      // `field` is the exact group_by node embedded in the IN-subquery
      // predicate, so `fields: [field]` satisfies Mosaic 0.29 field identity
      // for pre-aggregation on the members target.
      const { predicate: membersPredicate, field } = buildSubqueryClauseParts({
        column: config.group_by,
        query: subquery,
      });

      return [
        {
          // The HAVING predicate tests a post-aggregate expression, not the
          // spec's resolved column, so the default `fields` would be wrong;
          // an aggregate has no scannable input field, so `fields` is empty.
          target: config.having_target,
          clause: { value, predicate: havingPredicate, fields: [] },
        },
        {
          target: config.members_target,
          clause: { value, predicate: membersPredicate, fields: [field] },
        },
      ];
    },
    formatValue: (spec) => {
      const glyph = isThresholdOperator(spec.operator)
        ? OPERATOR_GLYPH[spec.operator]
        : '?';
      return `${glyph} ${String(spec.value)}`;
    },
  };
}

// ── Behavior registry + spec-driven kind registry ────────────────────────────

/** A behavior factory: config → FilterKind. */
export type BehaviorFactory = (config: AggregateThresholdConfig) => FilterKind;

/** Behavior factories, keyed by the `behavior` name the spec references. */
export const behaviorRegistry: Record<
  FilterKindDef['behavior'],
  BehaviorFactory
> = {
  'aggregate-threshold': aggregateThresholdBehavior,
};

/** True when a behavior name has a registered factory. */
export function isKnownBehavior(
  name: string,
): name is FilterKindDef['behavior'] {
  return name in behaviorRegistry;
}

/**
 * Behaviors whose kinds emit their own routing targets (`having:`/`members:`)
 * and ignore `spec.target` — the filter builder must not stamp a decorative
 * `spec.target` on their specs.
 */
export const selfRoutingBehaviors: ReadonlySet<FilterKindDef['behavior']> =
  new Set<FilterKindDef['behavior']>(['aggregate-threshold']);

/** The `filter_kinds` names whose behavior is self-routing. */
export function buildSelfRoutingKindNames(spec: DashboardSpec): Set<string> {
  const names = new Set<string>();
  for (const [name, def] of Object.entries(spec.filter_kinds ?? {})) {
    if (selfRoutingBehaviors.has(def.behavior)) {
      names.add(name);
    }
  }
  return names;
}

/**
 * Instantiate the spec's `filter_kinds` (the non-builtin kinds), keyed by the
 * name the spec chose. Behaviors with no registered factory are skipped —
 * validation reports them as errors ahead of this.
 */
export function buildSpecKinds(
  spec: DashboardSpec,
): Record<string, FilterKind> {
  const kinds: Record<string, FilterKind> = {};
  for (const [name, def] of Object.entries(spec.filter_kinds ?? {})) {
    if (!isKnownBehavior(def.behavior)) {
      continue;
    }
    kinds[name] = behaviorRegistry[def.behavior](def.config);
  }
  return kinds;
}

/**
 * The full kind registry: library built-ins merged with the instantiated spec
 * kinds. The cross-reference validator checks every filter placement `kind` and
 * every `metric_threshold.kind` against this.
 */
export function buildKindRegistry(
  spec: DashboardSpec,
): Record<string, FilterKind> {
  return { ...builtinFilterKinds, ...buildSpecKinds(spec) };
}
