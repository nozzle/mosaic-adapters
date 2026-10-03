import type { Store } from '@tanstack/store';
import type { ClauseSource, Param, Selection } from '@uwdata/mosaic-core';
import type { ExprNode } from '@uwdata/mosaic-sql';

/**
 * Public types for {@link createTopology} — the named-Selection-graph primitive.
 *
 * A topology *config* is a pure JSON document naming every Selection on a page
 * and how they relate (standalone, composed, cascading, filter-set, or an
 * `external` escape hatch). The *options bag* carries everything that is code —
 * external Selection instances and the code-only parts of FilterSet
 * construction (`kinds`, `persist`) — keyed by the names the config declares.
 *
 * The config is the complete namespace document: every name, including
 * code-created ones, is declared, so `validNames` is total and a hand-editor
 * sees every hole the code must fill.
 */
import type { FilterKind, FilterSet, FilterSpec } from '../filter-set/types';
import type { Persister } from '../persistence';

/** Standalone Selection resolution strategies. */
export type StandaloneSelectionType = 'intersect' | 'union' | 'single' | 'crossfilter';

/**
 * The value a `param` entry holds and resets to. A scalar or a flat array of
 * scalars — the JSON-serialisable shape a Mosaic `Param` carries.
 */
export type ParamValue = string | number | boolean | null | Array<string | number | boolean | null>;

/**
 * Fields every declaration accepts. `label` and `meta` are opaque passthrough
 * surfaced on the active-clause store; the library never interprets `meta`.
 * `reset: false` opts an entry out of {@link Topology.reset}.
 */
export interface DeclarationBase {
  /** Human-readable label, surfaced on annotated active clauses. */
  label?: string;
  /** Opaque passthrough, surfaced on annotated active clauses. Never interpreted. */
  meta?: unknown;
  /** When `false`, {@link Topology.reset} skips this entry. Defaults to `true`. */
  reset?: boolean;
}

/** A standalone Selection of a fixed resolution strategy. */
export interface StandaloneDeclaration extends DeclarationBase {
  type: StandaloneSelectionType;
}

/**
 * A composed Selection mirroring the union of the clauses of every ref in
 * `include`. Refs must resolve to non-compound entries. Derived: skipped by
 * {@link Topology.reset}.
 *
 * `as` picks the composite's resolution strategy (default `'intersect'`). With
 * `as: 'crossfilter'` the composite self-excludes its own publishers: a client
 * that published a clause into an included Selection reads a
 * `context.predicate(ownClient)` that omits that client's own predicate — the
 * per-client self-exclusion a facet or summary control needs to avoid filtering
 * by itself. Self-exclusion is a property of the composite a client *reads*, so
 * it is never inherited from includes: an `intersect` compose that includes a
 * `crossfilter` compose does not self-exclude for its readers.
 */
export interface ComposeDeclaration extends DeclarationBase {
  type: 'compose';
  /** Refs to other declared selections whose clauses are composed. */
  include: Array<string>;
  /**
   * Resolution strategy for the composite. `'intersect'` (default) never
   * self-excludes; `'crossfilter'` self-excludes each clause's own clients.
   */
  as?: 'intersect' | 'crossfilter';
}

/**
 * Per-key peer-cascading contexts. `keys` are refs to other declared
 * selections used as the cascading *inputs*; the entry yields one context per
 * key, addressable as `entry.key`. `externals` are refs included in every
 * context. Derived: skipped by {@link Topology.reset}.
 */
export interface CascadingDeclaration extends DeclarationBase {
  type: 'cascading';
  /** Refs to declared selections; each becomes a cascading input + context. */
  keys: Array<string>;
  /** Refs to declared selections included in every context (e.g. table filters). */
  externals?: Array<string>;
}

/**
 * A FilterSet whose declared `targets` each become an addressable target
 * Selection, resolvable as `entry.targetName`. `context` is a ref to a declared
 * selection used as the FilterSet's subquery context. The code-only parts of
 * `FilterSetOptions` (`kinds`, `persist`) are supplied via
 * {@link TopologyOptions.filterSets}, keyed by entry name.
 */
export interface FilterSetDeclaration extends DeclarationBase {
  type: 'filter-set';
  /** Target name → resolution strategy for that target's Selection. */
  targets: Record<string, StandaloneSelectionType>;
  /** Ref to a declared selection used as the FilterSet's context. */
  context?: string;
  /**
   * The FilterSet's `FilterSetOptions.defaultTarget`: the declared target
   * a spec routes to when neither its kind's emission nor the spec names one.
   * Must be one of the `targets` keys. Defaults to `'where'`.
   */
  defaultTarget?: string;
}

