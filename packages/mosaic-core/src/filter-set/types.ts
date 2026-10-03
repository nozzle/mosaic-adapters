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
import type { ClauseMetadata, ClauseSource, MosaicClient, Selection } from '@uwdata/mosaic-core';
import type { ExprNode } from '@uwdata/mosaic-sql';

import type { Persister } from '../persistence';
import type { ColumnPathMode } from '../types';

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
  /**
   * How a dotted `column` is read (see {@link ColumnPathMode}). Omitted or
   * `'struct'`: a struct path (`meta.country` → `"meta"."country"`).
   * `'literal'`: one identifier (`"meta.country"`), for a column whose name
   * itself contains a dot. Also applies to the columns of a multi-column
   * `points` envelope and to the outer column of a `subqueryFilterKind`.
   */
  columnPaths?: ColumnPathMode;
  /** Registry key: 'point' | 'points' | 'interval' | 'match' | 'condition' | custom. */
  kind: string;
  /** Kind-specific operator (condition/match). */
  operator?: string;
  /** Filter value; must remain JSON-serializable. */
  value?: unknown;
  /** Second bound for range-shaped kinds; must remain JSON-serializable. */
  valueTo?: unknown;
  /**
   * Default routing target name; defaults to the set's
   * {@link FilterSetOptions.defaultTarget} (itself `'where'` by default).
   */
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
   * The resolved column expression: a struct path
   * (`createStructAccess(SqlIdentifier.from(spec.column))`), or one quoted
   * identifier when `spec.columnPaths` is `'literal'`.
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
  /**
   * Target name; resolution order:
   * `emission.target ?? spec.target ?? defaultTarget` (`'where'` unless the set
   * declares another {@link FilterSetOptions.defaultTarget}).
   */
  target?: string;
  clause: {
    /** Clause app-level value; defaults to `spec.value`. */
    value?: unknown;
    /** SQL predicate; `null` → inactive (the clause is cleared on that target). */
    predicate: ExprNode | null;
    /**
     * Input field expressions the predicate filters over (Mosaic 0.29+). Each
     * must be an exact node instance referenced inside `predicate` (identity
     * matters for pre-aggregation). Omit to default to the spec's resolved
     * column expression (`args.column`), correct for kinds whose predicate
     * tests that single column directly.
     */
    fields?: Array<ExprNode>;
    /**
     * Optimizer hints. ONLY valid for `point`/`interval`-shaped predicates;
     * NEVER attach to subquery-bearing predicates (see clause-factory.ts).
     */
    meta?: ClauseMetadata;
  };
}

/**
 * Value shape an operator consumes — descriptive UI-introspection metadata,
 * never runtime-enforced.
 *
 * - `'none'`: takes no value (e.g. `is_empty` / `is_not_empty`).
 * - `'unary'`: a single value, read from `spec.value` (e.g. `contains`, `eq`).
 * - `'range'`: two bounds, read from `spec.value` + `spec.valueTo` (e.g.
 *   `between`).
 * - `'set'`: an array value, read from `spec.value` (e.g. `is_any_of` /
 *   `is_not_any_of`).
 */
export type OperatorArity = 'none' | 'unary' | 'range' | 'set';

/**
 * A self-describing operator entry a {@link FilterKind} advertises for UI
 * introspection (operator pickers, value-input shape). Descriptive only — the
 * kind's `emit` remains the source of truth for behavior.
 */
