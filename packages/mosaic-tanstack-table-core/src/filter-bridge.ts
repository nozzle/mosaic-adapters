import {
  clauseInterval,
  clauseMatch,
  clausePoint,
  clausePoints,
} from '@uwdata/mosaic-core';
import { gte, literal, lte } from '@uwdata/mosaic-sql';
import {
  SqlIdentifier,
  createClearClause,
  createStructAccess,
  createValueClause,
  deepEqual,
} from '@nozzleio/mosaic-core';
import type {
  ClauseSource,
  Selection,
  SelectionClause,
} from '@uwdata/mosaic-core';
import type { ExprNode, ScaleDomain } from '@uwdata/mosaic-sql';
import type { ColumnFiltersState } from '@tanstack/table-core';
import type {
  ColumnFilterClauseKind,
  FilterBridge,
  FilterBridgeColumns,
  FilterBridgeOptions,
} from './types';

/**
 * A column filter after kind-specific normalization: either inactive
 * (clause must be removed) or active with the value the clause is built
 * from. The wrapper keeps "inactive" distinct from an active `null` value
 * (e.g. `'equals'` matching SQL NULLs).
 */
type NormalizedFilter = { active: false } | { active: true; value: unknown };

const INACTIVE: NormalizedFilter = { active: false };

interface PublishedClause {
  kind: ColumnFilterClauseKind;
  /** SQL column the published predicate tests. */
  field: string;
  /** Normalized value the published clause was built from. */
  value: unknown;
}

export function createFilterBridge(options: FilterBridgeOptions): FilterBridge {
  return new TanStackFilterBridge(options);
}

/**
 * Publishes TanStack column-filter state as clauses on a Selection.
 *
 * Every Selection update emits a value event and re-queries all consumers
 * — even when the resolved clauses are unchanged — so this bridge is
 * aggressive about suppression: a clause is published only when its
 * normalized content (kind, SQL column, value) actually changed, and a
 * removal is published only for a clause this bridge previously published.
 */
class TanStackFilterBridge implements FilterBridge {
  readonly #selection: Selection;
  readonly #onExternalClear: ((columnIds: Array<string>) => void) | undefined;
  #columns: FilterBridgeColumns;
  #filters: ColumnFiltersState = [];
  #destroyed = false;

  /**
   * Stable clause identity per TanStack column id, held for the bridge's
   * lifetime so re-publishes replace rather than accumulate. Each source
   * implements `reset` so an external `selection.reset()` drops our
   * bookkeeping too — otherwise value-diff suppression would skip the
   * republish that restores the clause.
   */
  readonly #sources = new Map<string, BridgeClauseSource>();
  readonly #published = new Map<string, PublishedClause>();