/**
 * An escape hatch: the Selection instance is supplied in
 * {@link TopologyOptions.selections}, keyed by entry name. The library does not
 * own it (never destroyed) and does not care where it came from.
 */
export interface ExternalDeclaration extends DeclarationBase {
  type: 'external';
}

/**
 * A topology-owned Mosaic `Param`, constructed as `Param.value(default)`. A
 * param is a leaf: it is never composed, cascaded, or used as a filter-set
 * context, and it carries no clauses. {@link Topology.reset} restores `default`.
 */
export interface ParamDeclaration extends DeclarationBase {
  type: 'param';
  /** The initial value, and the value {@link Topology.reset} restores. */
  default: ParamValue;
}

/**
 * An escape hatch: the Param instance is supplied in
 * {@link TopologyOptions.params}, keyed by entry name. The library does not own
 * it (never reset, never destroyed) and does not care where it came from.
 */
export interface ExternalParamDeclaration extends DeclarationBase {
  type: 'external-param';
}

/** The closed declaration vocabulary. Discriminated on `type`. */
export type TopologyDeclaration =
  | StandaloneDeclaration
  | ComposeDeclaration
  | CascadingDeclaration
  | FilterSetDeclaration
  | ExternalDeclaration
  | ParamDeclaration
  | ExternalParamDeclaration;

/** A topology config: a map of entry name → declaration. Pure JSON. */
export type TopologyConfig = Record<string, TopologyDeclaration>;

/** Code-only FilterSet options for one `filter-set` entry, keyed by entry name. */
export interface FilterSetEntryOptions {
  /** Custom / overriding kinds, merged over the built-ins. */
  kinds?: Record<string, FilterKind>;
  /** Whole-set persistence for this entry's specs. */
  persist?: Persister<Array<FilterSpec>>;
}

/** Code-only options for one topology-owned `param` entry, keyed by entry name. */
export interface ParamEntryOptions {
  /**
   * Live-value persistence for this owned param. A non-nullish persisted value
   * hydrates the param at construction and wins over the declared `default`;
   * every subsequent value change (including a {@link Topology.reset}) writes
   * through.
   */
  persist?: Persister<ParamValue>;
}

/** The options bag: everything that is code, keyed by config names. */
export interface TopologyOptions {
  /** Instances for every `external` declaration, keyed by entry name. */
  selections?: Record<string, Selection>;
  /** Instances for every `external-param` declaration, keyed by entry name. */
  params?: Record<string, Param<any>>;
  /** Code-only FilterSet options, keyed by `filter-set` entry name. */
  filterSets?: Record<string, FilterSetEntryOptions>;
  /**
   * Code-only per-param options, keyed by `param` entry name. Applies to
   * topology-OWNED `param` entries only; supplying it for any other entry
   * (including an `external-param`) is a construction error.
   */
  paramOptions?: Record<string, ParamEntryOptions>;
  /**
   * When `true`, {@link Topology.destroy} clears the clauses seeded onto every
   * owned `compose` / `cascading` context and every clause an owned FilterSet
   * published, as it did before teardown went silent. Defaults to `false`:
   * owned contexts and FilterSets detach silently (no clear is published, no
   * `value` event fires), so clients still connected to them do not each run
   * one unfiltered query on teardown. Read once at construction.
   */
  clearOnDestroy?: boolean;
}

/**
 * One active clause across the topology's selections, annotated with its
 * owning entry. Excludes clauses sourced by a FilterSet the topology built
 * (those are spec-derived, not foreign). Annotation passthrough only — no chip
 * model, grouping, or explode logic.
 */
export interface ActiveClause {
  /** The owning entry name (the bare entry, never a dotted ref). */
  entry: string;
  /** The ref the clause's Selection resolves as (`entry` or `entry.child`). */
  ref: string;
  /** The declaration's `label`, if any. */
  label: string | undefined;
  /** The declaration's opaque `meta`, if any. */
  meta: unknown;
  /** The raw Selection clause. */
  clause: {
    source: ClauseSource;
    value: unknown;
    predicate: ExprNode | null;
  };
}

/** Reactive state exposed on {@link Topology.activeClauses}. */
export interface TopologyActiveClausesState {
  /** Foreign active clauses across the topology, annotated by owning entry. */
  clauses: Array<ActiveClause>;
}

/**
 * A constructed topology: named Selections resolvable by ref, plus page-level
 * reset and foreign-clause enumeration.
 */