export interface OperatorDescriptor {
  /** Operator id, as placed on {@link FilterSpec.operator}. */
  id: string;
  /** Human-readable label (e.g. `starts_with` → "starts with"). */
  label?: string;
  /** Value shape this operator consumes. */
  arity?: OperatorArity;
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
  /**
   * Operators this kind interprets, for UI introspection. Descriptive only —
   * not validated by {@link FilterSet.set}. Kinds that ignore `spec.operator`
   * omit this field.
   */
  operators?: ReadonlyArray<OperatorDescriptor>;
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
  /**
   * Resolved routing target this chip's clause is actually published to — the
   * target the kind's emission resolved to (`emission.target ?? spec.target ??
   * defaultTarget`), NOT the declared `spec.target`. For a self-routing kind whose
   * emissions override the target, this reports where the clause landed (e.g.
   * `having:foo`), not the spec's decorative `target`.
   *
   * A spec may emit to multiple targets (e.g. a metric-threshold kind emitting
   * to both `having:<card>` and `members:<card>`); this single string is the
   * deterministic PRIMARY: the first emission's resolved target in
   * kind-declaration order. Exploded chips report the same resolved target as
   * their parent spec. Falls back to `spec.target ?? defaultTarget` before the
   * spec has published an active clause.
   */
  target: string;
  /** The spec's operator, when it declares one (e.g. `in`, `not_in`, `starts_with`). */
  operator?: string;
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
  /**
   * Target name a spec routes to when neither its kind's emission nor the spec
   * itself names one (`emission.target ?? spec.target ?? defaultTarget`). Also
   * the chip fallback target before a spec has published. Use it on sets
   * without a `where` target, so specs from `publish.into` widgets (which name
   * no target unless configured) land somewhere instead of being warned about
   * and dropped. Defaults to `'where'`. An explicit value must name one of
   * `targets`, or `createFilterSet` throws.
   */
  defaultTarget?: string;
  /** Whole-set persistence: one entry holding the `FilterSpec[]`. */
  persist?: Persister<Array<FilterSpec>>;
  /**
   * Context Selection for subquery kinds — the `contextPredicate` source and
   * the rebuild trigger (its `value` events re-publish context-dependent specs).
   */
  context?: Selection;
}

/**
 * Options for {@link FilterSet.destroy}.
 */
export interface FilterSetDestroyOptions {
  /**
   * When `true`, tear down without publishing clear clauses: the target
   * Selections keep the set's last clauses and emit no `value` event, so
   * clients still connected to them do not re-query. Use it when the targets
   * die with the set (as `createTopology` does for its own `filter-set`
   * entries). Defaults to `false`: every published clause is cleared from its
   * target, which is what a set publishing into longer-lived (external)
   * targets needs.
   */
  silent?: boolean;
}

/**
 * Options for {@link FilterSet.reset}.
 */
export interface FilterSetResetOptions {
  /**
   * Specs for which this returns `true` survive the reset: they stay in the
   * set and the reset leaves their published clauses untouched (no
   * re-publish, no extra query round). A kept spec whose kind reads
   * `contextPredicate` still rebuilds afterwards, because removing its
   * siblings changes the context (suppressed when its SQL is unchanged).
   * Every other spec is removed and its clauses cleared. Omit to remove
   * every spec.
   */
  keep?: (spec: FilterSpec) => boolean;
}

/**
 * Options shared by {@link emitFilterSpec} and {@link filterSpecPredicate}.
 */
export interface EmitFilterSpecOptions {
  /**
   * Custom / overriding kinds, merged over the built-ins — the same shape as
   * {@link FilterSetOptions.kinds}. Pass `filterSet.kinds` to resolve a spec
   * exactly as that set would.
   */
  kinds?: Record<string, FilterKind>;
  /**
   * The value a kind reads as {@link FilterKindArgs.contextPredicate}.
   * Defaults to `null` (no context / no active sibling clauses).
   */
  contextPredicate?: ExprNode | null;
  /**
   * Fallback target name for emissions that name none and specs without a
   * `target` — see {@link FilterSetOptions.defaultTarget}. Defaults to
   * `'where'`.
   */
  defaultTarget?: string;
}

/**
 * Options for {@link filterSpecPredicate}.
 */
export interface FilterSpecPredicateOptions extends EmitFilterSpecOptions {
  /**
   * Resolved target whose predicate to return. Omit to return the primary
   * target's predicate: the first emission with an active (non-`null`)
   * predicate in kind-declaration order — the same target a chip reports.
   */
  target?: string;
}

/**
 * One resolved clause a spec would publish, as computed by
 * {@link emitFilterSpec}. Defaults are already applied: `target` is resolved,
 * `value` falls back to `spec.value ?? null`, and `fields` to the spec's
 * resolved column expression.
 */
export interface FilterSpecEmission {
  /** Resolved target name (`emission.target ?? spec.target ?? defaultTarget`). */
  target: string;
  /** SQL predicate; `null` means the spec is inactive on this target. */
  predicate: ExprNode | null;
  /** Input field expressions the predicate filters over. */
  fields: Array<ExprNode>;
  /** Clause app-level value. */
  value: unknown;
  /** Optimizer hints; present only for point/interval-shaped predicates. */
  meta?: ClauseMetadata;
}

