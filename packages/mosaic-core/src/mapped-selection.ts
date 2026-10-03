/**
 * {@link createMappedSelection}: a derived Selection whose clauses are a
 * function of a parent Selection's clauses.
 *
 * The derived Selection is registered in the parent's relay set — exactly how
 * upstream `include` and this package's `createComposedSelection` work — so
 * every clause the parent receives through `update()` is passed through `map`
 * and published onto the derived, as the active clause of an emission. A
 * `null` result drops the clause: the derived never carries it, and if it
 * previously carried a clause from the same source (the map dropped a clause
 * it used to keep), that clause is removed. A `null` result, or a passed-
 * through removal, for a source the derived does not carry is a no-op, so the
 * coordinator never hears about it. `activate` is mapped the same way, so
 * Mosaic's pre-aggregation preview sees the mapped clause.
 *
 * The derived list is always the parent's resolved list, mapped clause by
 * clause and folded through the derived's own resolver (which defaults to
 * the parent's). Relayed `update()`/`reset()` re-derive it that way rather
 * than resolving one clause onto the derived's previous list, so a resolver
 * override whose list semantics differ from the parent's (a `single` derived
 * of an `intersect` parent keeps the parent's last kept clause) agrees with
 * every later re-derivation. The derived never resets clause sources on
 * resolution: the parent owns them.
 *
 * Not every parent publishes through `update()`: a snapshot-style Selection
 * (upstream `clone()`/`remove()`, or an application projection that installs
 * a complete clause list and emits `'value'` itself) never touches the relay.
 * The derived therefore also follows the parent's emitted `'value'`,
 * re-deriving the mapped list from `parent._resolved` (the parent's
 * up-to-date clause list, which may be ahead of a queued emission) and
 * emitting only when it differs in content — same sources (by string `id`
 * when they have one), predicate SQL and `clients` — so a map that mints
 * fresh clause objects on every call does not re-query consumers whose
 * effective inputs are unchanged. A content-equal list made of different
 * clause objects (a snapshot that replaced a source with a new object sharing
 * its `id`, or a clause whose `value`, `fields` or `meta` changed under the
 * same predicate) is adopted without an emission, so `valueFor`, removal,
 * reset and clause data track the parent's current clauses; mapped
 * Selections derived from this one re-derive too, and emit if their own
 * content changed. Both paths are idempotent with each other: after a
 * relayed `update()` the re-derivation finds content-equal clauses and emits
 * nothing. `refresh()` runs the same re-derivation on demand, for a map that
 * reads external state.
 */
import { Param, Selection } from '@uwdata/mosaic-core';
import type { SelectionClause, SelectionResolver } from '@uwdata/mosaic-core';

import { attachIncludedSelection, detachIncludedSelection } from './topology/wiring';

type SelectionClauseList = Selection['clauses'];

/**
 * Maps one parent clause to the derived Selection's clause, or `null` to drop
 * it. Must be pure and must not throw: it runs inside the parent's
 * `update()`. A returned clause must keep the input's `source` identity.
 */
export type SelectionClauseMap = (clause: SelectionClause) => SelectionClause | null;

export interface MappedSelectionOptions {
  /**
   * Resolution strategy of the derived Selection. Defaults to the parent's
   * resolver, so `union`/`intersect`/`single`/`empty`/`cross` semantics are
   * the parent's, evaluated over the mapped clause list. An override applies
   * to that list too: the parent's mapped clauses are folded through it, so a
   * `single` override of a multi-clause parent carries only the parent's
   * last kept clause.
   */
  resolver?: SelectionResolver;
}

/** Handle returned by {@link createMappedSelection}. */
export interface MappedSelectionHandle {
  /**
   * The derived Selection carrying the mapped clauses. Treat it as read-only:
   * a direct `update()` on it is honoured with upstream semantics, but the
   * next re-derivation from the parent (its next `'value'`, or `refresh()`)
   * overwrites it.
   */
  readonly selection: Selection;
  /**
   * Re-derive the mapped list from the parent's current clauses and emit if
   * it changed in content. Call it when state the map reads (other than the
   * parent's clauses) changes. The emitted list carries no active clause, so
   * every consumer re-queries rather than short-circuiting on one source.
   * No-op after `destroy()`.
   */
  refresh: () => void;
  /** Detach from the parent relay and stop following it. Idempotent. */
  destroy: () => void;
}

