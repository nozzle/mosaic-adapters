/**
 * {@link SelectionBatch}: the deferred-emit engine behind the opt-in
 * `filterSet.batch()` / `topology.batch()`.
 *
 * Upstream `Selection.update(clause)` does three things: it resolves the clause
 * into `_resolved`, relays the clause to every derived Selection in `_relay`,
 * and emits a `value` event (`super.update(_resolved)`), which makes the
 * coordinator re-query every client filtered by that Selection. A batch keeps
 * the first two steps — so `_resolved` (which FilterSet and the topology read)
 * is always current — and defers the third: at {@link SelectionBatch.flush}
 * every touched Selection emits exactly once.
 *
 * **Stale pre-aggregation.** Mosaic's PreAggregator keeps one materialized view
 * per client for as long as the *active* clause source stays the same; the
 * view bakes in the values every *other* clause had when it was built. An
 * unbatched update only ever changes the active clause, so that is safe. A
 * batched emission can change several clauses at once, so emitting it with one
 * of them as the active clause could answer from a view built on the old
 * values of the others. Every batched emission therefore carries a fresh
 * *activation clause* instead: a never-seen source (so the PreAggregator drops
 * its cache) with a `null` predicate (so it cannot build a new view and falls
 * back to the standard query path). The clause list itself is untouched, and
 * the activation clause carries no `clients`, so crossfilter resolution still
 * excludes each client's own clauses — it just no longer skips the publishing
 * client outright.
 *
 * **Relays.** Plain derived Selections (compose and cascading contexts,
 * upstream `include`) are updated through the same deferred path, so each gets
 * one combined emission. A skip projection is updated through it too, with
 * its own skip filter applied, so the projection's derived Selections are
 * reached and the projection emits once (its `followParent` listener then
 * finds nothing left to change). Any other Selection subclass that overrides
 * `update` / `reset` — including a Selection from the public
 * `createMappedSelection` — cannot be emulated, so it receives the plain
 * upstream call (it emits immediately, as it would without a batch).
 *
 * **Members.** Participants (FilterSets, a topology) join a batch as
 * {@link BatchMember}s; whoever opened the batch closes it with
 * {@link SelectionBatch.close}. Before the flush every member *settles*
 * (FilterSets rebuild context-dependent specs). Settling repeats until a full
 * round writes nothing, so a chain of FilterSets whose contexts read each
 * other's targets (A's context is B's target, B's context is C's target)
 * converges inside the batch whatever order the members joined in.
 *
 * **One open batch at a time.** {@link openSelectionBatch} throws while
 * another batch is open. Callers flatten the nesting they can prove safe (a
 * FilterSet already writing into the open batch, a topology whose own batch
 * is open) by running the callback inside the open batch instead of opening
 * a new one; every other nesting is rejected, because two batches sharing
 * Selections or contexts cannot both emit "once, with the final state". A
 * batch counts as open until it has emitted — including while its members
 * settle and while it flushes — so code those steps run (filter kinds,
 * `value` listeners) cannot open a batch either.
 */
import { Param, Selection, distinct } from '@uwdata/mosaic-core';
import type { ClauseSource, SelectionClause } from '@uwdata/mosaic-core';

import { getSkipProjectionSkip, isSkippedClause } from './skip-projection';

type SelectionClauseArray = Selection['clauses'];

/** Per-Selection bookkeeping for one batch. */
interface BatchEntry {
  /**
   * `value` of the most recent clause written to this Selection in the batch,
   * or `undefined` after a reset. Carried on the activation clause so
   * `selection.value` still reports the latest written value.
   */
  lastValue: unknown;
}

/** What {@link SelectionBatch.flush} did. */
export interface BatchFlushResult {
  /**
   * Selections whose combined emission Mosaic queued behind an earlier
   * emission that was still being dispatched, mapped to the emitted clause
   * array. Their `value` listeners run later, when the dispatch queue drains;
   * a listener sees the batched emission when `selection.clauses` is that
   * array.
   */
  readonly queued: ReadonlyMap<Selection, SelectionClauseArray>;
}

/**
 * One participant in a batch (a FilterSet, or a topology), driven by
 * {@link SelectionBatch.close}. Internal.
 */
export interface BatchMember {
  /** Last in-batch work before the flush (e.g. FilterSet context rebuilds). */
  settle: () => void;
  /** Stop routing writes into the batch; later writes apply immediately. */
  detach: () => void;
  /** Post-flush bookkeeping (one store sync, one persist write, one refresh). */
  commit: (result: BatchFlushResult) => void;
}

const EMPTY_FLUSH_RESULT: BatchFlushResult = { queued: new Map() };

/**
 * Thrown by {@link openSelectionBatch} while another batch is open. Public
 * callers see it from `filterSet.batch()` / `topology.batch()`.
 */
