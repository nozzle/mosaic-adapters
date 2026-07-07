import { deepEqual } from '@nozzleio/mosaic-core';
import type { FilterSet, FilterSpec } from '@nozzleio/mosaic-core';
import type { ColumnFilter, ColumnFiltersState } from '@tanstack/table-core';
import type {
  ColumnFilterClauseKind,
  FilterBridge,
  FilterBridgeColumn,
  FilterBridgeColumns,
  FilterBridgeOptions,
} from './types';

/**
 * A column filter after kind-specific normalization: either inactive (no spec
 * is written) or active with the value the spec carries. The wrapper keeps
 * "inactive" distinct from an active `null` value (e.g. `'equals'` matching
 * SQL NULLs).
 */
type NormalizedFilter = { active: false } | { active: true; value: unknown };

const INACTIVE: NormalizedFilter = { active: false };

export function createTanStackTableFilterBridge(
  options: FilterBridgeOptions,
): FilterBridge {
  return new TanStackTableFilterBridge(options);
}

/**
 * Translates TanStack Table `columnFilters` state into {@link FilterSpec}s on a
 * {@link FilterSet}. The set owns all clause machinery — this bridge only
 * normalizes TanStack Table values into specs, diffs them against its last-pushed
 * state, and mirrors external spec removals back into TanStack Table state.
 *
 * Suppression is value-level: a spec is written only when its normalized
 * content (kind, column, operator, value, label, target) actually changed, and
 * a removal is issued only for a spec this bridge previously wrote. The set
 * adds its own SQL-level suppression on top.
 */
class TanStackTableFilterBridge implements FilterBridge {
  readonly #set: FilterSet;
  readonly #idPrefix: string;
  readonly #onExternalChange:
    | ((filters: ColumnFiltersState) => void)
    | undefined;
  #columns: FilterBridgeColumns;
  #filters: ColumnFiltersState = [];
  #destroyed = false;

  /**
   * The last spec this bridge pushed per managed spec id, held for its
   * lifetime so re-pushes suppress on equal content and only genuine changes
   * reach the set. An entry disappearing from the set's store while still
   * tracked here (and not removed by us) is an external removal.
   */
  readonly #published = new Map<string, FilterSpec>();

  /**
   * Ids adopted from pre-existing set state (persisted hydration) that the
   * consumer's TanStack Table state has not yet confirmed. Reconciles against
   * not-yet-caught-up consumer state must not remove them, and `destroy()`
   * must leave them in the set (a StrictMode double-mount would otherwise
   * wipe persisted state). An id graduates to the normal lifecycle the first
   * time a reconcile's desired state covers it.
   */
  readonly #adopted = new Set<string>();

  /** Detaches the set-store subscription wired at construction. */
  readonly #unsubscribe: () => void;

