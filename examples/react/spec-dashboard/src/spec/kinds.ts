import { aggregateThresholdFilterKind, builtinFilterKinds } from '@nozzleio/react-mosaic';
import type { FilterKind } from '@nozzleio/react-mosaic';
/**
 * The FilterKind registry, built from the spec. The app ships GENERIC behavior
 * factories (keyed by behavior name); the spec's `filter_kinds:` section
 * instantiates them with config. Nothing here hard-codes a table, column, or
 * target — every domain value arrives through {@link AggregateThresholdConfig}
 * or the spec's own `column`.
 *
 * The one shipped behavior, `aggregate-threshold`, is the library's
 * `aggregateThresholdFilterKind`: it compares a per-group aggregate against a
 * threshold and emits two clauses —
 *
 * 1. `config.having_target` — `<aggregate> >/< N` on the widget's own grouped
 *    query, and
 * 2. `config.members_target` — `<column> IN (SELECT <column> FROM <table>
 *    WHERE <context predicate> GROUP BY <column> HAVING <aggregate cmp N>)`,
 *    so every sibling narrows to the matching subset.
 *
 * The group key is the spec's `column` (the widget's `metric_threshold.group_by`
 * or the placement's `spec_column`). The kind embeds the context predicate, so
 * the set rebuilds the subquery on context changes.
 */
import * as mSql from '@uwdata/mosaic-sql';

import type { AggregateThresholdConfig, DashboardSpec, FilterKindDef } from './schema';

// ── The `aggregate-threshold` behavior factory ────────────────────────────────

/**
 * Build a {@link FilterKind} from an aggregate-threshold config. The `aggregate`
 * string compiles to a raw mosaic-sql fragment, built fresh for each emission.
 * The kind advertises exactly the configured operators; `emit` is the source of
 * truth.
 */
export function aggregateThresholdBehavior(config: AggregateThresholdConfig): FilterKind {
  return aggregateThresholdFilterKind({
    from: config.table,
    aggregate: () => mSql.sql`${config.aggregate}`,
    targets: { having: config.having_target, members: config.members_target },
    operators: config.operators,
  });
}

// ── Behavior registry + spec-driven kind registry ────────────────────────────

/** A behavior factory: config → FilterKind. */
export type BehaviorFactory = (config: AggregateThresholdConfig) => FilterKind;

/** Behavior factories, keyed by the `behavior` name the spec references. */
export const behaviorRegistry: Record<FilterKindDef['behavior'], BehaviorFactory> = {
  'aggregate-threshold': aggregateThresholdBehavior,
};

/** True when a behavior name has a registered factory. */
export function isKnownBehavior(name: string): name is FilterKindDef['behavior'] {
  return name in behaviorRegistry;
}

/**
 * Behaviors whose kinds emit their own routing targets (`having:`/`members:`)
 * and ignore `spec.target` — the filter builder must not stamp a decorative
 * `spec.target` on their specs.
 */
export const selfRoutingBehaviors: ReadonlySet<FilterKindDef['behavior']> = new Set<
  FilterKindDef['behavior']
>(['aggregate-threshold']);

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
export function buildSpecKinds(spec: DashboardSpec): Record<string, FilterKind> {
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
export function buildKindRegistry(spec: DashboardSpec): Record<string, FilterKind> {
  return { ...builtinFilterKinds, ...buildSpecKinds(spec) };
}