export interface Topology {
  /** Every resolvable ref (bare entries + dotted children). */
  readonly validNames: Set<string>;
  /**
   * Resolve a ref to its Selection. Throws (listing `validNames`) on an
   * undeclared ref, and on a bare ref to a compound (filter-set / cascading)
   * entry.
   */
  resolve: (ref: string) => Selection;
  /**
   * Resolve a bare entry ref to its Param. Throws (listing `validNames`) on an
   * undeclared ref, on a dotted ref (params have no children), and on a ref to
   * a selection-flavored entry (directing to `resolve`).
   *
   * The `TParamValue` type parameter (default `any`) lets a caller assert the
   * value type at the call site — `resolveParam<MedalMetric>('metric')` — instead
   * of casting the result. It is a caller-side assertion only: the topology
   * stores a heterogeneous `Record<string, Param<any>>` and does not verify it.
   */
  resolveParam: <TParamValue = any>(ref: string) => Param<TParamValue>;
  /**
   * Every `param` / `external-param` entry keyed by name. Built eagerly at
   * construction; owned params are `Param.value(default)`, external params are
   * the supplied instances.
   */
  readonly params: Record<string, Param<any>>;
  /** The FilterSet constructed for a `filter-set` entry, or undefined. */
  getFilterSet: (entry: string) => FilterSet | undefined;
  /** Every constructed FilterSet, keyed by entry name. */
  readonly filterSets: Record<string, FilterSet>;
  /**
   * Type-aware page reset: clear clauses on `standalone` and `external`
   * entries via upstream `selection.reset()` (one emit, relayed to derived
   * contexts, and each clause source's `reset()` invoked so interactors clear
   * their own state), respecting `reset: false`; restore owned `param` entries to their
   * `default`, delegate `filter-set` entries to `filterSet.reset()`, skip
   * `compose`/`cascading` (derived) and `external-param` (not owned).
   */
  reset: () => void;
  /**
   * Opt-in: apply several writes as one update. While `fn` runs, writes to
   * every FilterSet this topology built — and the Selection resets of
   * {@link Topology.reset} — land on the resolved clauses as they happen but
   * do not emit. When `fn` returns, each touched Selection (FilterSet
   * targets, standalone entries, and the compose / cascading contexts and skip
   * projections derived from them) emits once, each FilterSet syncs its store
   * and writes its persister once, and `activeClauses` refreshes once.
   *
   * Param writes are never deferred; they go through Mosaic's usual dispatch.
   * An idle Param emits immediately, before the batched Selections. A Param
   * still dispatching an earlier update queues the value (`param.value` stays
   * old until delivery), so it may reach listeners after the batched
   * Selections, exactly as without a batch; to have a Selection re-query read
   * the new value, update the Param before the batch and
   * `await param.pending('value')`. Writes made directly on a Selection
   * (`selection.update`, an interactor) are not deferred either — only
   * topology-owned FilterSets and `reset()` are, and a custom Selection
   * subclass overriding `update` / `reset` emits immediately. `fn` must be
   * synchronous: writes after an `await` are not batched. The
   * combined emissions bypass Mosaic's pre-aggregation for that one update,
   * because a pre-aggregated view could hold stale values of the other
   * clauses. Not a transaction: if `fn` throws, earlier writes still apply and
   * emit before `fn`'s error propagates.
   *
   * Only one batch can be open at a time. A nested `topology.batch` on this
   * topology, or a `filterSet.batch` on a set it owns, joins this batch.
   * A `filterSet.batch` on a set it does not own, or a `batch` on another
   * topology, throws before its callback runs; so does this `batch` when
   * called inside any open batch other than its own (including an owned
   * set's `filterSet.batch` — open the topology batch on the outside).
   * Owned FilterSets whose contexts read each other's targets are rebuilt
   * until they converge, so each emits once with the final state (a cyclic
   * context graph is not guaranteed to converge inside the batch and may
   * emit again from its usual post-emit rebuild). A batch
   * stays open until it has emitted, so a `batch` from a filter kind rebuilt
   * while it settles, or from a `value` listener fired by its flush, throws
   * too.
   *
   * @throws when another batch is open (message
   *   `NESTED_BATCH_ERROR_MESSAGE`).
   */
  batch: (fn: () => void) => void;
  /**
   * Subscribable store of foreign active clauses across the topology's
   * selections, annotated by owning entry. Read `state`, subscribe via
   * `subscribe`.
   */
  readonly activeClauses: Store<TopologyActiveClausesState>;
  /**
   * Tear down every composition and FilterSet the topology created and
   * unsubscribe all listeners. External instances are never destroyed.
   *
   * Teardown is silent by default: owned contexts and FilterSets detach
   * without publishing clear clauses, so clients still connected to them issue
   * no query. They keep their last clauses but stop relaying — they die with
   * the topology. Opt back into clearing with
   * {@link TopologyOptions.clearOnDestroy}.
   */
  destroy: () => void;
  /** True once {@link Topology.destroy} has run. */
  readonly destroyed: boolean;
}