  constructor(options: FilterBridgeOptions) {
    this.#set = options.set;
    this.#columns = options.columns ?? {};
    this.#idPrefix = options.idPrefix ?? '';
    this.#onExternalChange = options.onExternalChange;

    // Adopt any specs the set already holds under this bridge's managed ids
    // (persisted state hydrated before mount): report them via the callback so
    // the consumer's TanStack Table state drives them, and never clear them here.
    this.#adoptExisting();

    const subscription = this.#set.store.subscribe(() => {
      this.#onSetStoreChange();
    });
    this.#unsubscribe = () => subscription.unsubscribe();
  }

  get destroyed(): boolean {
    return this.#destroyed;
  }

  setFilters(filters: ColumnFiltersState): void {
    if (this.#destroyed) {
      return;
    }
    this.#filters = filters;
    this.#reconcile();
  }

  setColumns(columns: FilterBridgeColumns): void {
    if (this.#destroyed) {
      return;
    }
    const previous = this.#columns;
    this.#columns = columns;
    this.#adoptNewColumns(previous);
    this.#reconcile();
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    this.#unsubscribe();
    for (const id of [...this.#published.keys()]) {
      if (this.#adopted.has(id)) {
        // Adopted but never confirmed by consumer state: the bridge did not
        // write this spec, so it must not delete it either — a StrictMode
        // mount/unmount cycle re-adopts it cleanly, with zero set churn.
        continue;
      }
      this.#set.remove(id);
    }
    this.#published.clear();
    this.#adopted.clear();
  }

  /** The managed spec id for a TanStack Table column id. */
  #specId(columnId: string): string {
    return `${this.#idPrefix}${columnId}`;
  }

  #adoptExisting(): void {
    if (this.#onExternalChange === undefined) {
      return;
    }
    const managed = this.#managedSpecs();
    if (managed.length === 0) {
      return;
    }
    // Track them so external-removal detection and value-diffing behave as if
    // this bridge published them; the consumer owns their TanStack Table state now.
    // They stay in #adopted until the consumer's filter state confirms them.
    for (const spec of managed) {
      this.#published.set(spec.id, spec);
      this.#adopted.add(spec.id);
    }
    this.#onExternalChange(this.#rebuildFilters());
  }

  /**
   * Adopts specs for column ids newly added by a `setColumns` call whose
   * managed ids already exist in the set but were never published by this
   * bridge — the hook path, where the bridge is constructed before its column
   * config arrives. Mirrors {@link #adoptExisting}: callback required, specs
   * are reported (not cleared) and stay in `#adopted` until confirmed.
   */
  #adoptNewColumns(previous: FilterBridgeColumns): void {
    if (this.#onExternalChange === undefined) {
      return;
    }
    let adopted = false;
    for (const columnId of Object.keys(this.#columns)) {
      if (previous[columnId] !== undefined) {
        continue;
      }
      const id = this.#specId(columnId);
      if (this.#published.has(id)) {
        continue;
      }
      const spec = this.#set.store.state.specs.find(
        (candidate) => candidate.id === id,
      );
      if (spec === undefined) {
        continue;
      }
      this.#published.set(id, spec);
      this.#adopted.add(id);
      adopted = true;
    }
    if (adopted) {
      this.#onExternalChange(this.#rebuildFilters());
    }
  }

  #reconcile(): void {
    // Last write wins if TanStack Table state ever carries duplicate column ids.
    const desired = new Map<string, FilterSpec>();
    for (const filter of this.#filters) {
      const config = this.#columns[filter.id];
      if (config === undefined) {
        // Unconfigured columns are deliberately not bridged; their filters are
        // the consumer's to route (or ignore).
        continue;
      }
      const normalized = normalizeFilterValue(config.clause, filter.value);
      if (!normalized.active) {
        continue;
      }
      const spec = this.#specFor(filter.id, config, normalized.value);
      desired.set(spec.id, spec);
    }

    for (const id of [...this.#published.keys()]) {
      if (desired.has(id)) {
        continue;
      }
      if (this.#adopted.has(id)) {
        // Adopted spec the consumer's state has not yet caught up with — a
        // same-commit sync of stale (pre-adoption) filters must not wipe it.
        continue;
      }
      this.#published.delete(id);
      this.#set.remove(id);
    }

    for (const [id, spec] of desired) {
      // Consumer state now covers this id (changed or not): it graduates to
      // the normal lifecycle and becomes removable/destroyable.
      this.#adopted.delete(id);
      const previous = this.#published.get(id);
      if (previous !== undefined && deepEqual(previous, spec)) {
        continue;
      }
      this.#published.set(id, spec);
      this.#set.set(spec);
    }
  }

  /** Builds the {@link FilterSpec} for an active, normalized column filter. */
  #specFor(
    columnId: string,
    config: FilterBridgeColumn,
    value: unknown,
  ): FilterSpec {
    const column = config.column ?? columnId;
    const spec: FilterSpec = {
      id: this.#specId(columnId),
      column,
      kind: specKind(config.clause),
      value,
    };
    const operator = specOperator(config.clause);
    if (operator !== undefined) {
      spec.operator = operator;
    }
    if (config.label !== undefined) {
      spec.label = config.label;
    }
    if (config.target !== undefined) {
      spec.target = config.target;
    }
    return spec;
  }

  /** Specs currently in the set that fall under this bridge's managed ids. */
  #managedSpecs(): Array<FilterSpec> {
    const managedIds = new Set<string>();
    for (const columnId of Object.keys(this.#columns)) {
      managedIds.add(this.#specId(columnId));
    }
    return this.#set.store.state.specs.filter((spec) =>
      managedIds.has(spec.id),
    );
  }

  /**
   * Reacts to the set's store changing: if a spec id this bridge manages
   * disappears (and the bridge did not remove it itself), the intent was
   * dropped externally. Tracking is always pruned — TanStack Table state stays
   * authoritative and the next state sync republishes — and, with a callback,
   * the surviving TanStack Table state is rebuilt and reported so the consumer
   * prunes instead.
   */
  #onSetStoreChange(): void {
    if (this.#destroyed) {
      return;
    }
    const present = new Set(this.#set.store.state.specs.map((spec) => spec.id));
    let removed = false;
    for (const id of [...this.#published.keys()]) {
      if (!present.has(id)) {
        this.#published.delete(id);
        this.#adopted.delete(id);
        removed = true;
      }
    }
    if (removed && this.#onExternalChange !== undefined) {
      this.#onExternalChange(this.#rebuildFilters());
    }
  }

  /**
   * Rebuilds the TanStack Table `columnFilters` state from the specs this bridge
   * still tracks, inverting each spec's value back to its TanStack Table shape.
   */
  #rebuildFilters(): ColumnFiltersState {
    const filters: Array<ColumnFilter> = [];
    for (const columnId of Object.keys(this.#columns)) {
      const spec = this.#published.get(this.#specId(columnId));
      if (spec === undefined) {
        continue;
      }
      filters.push({ id: columnId, value: invertSpecValue(spec) });
    }
    return filters;
  }
}