/**
 * The writer a {@link FilterSet.batch} callback receives: the set's mutators.
 * Every write through it is part of the batch. Use it as the handle inside
 * the callback; it is not guaranteed to be the FilterSet object itself.
 */
export type FilterSetBatchWriter = Pick<
  FilterSet,
  'set' | 'remove' | 'clear' | 'reset' | 'removeChip'
>;

/**
 * A page-level filter set. Framework bindings subscribe to `store`; the
 * mutators publish/clear clauses on the target Selections and persist intent.
 */
export interface FilterSet {
  /** Read from `store.state`, subscribe via `store.subscribe`. Read-only. */
  readonly store: Store<FilterSetState>;
  /**
   * The merged kind registry this set resolves specs with (the built-ins
   * overlaid with {@link FilterSetOptions.kinds}). Frozen. Pass it to
   * {@link emitFilterSpec} / {@link filterSpecPredicate} to compute the clause a
   * spec would publish without publishing it.
   */
  readonly kinds: Readonly<Record<string, FilterKind>>;
  /** The resolved {@link FilterSetOptions.defaultTarget} (`'where'` by default). */
  readonly defaultTarget: string;
  /** Upsert a spec (replacement keeps insertion position) and publish it. */
  set: (spec: FilterSpec, options?: FilterSetSetOptions) => void;
  /** Delete a spec and clear its published clauses. */
  remove: (id: string) => void;
  /** Keep the spec but drop value/valueTo/operator → the spec goes inactive. */
  clear: (id: string) => void;
  /**
   * Remove all specs and clear their clauses. With `{ keep }`, specs the
   * predicate accepts survive untouched ("clear all except X"). Either way it
   * is one store sync and one persister write.
   */
  reset: (options?: FilterSetResetOptions) => void;
  /** Remove one chip: exploded → narrow the value; otherwise `remove(id)`. */
  removeChip: (chip: FilterSetChip) => void;
  /**
   * Opt-in: apply several writes as one update. Every write made through `tx`
   * (or through this set's own mutators) inside `fn` lands on the resolved
   * clauses as it happens; when `fn` returns, each touched Selection — target,
   * and every compose / cascading context or skip projection derived from it —
   * emits once, then the store syncs once and the persister is written once.
   *
   * The combined emission bypasses Mosaic's pre-aggregation for that one
   * update (a pre-aggregated view could hold stale values of the other
   * clauses), so the coordinator issues standard queries. Not a transaction:
   * if `fn` throws, the writes made before the throw still apply (and emit)
   * before `fn`'s error propagates. Writes made directly on a Selection or
   * Param are not deferred, and a custom Selection subclass overriding
   * `update` / `reset` emits immediately. `fn` must be synchronous: writes
   * after an `await` are not batched. `store` is not updated until the batch
   * ends. On a destroyed set `fn` still runs, and its writes are no-ops as
   * usual.
   *
   * Only one batch can be open at a time. A nested `batch()` on this set — or
   * this set's `batch()` inside its owning topology's `topology.batch()` —
   * joins the open batch. Any other nesting (a `batch()` on a different
   * FilterSet, or a `topology.batch()`, inside `fn`; this set's `batch()`
   * inside another set's batch) throws before the inner callback runs; batch
   * several sets with a `topology.batch()` that owns them all. A batch stays
   * open until it has emitted, so a `batch()` from a filter kind rebuilt
   * while it settles, or from a `value` listener fired by its flush, throws
   * too.
   *
   * @throws when another batch that does not cover this set is open (message
   *   `NESTED_BATCH_ERROR_MESSAGE`).
   */
  batch: (fn: (tx: FilterSetBatchWriter) => void) => void;
  /**
   * Clear published clauses (skipped with `{ silent: true }`), detach
   * listeners; never writes to the persister. Idempotent.
   */
  destroy: (options?: FilterSetDestroyOptions) => void;
  /** True once {@link FilterSet.destroy} has run. */
  readonly destroyed: boolean;
  /**
   * True when `source` is a clause source this FilterSet created (one of its
   * stable per-`(spec.id, target)` sources). Lets an owner that constructed
   * this set — e.g. `createTopology` — recognise the set's own clauses on a
   * shared target Selection and exclude them from foreign-clause enumeration.
   */
  ownsClauseSource: (source: ClauseSource) => boolean;
}