/** Stable identity of a clause's source: its string `id` when it has one, else the object. */
function sourceKey(clause: SelectionClause): unknown {
  const source = clause.source as { id?: unknown } | null | undefined;
  if (typeof source === 'object' && source !== null && typeof source.id === 'string') {
    return source.id;
  }
  return clause.source;
}

function sameClients(
  a: ReadonlySet<unknown> | undefined,
  b: ReadonlySet<unknown> | undefined,
): boolean {
  if (a === b) {
    return true;
  }
  if (a === undefined || b === undefined || a.size !== b.size) {
    return false;
  }
  for (const client of a) {
    if (!b.has(client)) {
      return false;
    }
  }
  return true;
}

/**
 * Content equality for a clause: same source key, same predicate SQL, same
 * `clients` set. `clients` participates because a re-keyed clause with
 * identical SQL changes this client's crossfilter self-exclusion, which must
 * still re-query (the same reason `FilterSet` bypasses its SQL memo then).
 * Sources compare by string `id` when they have one, so a snapshot parent
 * that mints fresh source objects per snapshot does not re-query consumers.
 * `value`, `fields` and `meta` do not participate either: they do not change
 * the SQL. {@link sameClauseObjects} decides whether the derived must adopt
 * the new clause objects anyway.
 */
function sameClause(a: SelectionClause, b: SelectionClause): boolean {
  if (a === b) {
    return true;
  }
  if (sourceKey(a) !== sourceKey(b)) {
    return false;
  }
  if (String(a.predicate) !== String(b.predicate)) {
    return false;
  }
  return sameClients(a.clients, b.clients);
}

function sameClauseList(
  a: ReadonlyArray<SelectionClause>,
  b: ReadonlyArray<SelectionClause>,
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (!sameClause(a[index]!, b[index]!)) {
      return false;
    }
  }
  return true;
}

/**
 * True when two lists hold the very same clause objects. Content-equal lists
 * can still differ in what consumers read off a clause (its `source` object,
 * `value`, `fields` or `meta`), so anything short of identity is adopted.
 */
