/**
 * Filter persistence contract and lifecycle.
 *
 * A `Persister` is a consumer-owned storage adapter for filter *intent* — the
 * publish-side client state (facet selection, histogram range, rows tuples),
 * never the resolved SQL clauses. Clauses are derived; intent is what survives
 * a reload. There is no key in the contract: the consumer's `read`/`write`
 * closures already know where they point.
 *
 * The `PersisterLifecycle` helper below encapsulates the subtle parts shared by
 * every publishing client (facet, histogram, rows) so the logic is not
 * triplicated: non-blocking async hydration, the "user interaction wins over
 * stale async hydration" guard, and echo suppression (hydration is never
 * written back).
 */

export type PersisterWriteReason = 'update' | 'clear' | 'external';

export interface PersisterWriteContext {
  reason: PersisterWriteReason;
}

/**
 * Consumer-owned storage adapter. Persists filter *intent* (publish-side
 * client state), never clauses; no key in the contract — the consumer's
 * closures know where they point.
 */
export interface Persister<TState, TContext = unknown> {
  read: (
    context: TContext,
  ) => TState | null | undefined | Promise<TState | null | undefined>;
  write: (
    state: TState | null,
    context: TContext & PersisterWriteContext,
  ) => void;
}

/**
 * Internal (not exported from the package index) lifecycle wrapper around a
 * consumer `Persister`. One instance per publishing client.
 */
export class PersisterLifecycle<TState> {
  readonly #persister: Persister<TState>;
  readonly #isDestroyed: () => boolean;
  readonly #isEmpty: ((state: TState) => boolean) | undefined;
  #hydrating = false;
  #dirty = false;

  constructor(
    persister: Persister<TState>,
    isDestroyed: () => boolean,
    options?: {
      /**
       * Marks a read state as empty (e.g. a zero-length values array). Empty
       * states are skipped during hydration: the client's default state is
       * already empty, so replaying one would only publish a pointless clear
       * clause into the Selection.
       */
      isEmpty?: (state: TState) => boolean;
    },
  ) {
    this.#persister = persister;
    this.#isDestroyed = isDestroyed;
    this.#isEmpty = options?.isEmpty;
  }

  /**
   * Read persisted intent and replay it through `apply`. A synchronous
   * non-empty result is applied immediately, so a caller running this inside
   * `prepare` gets its first query already filtered — no flash, no extra query.
   *
   * A thenable does NOT block: it runs detached (this method still returns
   * synchronously, so `prepare` does not await it and the first query issues
   * unfiltered). On resolve the state is applied only if the client is still
   * alive and no write has happened since construction — user interaction wins
   * over stale async hydration. `null`/`undefined` (and `isEmpty`) results are
   * no-ops; emptiness is the caller's default state, so applying it would be
   * redundant.
   *
   * Persistence is best-effort throughout: a failed read *or* a rejected apply
   * (e.g. a stale payload no longer matching the client's configuration) warns
   * and leaves the default empty state in place — it must never reject the
   * prepare chain and kill the client.
   */
  hydrate(apply: (state: TState) => void): void {
    const result = this.#persister.read(undefined);
    if (isThenable(result)) {
      void result
        .then((state) => {
          if (this.#isDestroyed() || this.#dirty) {
            return;
          }
          this.#applyGuarded(state, apply);
        })
        .catch((error: unknown) => {
          warnHydrationFailed(error);
        });
      return;
    }
    try {
      this.#applyGuarded(result, apply);
    } catch (error) {
      warnHydrationFailed(error);
    }
  }

  /**
   * Persist the given intent. No-op while hydrating (hydration is replayed
   * through the same publish path as user interaction, and must never be
   * written back). Any real write marks the lifecycle dirty, which cancels a
   * still-pending async hydration.
   */
  write(state: TState | null, reason: PersisterWriteReason): void {
    if (this.#hydrating) {
      return;
    }
    this.#dirty = true;
    this.#persister.write(state, { reason });
  }

  #applyGuarded(
    state: TState | null | undefined,
    apply: (state: TState) => void,
  ): void {
    if (state == null) {
      return;
    }
    if (this.#isEmpty !== undefined && this.#isEmpty(state)) {
      return;
    }
    this.#hydrating = true;
    try {
      apply(state);
    } finally {
      this.#hydrating = false;
    }
  }
}

function warnHydrationFailed(error: unknown): void {
  console.warn(
    '[mosaic-core] Persisted filter state could not be hydrated and was ' +
      'ignored — the stored payload may be stale or no longer match the ' +
      "client's configuration.",
    error,
  );
}

function isThenable(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
