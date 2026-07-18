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
import type { ClauseSource, Param, Selection } from '@uwdata/mosaic-core';
import type { ExprNode } from '@uwdata/mosaic-sql';
import type { Store } from '@tanstack/store';

/** Standalone Selection resolution strategies. */
export type StandaloneSelectionType =
  | 'intersect'
  | 'union'
  | 'single'
  | 'crossfilter';

/**
 * The value a `param` entry holds and resets to. A scalar or a flat array of
 * scalars — the JSON-serialisable shape a Mosaic `Param` carries.
 */
export type ParamValue =
  | string
  | number
  | boolean
  | null
  | Array<string | number | boolean | null>;

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
   * entries (respecting `reset: false`), restore owned `param` entries to their
   * `default`, delegate `filter-set` entries to `filterSet.reset()`, skip
   * `compose`/`cascading` (derived) and `external-param` (not owned).
   */
  reset: () => void;
  /**
   * Subscribable store of foreign active clauses across the topology's
   * selections, annotated by owning entry. Read `state`, subscribe via
   * `subscribe`.
   */
  readonly activeClauses: Store<TopologyActiveClausesState>;
  /**
   * Tear down every composition and FilterSet the topology created and
   * unsubscribe all listeners. External instances are never destroyed.
   */
  destroy: () => void;
  /** True once {@link Topology.destroy} has run. */
  readonly destroyed: boolean;
}