export const NESTED_BATCH_ERROR_MESSAGE =
  '[mosaic-core] Cannot open a batch while another batch is open. A nested ' +
  'filterSet.batch() or topology.batch() call only joins the open batch when ' +
  'that batch already covers it (the same FilterSet, a FilterSet owned by the ' +
  'topology whose batch is open, or the same topology). To combine writes to ' +
  'several FilterSets, open one topology.batch() that owns all of them.';

/** The batch opened by {@link openSelectionBatch} and not yet closed. */
let activeBatch: SelectionBatch | null = null;

/**
 * Opens a batch, registering it as the one open batch until its
 * {@link SelectionBatch.close}.
 *
 * @throws when another batch is open (see {@link NESTED_BATCH_ERROR_MESSAGE}).
 */
export function openSelectionBatch(): SelectionBatch {
  if (activeBatch !== null) {
    throw new Error(NESTED_BATCH_ERROR_MESSAGE);
  }
  const batch = new SelectionBatch();
  activeBatch = batch;
  return batch;
}

/**
 * True when `selection` uses upstream's own `update` / `reset`, so the batch
 * can reproduce them exactly (minus the emit). A subclass that overrides
 * either — or a Selection from a different copy of `@uwdata/mosaic-core` —
 * is not deferrable.
 */
function isDeferrable(selection: Selection): boolean {
  return (
    selection.update === Selection.prototype.update && selection.reset === Selection.prototype.reset
  );
}

/**
 * Builds the activation clause a batched emission carries as its `active`
 * clause. See the module docs: the fresh source clears the PreAggregator's
 * cached view; the `null` predicate forces the standard query path.
 */
function createActivationClause(value: unknown): SelectionClause {
  const source: ClauseSource = {};
  return {
    source,
    value,
    predicate: null,
    fields: [],
  };
}

/**
 * Collects Selection writes and emits once per touched Selection on
 * {@link SelectionBatch.flush}. Internal: consumers reach it through
 * `filterSet.batch()` and `topology.batch()`, which open it with
 * {@link openSelectionBatch}.
 */
export class SelectionBatch {
  /** Touched Selections in first-touch order. */
  readonly #entries = new Map<Selection, BatchEntry>();
  readonly #members: Array<BatchMember> = [];
  /** Writes routed through the batch before the flush; drives settling. */
  #writes = 0;
  #flushed = false;
  #closed = false;

  /** Adds a participant that {@link SelectionBatch.close} settles, detaches and commits. */
  join(member: BatchMember): void {
    this.#members.push(member);
  }

  /**
   * Upstream `selection.update(clause)` without the emit: resolves the clause
   * into `_resolved` now and relays it to derived Selections. Falls back to a
   * plain `update` (immediate emit) for a Selection the batch cannot emulate,
   * or once the batch has flushed.
   */
  update(selection: Selection, clause: SelectionClause): void {
    if (this.#flushed) {
      selection.update(clause);
      return;
    }
    this.#writes += 1;
    const skip = getSkipProjectionSkip(selection);
    if (skip === null && !isDeferrable(selection)) {
      selection.update(clause);
      return;
    }
    if (skip !== null && isSkippedClause(clause, skip)) {
      // What the projection's own `update` does: drop the skipped source.
      return;
    }
    // Upstream `update` resets the sources of clauses it displaces; a skip
    // projection (a mapped Selection) never does: its parent owns them.
    const resolved: SelectionClauseArray = selection._resolver.resolve(
      selection._resolved,
      clause,
      skip === null,
    );
    resolved.active = clause;
    selection._resolved = resolved;
    this.#touch(selection, clause.value);
    for (const relay of selection._relay) {
      this.update(relay, clause);
    }
  }

  /**
   * Upstream `selection.reset(clauses)` without the emit: invokes each removed
   * clause source's `reset()`, drops the clauses from `_resolved`, and relays
   * the reset to derived Selections. A skip projection ignores the skipped
   * clauses of an explicit list, as its own `reset` does.
   */
  reset(selection: Selection, clauses?: Array<SelectionClause>): void {
    if (this.#flushed) {
      selection.reset(clauses);
      return;
    }
    this.#writes += 1;
    const skip = getSkipProjectionSkip(selection);
    if (skip === null && !isDeferrable(selection)) {
      selection.reset(clauses);
      return;
    }
    const requested =
      skip !== null && clauses !== undefined
        ? clauses.filter((clause) => !isSkippedClause(clause, skip))
        : clauses;
    const removed = requested ?? selection._resolved;
    for (const clause of removed) {
      // Typed as required, but upstream `reset` tolerates a hand-built clause
      // without a source (`c.source?.reset?.()`); match it.
      const loose: Partial<SelectionClause> = clause;
      loose.source?.reset?.();
    }
    selection._resolved = selection._resolved.filter((clause) => !removed.includes(clause));
    this.#touch(selection, undefined);
    for (const relay of selection._relay) {
      this.reset(relay, removed);
    }
  }

