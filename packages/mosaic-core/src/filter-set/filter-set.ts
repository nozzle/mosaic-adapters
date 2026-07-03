/**
 * {@link createFilterSet}: a page-level object owning a set of dashboard filter
 * intents ({@link FilterSpec}s), each resolved by a {@link FilterKind} into one
 * Selection clause per routing target.
 *
 * Design notes (the load-bearing invariants):
 *
 * - **One clause per (spec, target).** The clause source is stable per
 *   `(spec.id, target)` and carries `{ id, column, target }` so downstream
 *   consumers (chip bars) can label it. Replacing a spec reuses its sources, so
 *   the Selection replaces the clause instead of accumulating one per publish.
 *
 * - **Own clears must not trip the external-clear listener.** The `#active`
 *   bookkeeping is updated BEFORE `selection.update`, and every own-update loop
 *   is fenced with `#publishing` so the `value` listener can distinguish an
 *   external drop (chip bar, global reset) from our own publish.
 *
 * - **Subquery emissions never carry `meta`** — they are published through
 *   `createSubqueryClause`, which structurally forbids `meta`.
 *
 * - **Publish suppression** goes through `updateClauseIfChanged` (predicate-SQL
 *   comparison), EXCEPT when the spec's `clients` association changed: then the
 *   update bypasses suppression so the new clients set lands on the Selection.
 *
 * - **Persistence** is whole-set-as-one-entry via {@link PersisterLifecycle}.
 *   Hydration writes zero persister writes and runs synchronously before
 *   `createFilterSet` returns; `destroy()` never writes.
 */
import { Store } from '@tanstack/store';
import { and } from '@uwdata/mosaic-sql';
import {
  createClearClause,
  createSubqueryClause,
  createValueClause,
  updateClauseIfChanged,
} from '../clause-factory';
import { PersisterLifecycle } from '../persistence';
import { SqlIdentifier, createStructAccess } from '../sql-access';
import { formatFilterValue } from './format';
import { builtinFilterKinds } from './kinds';
import type {
  ClauseSource,
  MosaicClient,
  Selection,
  SelectionClause,
} from '@uwdata/mosaic-core';
import type { ExprNode } from '@uwdata/mosaic-sql';
import type { PersisterWriteReason } from '../persistence';
import type {
  FilterKind,
  FilterKindArgs,
  FilterSet,
  FilterSetChip,
  FilterSetOptions,
  FilterSetSetOptions,
  FilterSetState,
  FilterSpec,
} from './types';

/** A clause source descriptor stable per `(spec.id, target)`. */
interface FilterSetSource extends ClauseSource {
  id: string;
  column: string;
  target: string;
}

/** A multi-column points envelope, mirrored from kinds.ts for chip explosion. */
interface PointsTupleEnvelope {
  columns: Array<string>;
  tuples: Array<Array<unknown>>;
}

function isPointsTupleEnvelope(value: unknown): value is PointsTupleEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as PointsTupleEnvelope).columns) &&
    Array.isArray((value as PointsTupleEnvelope).tuples)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Validates a persisted spec's required string fields (untrusted input). */
function isValidSpec(value: unknown): value is FilterSpec {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    isNonEmptyString(record.id) &&
    isNonEmptyString(record.column) &&
    isNonEmptyString(record.kind)
  );
}

/**
 * Creates a page-level filter set. Hydrates any persisted specs synchronously
 * before returning (a synchronous persister read applies immediately).
 */
export function createFilterSet(options: FilterSetOptions): FilterSet {
  return new FilterSetImpl(options);
}

class FilterSetImpl implements FilterSet {
  readonly store: Store<FilterSetState>;

  readonly #targets: Record<string, Selection>;
  readonly #kinds: Record<string, FilterKind>;
  readonly #context: Selection | undefined;

  /** Insertion-ordered specs (Map preserves insertion order). */
  readonly #specs = new Map<string, FilterSpec>();
  /** Session-bound self-exclusion clients, keyed by spec id. Never persisted. */
  readonly #clients = new Map<string, Set<MosaicClient>>();
  /** Stable clause sources keyed `${id} ${target}`. */
  readonly #sources = new Map<string, FilterSetSource>();
  /** Spec id → target names with a currently-published (non-clear) clause. */
  readonly #active = new Map<string, Set<string>>();
  /** Clients set identity last published per spec id (clients-change detection). */
  readonly #publishedClients = new Map<string, Set<MosaicClient> | undefined>();
  /** Spec ids whose kind read `contextPredicate` on its last emit. */
  readonly #contextDependent = new Set<string>();
  /** Target-name-warned-once bookkeeping (dev warnings). */
  readonly #warnedTargets = new Set<string>();

