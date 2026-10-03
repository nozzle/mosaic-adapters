/**
 * {@link emitFilterSpec} / {@link filterSpecPredicate}: the pure "which clause
 * would this spec publish" resolution a {@link FilterSet} runs before it
 * publishes. FilterSet calls the same {@link resolveFilterSpecEmissions} core,
 * so a pinned per-widget filter, a server prefilter or a preview computed here
 * is identical by construction to what the set publishes.
 *
 * Resolution only: target-existence checks and their warnings stay in the set,
 * which is the only party that knows its target Selections.
 */
import type { ExprNode } from '@uwdata/mosaic-sql';

import { SqlIdentifier, identifierAccess } from '../sql-access';
import { builtinFilterKinds } from './kinds';
import type {
  EmitFilterSpecOptions,
  FilterKind,
  FilterKindArgs,
  FilterSpec,
  FilterSpecEmission,
  FilterSpecPredicateOptions,
} from './types';

/** The target a spec routes to when neither its kind nor the spec names one. */
export const DEFAULT_FILTER_TARGET = 'where';

/** Result of {@link resolveFilterSpecEmissions}. */
export interface ResolvedFilterSpecEmissions {
  /** One entry per resolved target, first-emission order, last emission wins. */
  emissions: Array<FilterSpecEmission>;
  /** True when the kind read `contextPredicate` during this emit. */
  contextRead: boolean;
}

/**
 * Core resolution shared by {@link emitFilterSpec} and FilterSet's publish
 * path. Runs `kind.emit` once and applies every default the set applies:
 *
 * - target: `emission.target ?? spec.target ?? defaultTarget`;
 * - value: `emission.clause.value ?? spec.value ?? null`;
 * - fields: `emission.clause.fields ?? [column]`, where `column` is the one
 *   resolved node handed to the kind — a struct path, or one identifier under
 *   `spec.columnPaths: 'literal'` (identity matters for pre-aggregation).
 *
 * Emissions are grouped by resolved target: the last emission to a target wins
 * while the target keeps the position of its first emission (one clause per
 * `(spec, target)`, deterministic primary target). `contextPredicate` is read
 * lazily so callers can tell whether the spec is context-dependent.
 */
export function resolveFilterSpecEmissions(
  spec: FilterSpec,
  kind: FilterKind,
  options: { defaultTarget: string; contextPredicate: () => ExprNode | null },
): ResolvedFilterSpecEmissions {
  const column = identifierAccess(SqlIdentifier.from(spec.column), spec.columnPaths);
  // Tracked through a cell so the getter's mutation is opaque to the type
  // narrower (the linter would otherwise treat the flag as never reassigned).
  const contextRead = { value: false };
  const args: FilterKindArgs = {
    spec,
    column,
    get contextPredicate(): ExprNode | null {
      contextRead.value = true;
      return options.contextPredicate();
    },
  };

  const byTarget = new Map<string, FilterSpecEmission>();
  for (const emission of kind.emit(args)) {
    const target = emission.target ?? spec.target ?? options.defaultTarget;
    const resolved: FilterSpecEmission = {
      target,
      predicate: emission.clause.predicate,
      fields: emission.clause.fields ?? [column],
      value: emission.clause.value ?? spec.value ?? null,
    };
    if (emission.clause.meta !== undefined) {
      resolved.meta = emission.clause.meta;
    }
    byTarget.set(target, resolved);
  }

  return { emissions: [...byTarget.values()], contextRead: contextRead.value };
}

/** Looks a kind up in the built-ins overlaid with `kinds`; throws when absent. */
function resolveKind(name: string, kinds: Record<string, FilterKind> | undefined): FilterKind {
  const registry: Record<string, FilterKind> = { ...builtinFilterKinds, ...kinds };
  const kind = registry[name];
  if (kind === undefined) {
    const registered = Object.keys(registry).join(', ');
    throw new Error(
      `[mosaic-core] emitFilterSpec received an unknown kind '${name}'. ` +
        `Registered kinds: ${registered}.`,
    );
  }
  return kind;
}

/**
 * Resolves a {@link FilterSpec} into the clauses a {@link FilterSet} would
 * publish for it, without publishing anything: one {@link FilterSpecEmission}
 * per resolved target, in first-emission order. An emission with
 * `predicate: null` means the spec is inactive on that target (the set would
 * clear its clause there); an empty array means the kind emitted nothing.
 *
 * Unlike the set, this does not know which target Selections exist, so
 * emissions to any target name are returned as-is. Pass `filterSet.kinds` and
 * `filterSet.defaultTarget` to resolve exactly as a given set would. Throws on
 * a kind that is not registered (mirroring {@link FilterSet.set}).
 */
export function emitFilterSpec(
  spec: FilterSpec,
  options: EmitFilterSpecOptions = {},
): Array<FilterSpecEmission> {
  const kind = resolveKind(spec.kind, options.kinds);
  const contextPredicate = options.contextPredicate ?? null;
  return resolveFilterSpecEmissions(spec, kind, {
    defaultTarget: options.defaultTarget ?? DEFAULT_FILTER_TARGET,
    contextPredicate: () => contextPredicate,
  }).emissions;
}

/**
 * The predicate a {@link FilterSpec} would publish to one target, or `null`
 * when it would publish none there. With `target` omitted, returns the primary
 * target's predicate — the first emission with an active predicate in
 * kind-declaration order, the same target `chip.target` reports.
 */
export function filterSpecPredicate(
  spec: FilterSpec,
  options: FilterSpecPredicateOptions = {},
): ExprNode | null {
  const emissions = emitFilterSpec(spec, options);
  const target = options.target;
  if (target !== undefined) {
    const match = emissions.find((emission) => emission.target === target);
    return match?.predicate ?? null;
  }
  const primary = emissions.find((emission) => emission.predicate !== null);
  return primary?.predicate ?? null;
}