function specKind(kind: ColumnFilterClauseKind): FilterSpec['kind'] {
  switch (kind) {
    case 'equals':
      return 'point';
    case 'ilike':
    case 'prefix':
      return 'match';
    case 'range':
    case 'date-range':
      return 'interval';
    case 'in':
      return 'points';
  }
}

function specOperator(kind: ColumnFilterClauseKind): string | undefined {
  switch (kind) {
    case 'ilike':
      return 'contains';
    case 'prefix':
      return 'prefix';
    default:
      return undefined;
  }
}

/**
 * Inverts a managed spec's value back to the TanStack Table filter value the bridge
 * would have normalized from — the shape column filter UIs expect. `match`
 * specs carry the raw string; `interval` specs carry `[lo, hi]`; `points`
 * specs carry the value array; `point` specs carry the scalar.
 */
function invertSpecValue(spec: FilterSpec): unknown {
  return spec.value;
}

function normalizeFilterValue(
  kind: ColumnFilterClauseKind,
  raw: unknown,
): NormalizedFilter {
  switch (kind) {
    case 'equals': {
      if (raw === undefined) {
        return INACTIVE;
      }
      return { active: true, value: raw };
    }
    case 'ilike':
    case 'prefix': {
      if (raw === undefined || raw === null) {
        return INACTIVE;
      }
      const text = String(raw);
      if (text === '') {
        return INACTIVE;
      }
      return { active: true, value: text };
    }
    case 'range': {
      return normalizeRange(raw, toNumberBound);
    }
    case 'date-range': {
      return normalizeRange(raw, toDateBound);
    }
    case 'in': {
      if (raw === undefined || raw === null) {
        return INACTIVE;
      }
      const values = Array.isArray(raw) ? raw : [raw];
      if (values.length === 0) {
        return INACTIVE;
      }
      return { active: true, value: values };
    }
  }
}

function normalizeRange(
  raw: unknown,
  toBound: (value: unknown) => number | Date | null,
): NormalizedFilter {
  if (!Array.isArray(raw)) {
    return INACTIVE;
  }
  const lo = toBound(raw[0]);
  const hi = toBound(raw[1]);
  if (lo === null && hi === null) {
    return INACTIVE;
  }
  // Emit the array shape the interval kind accepts: both bounds → BETWEEN,
  // one open bound → a plain `>=`/`<=` clause (no optimizer meta).
  return { active: true, value: [lo, hi] };
}

function toNumberBound(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toDateBound(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (
    (typeof value === 'string' && value.trim() !== '') ||
    typeof value === 'number'
  ) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}