  /**
   * Detects clauses this bridge published that an external actor removed
   * (chip removal, global reset) and reports their column ids. Bookkeeping
   * is kept intact until the consumer's state prune arrives, so interim
   * state syncs value-diff as unchanged instead of republishing.
   */
  #externalClearListener = () => {
    if (this.#destroyed || this.#onExternalClear === undefined) {
      return;
    }
    const clearedIds = [...this.#published.keys()].filter((id) => {
      const source = this.#sources.get(id);
      return (
        source !== undefined &&
        !this.#selection._resolved.some((clause) => clause.source === source)
      );
    });
    if (clearedIds.length > 0) {
      this.#onExternalClear(clearedIds);
    }
  };

  constructor(options: FilterBridgeOptions) {
    this.#selection = options.selection;
    this.#columns = options.columns ?? {};
    this.#onExternalClear = options.onExternalClear;
    if (this.#onExternalClear !== undefined) {
      this.#selection.addEventListener('value', this.#externalClearListener);
    }
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
    this.#columns = columns;
    this.#reconcile();
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    if (this.#onExternalClear !== undefined) {
      this.#selection.removeEventListener('value', this.#externalClearListener);
    }
    for (const id of [...this.#published.keys()]) {
      this.#clear(id);
    }
  }

  #reconcile(): void {
    // Last write wins if TanStack state ever carries duplicate column ids.
    const desired = new Map<string, NormalizedFilter & { active: true }>();
    for (const filter of this.#filters) {
      const config = this.#columns[filter.id];
      if (!config) {
        // Unconfigured columns are deliberately not bridged; their filters
        // are the consumer's to route (or ignore).
        continue;
      }
      const normalized = normalizeFilterValue(config.clause, filter.value);
      if (!normalized.active) {
        continue;
      }
      desired.set(filter.id, normalized);
    }

    for (const id of [...this.#published.keys()]) {
      if (!desired.has(id)) {
        this.#clear(id);
      }
    }

    for (const [id, normalized] of desired) {
      const config = this.#columns[id]!;
      const field = config.column ?? id;
      const previous = this.#published.get(id);
      const unchanged =
        previous !== undefined &&
        previous.kind === config.clause &&
        previous.field === field &&
        deepEqual(previous.value, normalized.value);
      if (unchanged) {
        continue;
      }
      const clause = buildClause(
        config.clause,
        field,
        normalized.value,
        this.#sourceFor(id, field),
      );
      this.#published.set(id, {
        kind: config.clause,
        field,
        value: normalized.value,
      });
      this.#selection.update(clause);
    }
  }

  #clear(id: string): void {
    const source = this.#sources.get(id);
    this.#published.delete(id);
    if (!source) {
      return;
    }
    // An externally-cleared clause is already gone from the Selection;
    // publishing another removal would only emit a redundant value event.
    const stillActive = this.#selection._resolved.some(
      (clause) => clause.source === source,
    );
    if (!stillActive) {
      return;
    }
    this.#selection.update(createClearClause(source));
  }

  /**
   * Sources carry `{ id, column }` descriptors so downstream consumers (the
   * filter registry's chip labeling) can identify which column a bridge
   * clause filters without reaching back into TanStack state.
   */
  #sourceFor(id: string, field: string): ClauseSource {
    const existing = this.#sources.get(id);
    if (existing) {
      existing.column = field;
      return existing;
    }
    const source: BridgeClauseSource = {
      id,
      column: field,
      reset: () => {
        // Without an external-clear callback, TanStack state is
        // authoritative: dropping the bookkeeping lets the next state sync
        // republish the clause a reset removed. With the callback, the
        // external clear wins — bookkeeping survives (suppressing interim
        // republishes) until the consumer's state prune lands.
        if (this.#onExternalClear === undefined) {
          this.#published.delete(id);
        }
      },
    };
    this.#sources.set(id, source);
    return source;
  }
}

interface BridgeClauseSource {
  id: string;
  column: string;
  reset: () => void;
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

/**
 * Build the clause for an active filter. The source is a plain object (not
 * a MosaicClient), so the upstream factories attach no `clients` set and
 * nothing is self-excluded — the table is filtered by its own column
 * filters, unlike brush/facet publishers.
 *
 * Dotted SQL columns (`related_phrase.phrase`) are struct-access paths and
 * become `"related_phrase"."phrase"` — a single quoted identifier would name
 * a non-existent column.
 */
function buildClause(
  kind: ColumnFilterClauseKind,
  fieldPath: string,
  value: unknown,
  source: ClauseSource,
): SelectionClause {
  const field: ExprNode = createStructAccess(SqlIdentifier.from(fieldPath));
  switch (kind) {
    case 'equals': {
      return clausePoint(field, value, { source });
    }
    case 'ilike': {
      return clauseMatch(field, value as string, {
        source,
        method: 'contains',
      });
    }
    case 'prefix': {
      return clauseMatch(field, value as string, { source, method: 'prefix' });
    }
    case 'range':
    case 'date-range': {
      const [lo, hi] = value as [number | Date | null, number | Date | null];
      if (lo !== null && hi !== null) {
        // normalizeRange guarantees homogeneous bounds per kind (numbers
        // for 'range', Dates for 'date-range').
        return clauseInterval(field, [lo, hi] as ScaleDomain, { source });
      }
      // A half-open range is not BETWEEN-shaped, so it must not carry
      // interval optimizer meta; createValueClause takes the safe
      // (non pre-aggregated) path.
      const predicate =
        lo !== null ? gte(field, literal(lo)) : lte(field, literal(hi));
      return createValueClause({ source, value, predicate });
    }
    case 'in': {
      const values = value as Array<unknown>;
      return clausePoints(
        [field],
        values.map((item) => [item]),
        { source },
      );
    }
  }
}