  readonly #persist: PersisterLifecycle<Array<FilterSpec>> | null;

  /** Guards the external-clear + context listeners against own updates. */
  #publishing = false;
  /** Version counter for the microtask-debounced context rebuild. */
  #contextVersion = 0;
  #warnedHaving = false;
  #destroyed = false;

  /** Detachers for every Selection listener wired at construction. */
  readonly #detachers: Array<() => void> = [];

  constructor(options: FilterSetOptions) {
    this.#targets = options.targets;
    this.#kinds = { ...builtinFilterKinds, ...options.kinds };
    this.#context = options.context;
    this.store = new Store<FilterSetState>({ specs: [], chips: [] });

    this.#persist = options.persist
      ? new PersisterLifecycle(options.persist, () => this.#destroyed, {
          isEmpty: (specs) => specs.length === 0,
        })
      : null;

    this.#wireExternalClear();
    this.#wireContextRebuild();
    this.#hydrate();
  }

  get destroyed(): boolean {
    return this.#destroyed;
  }

  set(spec: FilterSpec, options?: FilterSetSetOptions): void {
    if (this.#destroyed) {
      return;
    }
    if (this.#kinds[spec.kind] === undefined) {
      const registered = Object.keys(this.#kinds).join(', ');
      throw new Error(
        `[mosaic-core] FilterSet.set received an unknown kind '${spec.kind}'. ` +
          `Registered kinds: ${registered}.`,
      );
    }

    // Store the object as given (plain data), treated as immutable. Replacing
    // an existing id keeps its Map insertion position.
    this.#specs.set(spec.id, spec);
    if (options?.clients !== undefined) {
      this.#clients.set(spec.id, options.clients);
    }

    this.#publishSpec(spec);
    this.#syncStore();
    this.#persistWrite('update');
  }

  remove(id: string): void {
    if (this.#destroyed || !this.#specs.has(id)) {
      return;
    }
    this.#clearSpecClauses(id);
    this.#specs.delete(id);
    this.#clients.delete(id);
    this.#contextDependent.delete(id);
    this.#publishedClients.delete(id);
    this.#syncStore();
    if (this.#specs.size === 0) {
      this.#persistWrite('clear');
      return;
    }
    this.#persistWrite('update');
  }

  clear(id: string): void {
    if (this.#destroyed) {
      return;
    }
    const spec = this.#specs.get(id);
    if (spec === undefined) {
      return;
    }
    const cleared: FilterSpec = {
      ...spec,
      operator: undefined,
      value: undefined,
      valueTo: undefined,
    };
    this.#specs.set(id, cleared);
    // The kind now emits an inactive spec → its clauses are cleared.
    this.#publishSpec(cleared);
    this.#syncStore();
    this.#persistWrite('update');
  }

  reset(): void {
    if (this.#destroyed) {
      return;
    }
    this.#publishing = true;
    try {
      for (const id of this.#specs.keys()) {
        this.#clearSpecClauses(id);
      }
    } finally {
      this.#publishing = false;
    }
    this.#specs.clear();
    this.#clients.clear();
    this.#contextDependent.clear();
    this.#publishedClients.clear();
    this.#syncStore();
    this.#persistWrite('clear');
  }

  removeChip(chip: FilterSetChip): void {
    if (this.#destroyed) {
      return;
    }
    const spec = this.#specs.get(chip.id);
    if (spec === undefined) {
      return;
    }
    if (!chip.exploded) {
      this.remove(chip.id);
      return;
    }

    if (isPointsTupleEnvelope(spec.value)) {
      const remaining = spec.value.tuples.filter(
        (tuple) => tuple !== chip.value,
      );
      if (remaining.length === 0) {
        this.remove(chip.id);
        return;
      }
      this.set(
        { ...spec, value: { columns: spec.value.columns, tuples: remaining } },
        this.#setOptionsFor(chip.id),
      );
      return;
    }

    if (Array.isArray(spec.value)) {
      const remaining = spec.value.filter((item) => item !== chip.value);
      if (remaining.length === 0) {
        this.remove(chip.id);
        return;
      }
      this.set({ ...spec, value: remaining }, this.#setOptionsFor(chip.id));
      return;
    }

    this.remove(chip.id);
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    // Clear published clauses without ever writing to the persister — a
    // StrictMode unmount must not wipe the consumer's storage.
    this.#publishing = true;
    try {
      for (const id of this.#specs.keys()) {
        this.#clearSpecClauses(id);
      }
    } finally {
      this.#publishing = false;
    }
    for (const detach of this.#detachers) {
      detach();
    }
    this.#detachers.length = 0;
  }

  /** Reconstructs the {@link FilterSetSetOptions} carrying a spec's clients. */
  #setOptionsFor(id: string): FilterSetSetOptions | undefined {
    const clients = this.#clients.get(id);
    return clients === undefined ? undefined : { clients };
  }

  /** Returns (creating if needed) the stable source for `(id, target)`. */
  #sourceFor(id: string, column: string, target: string): FilterSetSource {
    const key = `${id} ${target}`;
    const existing = this.#sources.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const source: FilterSetSource = { id, column, target };
    this.#sources.set(key, source);
    return source;
  }

  #resolveTarget(name: string | undefined, spec: FilterSpec): string {
    return name ?? spec.target ?? 'where';
  }

  /**
   * Resolves a spec's emissions and publishes/clears its per-target clauses.
   * Recomputes the spec's context-dependent flag from whether this emit read
   * `contextPredicate`.
   */
  #publishSpec(spec: FilterSpec): void {
    const kind = this.#kinds[spec.kind];
    if (kind === undefined) {
      return;
    }

    const columnExpr = createStructAccess(SqlIdentifier.from(spec.column));
    // Tracked through a cell so the getter's mutation is opaque to the type
    // narrower (ESLint would otherwise treat the flag as never reassigned).
    const contextRead = { value: false };
    const self = this;
    const args: FilterKindArgs = {
      spec,
      column: columnExpr,
      get contextPredicate(): ExprNode | null {
        contextRead.value = true;
        return self.#computeContextPredicate(spec.id);
      },
    };

    const emissions = kind.emit(args);

    if (contextRead.value) {
      this.#contextDependent.add(spec.id);
    } else {
      this.#contextDependent.delete(spec.id);
    }

    // Group emissions by resolved target; last emission to a target wins
    // (preserves the one-clause-per-source invariant).
    const byTarget = new Map<
      string,
      {
        predicate: ExprNode | null;
        value: unknown;
        meta: SelectionClause['meta'] | undefined;
      }
    >();
    for (const emission of emissions) {
      const target = this.#resolveTarget(emission.target, spec);
      if (this.#targets[target] === undefined) {
        this.#warnUnknownTarget(target);
        continue;
      }
      this.#warnHavingIfNeeded(target);
      byTarget.set(target, {
        predicate: emission.clause.predicate,
        value: emission.clause.value ?? spec.value ?? null,
        meta: emission.clause.meta,
      });
    }

    const clients = this.#clients.get(spec.id);
    const clientsChanged = this.#publishedClients.get(spec.id) !== clients;
    const active = this.#active.get(spec.id) ?? new Set<string>();

    this.#publishing = true;
    try {
      // Publish or clear each emitted target.
      for (const [target, resolved] of byTarget) {
        const targetSel = this.#targets[target];
        if (targetSel === undefined) {
          continue;
        }
        const source = this.#sourceFor(spec.id, spec.column, target);

        if (resolved.predicate === null) {
          if (active.has(target)) {
            active.delete(target);
            updateClauseIfChanged(
              targetSel,
              createClearClause(source, clients),
            );
          }
          continue;
        }

        const clause: SelectionClause =
          resolved.meta !== undefined
            ? createValueClause({
                source,
                clients,
                value: resolved.value,
                predicate: resolved.predicate,
                meta: resolved.meta,
              })
            : createSubqueryClause({
                source,
                clients,
                value: resolved.value,
                predicate: resolved.predicate,
              });

        // Mark active BEFORE the update so the external-clear listener never
        // reads this as an external drop.
        active.add(target);
        if (clientsChanged) {
          // Suppression compares predicates only; bypass it so a new clients
          // set actually lands on the Selection.
          targetSel.update(clause);
        } else {
          updateClauseIfChanged(targetSel, clause);
        }
      }

      // Clear targets previously active but not emitted this round.
      for (const target of [...active]) {
        if (byTarget.has(target)) {
          continue;
        }
        const targetSel = this.#targets[target];
        if (targetSel === undefined) {
          active.delete(target);
          continue;
        }
        const source = this.#sourceFor(spec.id, spec.column, target);
        active.delete(target);
        updateClauseIfChanged(targetSel, createClearClause(source, clients));
      }
    } finally {
      this.#publishing = false;
    }

    if (active.size > 0) {
      this.#active.set(spec.id, active);
    } else {
      this.#active.delete(spec.id);
    }
    this.#publishedClients.set(spec.id, clients);
  }

  /** Publishes clear clauses for every currently-active target of a spec. */
  #clearSpecClauses(id: string): void {
    const active = this.#active.get(id);
    if (active === undefined || active.size === 0) {
      this.#active.delete(id);
      return;
    }
    const clients = this.#clients.get(id);
    const wasPublishing = this.#publishing;
    this.#publishing = true;
    try {
      for (const target of [...active]) {
        const targetSel = this.#targets[target];
        if (targetSel === undefined) {
          continue;
        }
        const source = this.#sources.get(`${id} ${target}`);
        if (source === undefined) {
          continue;
        }
        active.delete(target);
        updateClauseIfChanged(targetSel, createClearClause(source, clients));
      }
    } finally {
      this.#publishing = wasPublishing;
    }
    this.#active.delete(id);
  }

  /**
   * AND of the context Selection's resolved clause predicates, excluding any
   * clause sourced by this spec's own sources. `null` when no context / no
   * active sibling clauses (single clause → the predicate itself).
   */
  #computeContextPredicate(id: string): ExprNode | null {
    if (this.#context === undefined) {
      return null;
    }
    const ownSources = new Set<ClauseSource>();
    for (const [key, source] of this.#sources) {
      if (key.startsWith(`${id} `)) {
        ownSources.add(source);
      }
    }
    const predicates = this.#context._resolved
      .filter((clause) => !ownSources.has(clause.source))
      .map((clause) => clause.predicate)
      .filter((predicate): predicate is ExprNode => predicate != null);

    if (predicates.length === 0) {
      return null;
    }
    if (predicates.length === 1) {
      return predicates[0] ?? null;
    }
    return and(...predicates);
  }

  #warnUnknownTarget(target: string): void {
    if (this.#warnedTargets.has(target)) {
      return;
    }
    this.#warnedTargets.add(target);
    console.warn(
      `[mosaic-core] FilterSet emission addressed an unknown target ` +
        `'${target}'; no such Selection is registered and the emission was ` +
        `skipped.`,
    );
  }

  #warnHavingIfNeeded(target: string): void {
    if (target !== 'having' || this.#warnedHaving) {
      return;
    }
    this.#warnedHaving = true;
    console.warn(
      "[mosaic-core] FilterSet published a 'having'-targeted clause; ensure " +
        'consumers wire that Selection via havingBy — filterBy would apply it ' +
        'in WHERE position.',
    );
  }

  /**
   * Attaches a `value` listener per distinct target Selection that mirrors an
   * external clause drop (chip bar, global reset) into spec removal. Own
   * updates never trip it because `#active` is updated before our own
   * `selection.update` and the body is fenced by `#publishing`.
   */
  #wireExternalClear(): void {
    const seen = new Set<Selection>();
    for (const targetSel of Object.values(this.#targets)) {
      if (seen.has(targetSel)) {
        continue;
      }
      seen.add(targetSel);
      const listener = (): void => {
        this.#onTargetValue(targetSel);
      };
      targetSel.addEventListener('value', listener);
      this.#detachers.push(() =>
        targetSel.removeEventListener('value', listener),
      );
    }
  }

  #onTargetValue(targetSel: Selection): void {
    if (this.#destroyed || this.#publishing) {
      return;
    }
    const present = new Set<ClauseSource>(
      targetSel._resolved.map((clause) => clause.source),
    );
    const clearedIds: Array<string> = [];

    for (const [id, active] of this.#active) {
      let externallyCleared = false;
      for (const target of active) {
        if (this.#targets[target] !== targetSel) {
          continue;
        }
        const source = this.#sources.get(`${id} ${target}`);
        if (source !== undefined && !present.has(source)) {
          externallyCleared = true;
          break;
        }
      }
      if (externallyCleared) {
        clearedIds.push(id);
      }
    }

    if (clearedIds.length === 0) {
      return;
    }

    // The intent was dismissed: clear any still-active sibling targets too,
    // then drop the spec. One store sync + one persist write for the batch.
    for (const id of clearedIds) {
      this.#clearSpecClauses(id);
      this.#specs.delete(id);
      this.#clients.delete(id);
      this.#contextDependent.delete(id);
      this.#publishedClients.delete(id);
    }
    this.#syncStore();
    this.#persistWrite('external');
  }

  /**
   * Rebuilds context-dependent specs when the context Selection changes,
   * using the microtask-debounce + version-counter pattern. Convergence is
   * provided by `updateClauseIfChanged` (an unchanged predicate publishes
   * nothing), so this cannot loop.
   */
  #wireContextRebuild(): void {
    const context = this.#context;
    if (context === undefined) {
      return;
    }
    const listener = (): void => {
      const version = ++this.#contextVersion;
      queueMicrotask(() => {
        if (this.#destroyed || version !== this.#contextVersion) {
          return;
        }
        this.#rebuildContextDependent();
      });
    };
    context.addEventListener('value', listener);
    this.#detachers.push(() => context.removeEventListener('value', listener));
  }

  #rebuildContextDependent(): void {
    if (this.#contextDependent.size === 0) {
      return;
    }
    // Re-publish each context-dependent spec. No store sync (specs unchanged),
    // no persist write. `#publishSpec` fences its own updates with
    // `#publishing`, so the external-clear listener is not tripped.
    for (const id of [...this.#contextDependent]) {
      const spec = this.#specs.get(id);
      if (spec !== undefined) {
        this.#publishSpec(spec);
      }
    }
  }

  /** Reads persisted specs and replays each valid one through `set`. */
  #hydrate(): void {
    if (this.#persist === null) {
      return;
    }
    this.#persist.hydrate((specs) => {
      // Persisted specs are untrusted data. Guard the container itself, then
      // replay each spec resiliently: a single bad entry (invalid shape, or a
      // kind no longer registered — `set()` throws on unknown kinds) must not
      // abort the whole batch, so each replay is validated and try/caught.
      if (!Array.isArray(specs)) {
        console.warn(
          '[mosaic-core] FilterSet ignored a persisted state that was not an ' +
            'array of specs.',
          specs,
        );
        return;
      }
      for (const candidate of specs as ReadonlyArray<unknown>) {
        if (!isValidSpec(candidate)) {
          console.warn(
            '[mosaic-core] FilterSet skipped a persisted spec missing a ' +
              'non-empty id/column/kind.',
            candidate,
          );
          continue;
        }
        try {
          this.set(candidate);
        } catch (error) {
          console.warn(
            '[mosaic-core] FilterSet skipped a persisted spec that failed to ' +
              'replay (e.g. an unregistered kind); continuing with the rest.',
            error,
          );
        }
      }
    });
  }

  #persistWrite(reason: PersisterWriteReason): void {
    if (this.#persist === null) {
      return;
    }
    // 'clear' always writes null; other reasons write null once the set is
    // empty (mirrors facet's empty→clear convention), else the spec array.
    if (reason === 'clear' || this.#specs.size === 0) {
      this.#persist.write(null, reason);
      return;
    }
    this.#persist.write([...this.#specs.values()], reason);
  }

  /** Derives the specs + chips arrays and pushes them onto the store. */
  #syncStore(): void {
    const specs = [...this.#specs.values()];
    const chips: Array<FilterSetChip> = [];
    for (const spec of specs) {
      this.#collectChips(chips, spec);
    }
    this.store.setState(() => ({ specs, chips }));
  }

  #collectChips(chips: Array<FilterSetChip>, spec: FilterSpec): void {
    const kind = this.#kinds[spec.kind];
    const label = spec.label ?? spec.column;
    const format = (value: unknown): string => {
      if (kind?.formatValue !== undefined) {
        return kind.formatValue(spec);
      }
      return formatFilterValue(value);
    };

    if (kind?.explodeValues === true && isPointsTupleEnvelope(spec.value)) {
      spec.value.tuples.forEach((tuple, index) => {
        chips.push({
          key: `${spec.id}:${index}`,
          id: spec.id,
          label,
          value: tuple,
          formattedValue: tuple.map((v) => formatFilterValue(v)).join(', '),
          exploded: true,
        });
      });
      return;
    }

    if (kind?.explodeValues === true && Array.isArray(spec.value)) {
      spec.value.forEach((element, index) => {
        chips.push({
          key: `${spec.id}:${index}`,
          id: spec.id,
          label,
          value: element,
          formattedValue: formatFilterValue(element),
          exploded: true,
        });
      });
      return;
    }

    const value = spec.value ?? null;
    chips.push({
      key: spec.id,
      id: spec.id,
      label,
      value,
      formattedValue: value === null ? '' : format(value),
      exploded: false,
    });
  }
}