function sameClauseObjects(
  a: ReadonlyArray<SelectionClause>,
  b: ReadonlyArray<SelectionClause>,
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

/** The removal clause published when the map stops keeping a carried source. */
function removalFor(clause: SelectionClause): SelectionClause {
  // The parent clause's `clients` keep crossfilter self-exclusion of the
  // removal identical to the parent's.
  return {
    source: clause.source,
    clients: clause.clients,
    fields: [],
    value: null,
    predicate: null,
  };
}

interface DeriveOptions {
  /** Keep the (mapped) active clause of the input list. */
  keepActive: boolean;
  /** Already-computed map results, so a clause is never mapped twice. */
  known?: ReadonlyMap<SelectionClause, SelectionClause | null>;
  /** Sources to leave out of the derived list. */
  exclude?: ReadonlySet<unknown>;
}

class MappedSelection extends Selection {
  readonly #parent: Selection;
  readonly #map: SelectionClauseMap;

  constructor(parent: Selection, map: SelectionClauseMap, resolver: SelectionResolver) {
    super(resolver);
    this.#parent = parent;
    this.#map = map;
    // Seed synchronously from the parent's resolved state (not `.clauses`,
    // which lags one dispatch) the same way upstream `clone()` does, so the
    // first query sees the mapped clause list without emitting events.
    const seeded = this.#derive(parent._resolved, { keepActive: true });
    this._value = seeded;
    this._resolved = seeded;
  }

  /**
   * Map every clause and fold the results through this Selection's own
   * resolver, so its list semantics apply (a `single` resolver keeps only the
   * last kept clause). Never resets a source: the parent owns them.
   */
  #derive(clauses: SelectionClauseList, options: DeriveOptions): SelectionClauseList {
    let derived: SelectionClauseList = [];
    // Results by input clause, so an active clause that is also in the list
    // is not mapped twice (a map that mints objects would otherwise split
    // the active clause from its list entry).
    const results = new Map<SelectionClause, SelectionClause | null>(options.known);
    for (const clause of clauses) {
      if (options.exclude?.has(clause.source)) {
        continue;
      }
      const mapped = results.has(clause) ? (results.get(clause) ?? null) : this.#map(clause);
      results.set(clause, mapped);
      if (mapped !== null) {
        derived = this._resolver.resolve(derived, mapped);
      }
    }
    const active = clauses.active;
    if (!options.keepActive || active === undefined) {
      return derived;
    }
    const mappedActive = results.has(active) ? (results.get(active) ?? null) : this.#map(active);
    if (mappedActive !== null) {
      derived.active = mappedActive;
    }
    return derived;
  }

  #carriesSource(clause: SelectionClause): boolean {
    return this._resolved.some((candidate) => candidate.source === clause.source);
  }

  /**
   * Install `next`, relay, then notify consumers the way upstream
   * `Selection.update`/`reset` do: `_resolved` is current before relaying
   * (a derived of this Selection reads it), and `Param.update` emits when
   * distinct, else cancels queued values.
   */
  #publish(next: SelectionClauseList, relay: (selection: Selection) => void): this {
    this._resolved = next;
    this._relay.forEach(relay);
    Param.prototype.update.call(this, next);
    return this;
  }

  /**
   * Adopt a content-equal list made of different clause objects: a snapshot
   * parent that replaced a source with a distinct object sharing its `id`, or
   * a clause whose `value`, `fields` or `meta` changed under the same
   * predicate SQL (a map reading external state, a snapshot that re-labels a
   * clause). `valueFor`, removal, reset and clause data then track the
   * parent's current clauses. Consumers' predicates are unchanged, so nothing
   * re-queries unless a queued emission would otherwise reinstate the old
   * objects.
   *
   * Adoption then propagates to mapped Selections derived from this one: a
   * silent adoption emits nothing for their `followParent` to hear, so
   * without it a nested derived would keep the old clauses, including a
   * predicate it derives from the adopted `value`, `meta` or source.
   */
  #adopt(next: SelectionClauseList): void {
    if (sameClauseObjects(this._resolved, next)) {
      return;
    }
    const active = this._resolved.active;
    if (next.active === undefined && active !== undefined) {
      next.active = next.find((clause) => sourceKey(clause) === sourceKey(active)) ?? active;
    }
    this._resolved = next;
    // `_callbacks` and its `queue` are upstream `Param`/`AsyncDispatch`
    // internals (`util/AsyncDispatch.ts`); re-check when bumping the Mosaic
    // peer range.
    const queued = this._callbacks.get('value')?.queue.isEmpty() === false;
    if (queued) {
      // Emitting replaces the queued value so it cannot reinstate the old
      // source objects. A `cross` resolver's queue compares sources by
      // identity, so it may keep the queued list as well and consumers then
      // re-query once more for identical SQL: redundant, not incorrect.
      this.emit('value', next);
    } else {
      // Nothing queued (an emission may be in flight): set the value
      // directly. It is content-equal to what consumers are handling.
      this._value = next;
    }
    this._relay.forEach((selection) => {
      if (selection instanceof MappedSelection && selection.#parent === this) {
        selection.#adoptFromParent();
      }
    });
  }

  /**
   * Follow the parent after it adopted new clause objects silently. A
   * content-equal re-derivation is adopted silently too. A content change is
   * published here, because the parent's silent adoption emits nothing this
   * Selection's `followParent` would hear: a map that reads the source
   * itself (not just its `id`), or the clause's `value`/`meta`, can derive a
   * different predicate, or drop the clause, for a clause that is
   * content-equal one level up.
   */
  #adoptFromParent(): void {
    const derived = this.#derive(this.#parent._resolved, { keepActive: true });
    if (sameClauseList(this._resolved, derived)) {
      this.#adopt(derived);
      return;
    }
    // Published like `refresh()`, without an active clause: nothing was
    // interacted with, and an active clause whose predicate changed under a
    // source the pre-aggregator already analyzed would reuse stale columns.
    delete derived.active;
    this._resolved = derived;
    this.emit('value', derived);
  }

  /**
   * Re-derive from the parent's resolved list and emit when the content
   * changed. Emits directly rather than via `Param.update`, whose
   * not-distinct branch would cancel any queued newer value.
   */
  sync(keepActive: boolean): void {
    const derived = this.#derive(this.#parent._resolved, { keepActive });
    // Only the clause list decides: an active clause the map dropped (or that
    // is foreign to the list) changes nothing a consumer can observe.
    if (sameClauseList(this._resolved, derived)) {
      this.#adopt(derived);
      return;
    }
    this._resolved = derived;
    this.emit('value', derived);
  }

  /** Follow a parent that emitted `'value'` without relaying through `update()`. */
  readonly followParent = (): void => {
    this.sync(true);
  };

  override update(clause: SelectionClause): this {
    const mapped = this.#map(clause);
    let published = mapped;
    if (published === null && this.#carriesSource(clause)) {
      // The map now drops a source the derived still carries: remove it.
      published = removalFor(clause);
    }
    if (published === null) {
      return this;
    }
    if (published.predicate == null && !this.#carriesSource(published)) {
      // Removing a source the derived never carried changes nothing.
      return this;
    }
    if (this.#parent._resolved.active !== clause) {
      // Published directly on the derived (not relayed): upstream semantics.
      return super.update(published);
    }
    // Relayed: the parent already holds `clause`, so derive the whole list
    // from it. This applies this Selection's resolver to the parent's list
    // exactly as a later snapshot follow would, so the two never disagree
    // (a `single` override falls back to the previous kept clause on removal).
    const next = this.#derive(this.#parent._resolved, {
      keepActive: false,
      known: new Map([[clause, mapped]]),
    });
    next.active = published;
    return this.#publish(next, (selection) => selection.update(published));
  }

  override activate(clause: SelectionClause): void {
    const mapped = this.#map(clause);
    if (mapped === null) {
      return;
    }
    super.activate(mapped);
  }

  override reset(clauses?: Array<SelectionClause>): this {
    if (clauses === undefined) {
      return super.reset();
    }
    // Relayed resets name the parent's clause objects; the derived holds
    // mapped objects, so match them by source. (Upstream's parent filters
    // by clause identity, so stale clause objects passed to `parent.reset`
    // leave the parent's clause in place while the derived drops it until
    // the next snapshot follow re-adds it: a caller bug, not handled here.)
    const sources = new Set(clauses.map((clause) => clause.source));
    const matched = this._resolved.filter((clause) => sources.has(clause.source));
    if (matched.length === 0) {
      return this;
    }
    // Typed non-null, but upstream builds bare `{ source }` clauses from
    // arbitrary values; reset defensively, as upstream `reset` does.
    matched.forEach((clause) => {
      const source = clause.source as SelectionClause['source'] | null | undefined;
      source?.reset?.();
    });
    // Re-derive the rest from the parent (as `update()` does) so a `single`
    // override keeps the parent's remaining last clause.
    const next = this.#derive(this.#parent._resolved, { keepActive: false, exclude: sources });
    return this.#publish(next, (selection) => selection.reset(matched));
  }
}

