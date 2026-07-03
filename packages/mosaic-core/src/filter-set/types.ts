/**
 * Public types for the FilterSet subsystem — a page-level object that owns a
 * set of dashboard *filter intents* (plain, JSON-serializable {@link FilterSpec}
 * records), resolves each into one Selection clause per routing target, and
 * derives a chip list for an active-filter bar.
 *
 * The spec is the serializable state: a spec must round-trip through
 * `JSON.parse(JSON.stringify(spec))` and reproduce identical SQL. Kinds
 * therefore never depend on non-serializable values (Date instances,
 * class instances); they accept plain scalars/arrays and let DuckDB coerce.
 */
import type { Store } from '@tanstack/store';
import type {
  ClauseMetadata,
  MosaicClient,
  Selection,
} from '@uwdata/mosaic-core';
import type { ExprNode } from '@uwdata/mosaic-sql';
import type { Persister } from '../persistence';

/**
 * Plain JSON-serializable dashboard-filter intent. THE serializable state.
 *
 * The `id` is the stable identity used for persistence, chip keys, and clause
 * replacement — publishing a spec with an existing id replaces the prior spec
 * (keeping its position) and its published clauses.
 */
export interface FilterSpec {
  /** Stable key — persistence, chips, replacement. */
  id: string;
  /** Column name or struct path (e.g. `related_phrase.phrase`). */
  column: string;
  /** Registry key: 'point' | 'points' | 'interval' | 'match' | 'condition' | custom. */
  kind: string;
  /** Kind-specific operator (condition/match). */
  operator?: string;
  /** Filter value; must remain JSON-serializable. */
  value?: unknown;
  /** Second bound for range-shaped kinds; must remain JSON-serializable. */
  valueTo?: unknown;
  /** Default routing target name; defaults to `'where'`. */
  target?: string;
  /** UI metadata (chip label). */
  label?: string;
}

/**
 * Arguments handed to a {@link FilterKind}'s `emit`.
 */
export interface FilterKindArgs {
  /** The spec being resolved. Treat as immutable. */
  spec: FilterSpec;
  /**
   * Struct-path-resolved column expression:
   * `createStructAccess(SqlIdentifier.from(spec.column))`.
   */
  column: ExprNode;
  /**
   * AND of the context Selection's clauses excluding this spec's own clauses,
   * or `null` when there is no context or no active sibling clauses. Reading
   * this getter marks the spec as context-dependent, so it is republished on
   * the context Selection's `value` events.
   */
  readonly contextPredicate: ExprNode | null;
}

/**
 * One clause a {@link FilterKind} wants published, addressed to a target.
 */
export interface FilterKindEmission {
  /** Target name; resolution order: `emission.target ?? spec.target ?? 'where'`. */
  target?: string;
  clause: {
    /** Clause app-level value; defaults to `spec.value`. */
    value?: unknown;
    /** SQL predicate; `null` → inactive (the clause is cleared on that target). */
    predicate: ExprNode | null;
    /**
     * Optimizer hints. ONLY valid for `point`/`interval`-shaped predicates;
     * NEVER attach to subquery-bearing predicates (see clause-factory.ts).
     */
    meta?: ClauseMetadata;
  };
}

/**
 * A kind translates a {@link FilterSpec} into zero or more Selection-clause
 * emissions. Registered by key in {@link FilterSetOptions.kinds}, merged over
 * the {@link builtinFilterKinds} defaults.
 */
export interface FilterKind {
  /**
   * Resolve a spec into clause emissions. An empty array — or emissions whose
   * predicates are all `null` — means the spec is inactive; its published
   * clauses are cleared.
   */
  emit: (args: FilterKindArgs) => Array<FilterKindEmission>;
  /** Chip value formatting override (else the default formatter is used). */
  formatValue?: (spec: FilterSpec) => string;
  /**
   * Explode a plain-array spec value into one chip per element so a single
   * chip removal narrows the value rather than clearing the whole spec.
   */
  explodeValues?: boolean;
}

/**
 * A derived chip for an active-filter bar. Chips mirror the spec list (one per
 * spec, or one per element for exploded values), not the clause list.
 */
export interface FilterSetChip {
  /** `spec.id`, or `${spec.id}:${index}` for exploded values. */
  key: string;
  /** Owning spec id. */
  id: string;
  /** `spec.label ?? spec.column`. */
  label: string;
  /** The whole spec value, or the exploded element. */
  value: unknown;
  /** Human-readable value string. */
  formattedValue: string;
  /** True when this chip is one exploded element of a multi-value spec. */
  exploded: boolean;
}

/**
 * The reactive state exposed on {@link FilterSet.store}.
 */
export interface FilterSetState {
  /** Insertion-ordered specs; replacement keeps position. */
  specs: Array<FilterSpec>;
  /** Derived chips. */
  chips: Array<FilterSetChip>;
}

/**
 * Options for {@link FilterSet.set}.
 */
export interface FilterSetSetOptions {
  /**
   * Session-bound self-exclusion clients attached to this spec's published
   * clauses (crossfilter semantics). Wired by publish.into; never persisted.
   */
  clients?: Set<MosaicClient>;
}

/**
 * Options for {@link createFilterSet}.
 */
export interface FilterSetOptions {
  /**
   * Named target Selections. Single-target pages pass `{ where: $sel }`.
   * Emissions resolve their target name against these.
   */
  targets: Record<string, Selection>;
  /** Custom / overriding kinds, merged over the built-ins. */
  kinds?: Record<string, FilterKind>;
  /** Whole-set persistence: one entry holding the `FilterSpec[]`. */
  persist?: Persister<Array<FilterSpec>>;
  /**
   * Context Selection for subquery kinds — the `contextPredicate` source and
   * the rebuild trigger (its `value` events re-publish context-dependent specs).
   */
  context?: Selection;
}

/**
 * A page-level filter set. Framework bindings subscribe to `store`; the
 * mutators publish/clear clauses on the target Selections and persist intent.
 */
export interface FilterSet {
  /** Read from `store.state`, subscribe via `store.subscribe`. Read-only. */
  readonly store: Store<FilterSetState>;
  /** Upsert a spec (replacement keeps insertion position) and publish it. */
  set: (spec: FilterSpec, options?: FilterSetSetOptions) => void;
  /** Delete a spec and clear its published clauses. */
  remove: (id: string) => void;
  /** Keep the spec but drop value/valueTo/operator → the spec goes inactive. */
  clear: (id: string) => void;
  /** Remove all specs and clear all clauses. */
  reset: () => void;
  /** Remove one chip: exploded → narrow the value; otherwise `remove(id)`. */
  removeChip: (chip: FilterSetChip) => void;
  /** Clear published clauses, detach listeners; never writes to the persister. */
  destroy: () => void;
  /** True once {@link FilterSet.destroy} has run. */
  readonly destroyed: boolean;
}