  /**
   * Emits one `value` event per touched Selection, each carrying a fresh
   * activation clause. Later writes through this batch apply immediately. A
   * listener that throws does not stop the remaining emissions; the first
   * error is rethrown once every Selection has emitted.
   */
  flush(): BatchFlushResult {
    if (this.#flushed) {
      return EMPTY_FLUSH_RESULT;
    }
    this.#flushed = true;
    const entries = [...this.#entries];
    this.#entries.clear();
    const queued = new Map<Selection, SelectionClauseArray>();
    runAll(
      entries.map(([selection, entry]) => () => {
        const pending = emitBatched(selection, entry);
        if (pending !== null) {
          queued.set(selection, pending);
        }
      }),
    );
    return { queued };
  }

  /**
   * Ends the batch: every member settles (repeatedly, until a round writes
   * nothing), then detaches, then the batch emits once per touched Selection,
   * then every member commits. Every step runs even when one throws; the
   * first error is rethrown at the end. A no-op once closed.
   *
   * The batch stays registered as the open batch until it has emitted, so a
   * filter kind (run while members settle) or a `value` listener (run while
   * the batch flushes) cannot open another batch: that batch would flush
   * first and emit shared Selections with this batch's unsettled state. The
   * registration is released before the commits, on every path.
   */
  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    const members = [...this.#members];
    let result = EMPTY_FLUSH_RESULT;
    try {
      runAll([
        () => {
          this.#settle(members);
        },
        ...members.map((member) => member.detach),
        () => {
          result = this.flush();
        },
        () => {
          this.#release();
        },
        ...members.map((member) => () => {
          member.commit(result);
        }),
      ]);
    } finally {
      // `runAll` runs the release step even when an earlier step throws;
      // this only guards a throw outside the steps, so the registration can
      // never leak and block every later batch.
      this.#release();
    }
  }

  /** Unregisters this batch as the open one, so a new batch can open. */
  #release(): void {
    if (activeBatch !== this) {
      return;
    }
    activeBatch = null;
  }

  /**
   * Settles every member until a full round routes no write through the
   * batch. One member's settle can change a Selection another member reads as
   * its context, and members settle in join order, not dependency order; each
   * round settles at least one more link of an acyclic context chain, so
   * `members.length + 1` rounds always reach the fixed point. A cyclic context
   * graph stops there and is left to the usual post-emit context rebuild.
   */
  #settle(members: ReadonlyArray<BatchMember>): void {
    for (let round = 0; round <= members.length; round += 1) {
      const before = this.#writes;
      runAll(members.map((member) => member.settle));
      if (this.#writes === before) {
        return;
      }
    }
  }

  #touch(selection: Selection, lastValue: unknown): void {
    const entry = this.#entries.get(selection);
    if (entry !== undefined) {
      entry.lastValue = lastValue;
      return;
    }
    this.#entries.set(selection, { lastValue });
  }
}

/**
 * Runs `fn`, then closes `batch`. When `fn` throws, its error is the one that
 * propagates, even if closing the batch (a listener) throws as well; the
 * batch is closed either way.
 */
export function runInBatch(batch: SelectionBatch, fn: () => void): void {
  let failure: { error: unknown } | undefined;
  try {
    fn();
  } catch (error) {
    failure = { error };
  }
  try {
    batch.close();
  } catch (closeError) {
    if (failure === undefined) {
      throw closeError;
    }
  }
  if (failure !== undefined) {
    throw failure.error;
  }
}

/**
 * Emits a Selection's deferred state the way upstream `Selection.update` ends
 * — `Param#update(resolved)`, which skips the emit (and drops queued values)
 * when the clause list is unchanged since the last emission — but with an
 * activation clause as `active`. The emitted array is a copy, so an array an
 * earlier emission already handed out is never mutated.
 *
 * @returns the emitted array when Mosaic queued the emission behind a
 *   still-dispatching one; `null` when it was dispatched now or not emitted.
 */
function emitBatched(selection: Selection, entry: BatchEntry): SelectionClauseArray | null {
  const emitted: SelectionClauseArray = [...selection._resolved];
  emitted.active = createActivationClause(entry.lastValue);
  selection._resolved = emitted;
  const willEmit = distinct(selection.clauses, emitted);
  Param.prototype.update.call(selection, emitted);
  if (!willEmit || selection.clauses === emitted) {
    return null;
  }
  return emitted;
}

/**
 * Runs every step even when one throws, then rethrows the first error. Batch
 * teardown must never leave a member attached or a Selection unflushed.
 */
function runAll(steps: ReadonlyArray<() => void>): void {
  let failure: { error: unknown } | undefined;
  for (const step of steps) {
    try {
      step();
    } catch (error) {
      failure ??= { error };
    }
  }
  if (failure !== undefined) {
    throw failure.error;
  }
}