/**
 * Derive a Selection from `parent` whose clauses are `map(clause)` of the
 * parent's (`null` drops a clause). Pass the derived Selection to consumers
 * (as a client's `filterBy`, or `makeClient`'s `selection`); call `destroy()`
 * when they go away so the parent stops relaying into it.
 *
 * Contract for `map`:
 * - A mapped clause must keep the input's `source` identity: Mosaic resolves
 *   and removes clauses by source, and crossfilter, `reset` and removal
 *   tracking all key on it.
 * - A map that changes the predicate must keep `fields`/`meta` consistent
 *   with the new predicate, or drop `meta`: Mosaic's pre-aggregation
 *   optimizer derives its columns from `meta`/`fields`, not from the
 *   predicate.
 * - It receives removal clauses (a `null` predicate) too, and should pass
 *   them through unchanged unless it means to drop the source entirely.
 * - It may be called for every parent clause on each update (the derived
 *   list is re-derived from the parent's whole list), so keep it cheap.
 */
export function createMappedSelection(
  parent: Selection,
  map: SelectionClauseMap,
  options: MappedSelectionOptions = {},
): MappedSelectionHandle {
  const selection = new MappedSelection(parent, map, options.resolver ?? parent.resolver);
  attachIncludedSelection(parent, selection);
  parent.addEventListener('value', selection.followParent);
  let destroyed = false;
  return {
    selection,
    refresh: () => {
      if (destroyed) {
        return;
      }
      selection.sync(false);
    },
    destroy: () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      detachIncludedSelection(parent, selection);
      parent.removeEventListener('value', selection.followParent);
    },
  };
}
