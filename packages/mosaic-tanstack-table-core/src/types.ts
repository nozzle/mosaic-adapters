import type { FilterSet, FilterSpec } from '@nozzleio/mosaic-core';
import type { ColumnFiltersState } from '@tanstack/table-core';

/**
 * Declarative clause kinds for the column-filter bridge. Each kind maps a
 * TanStack Table column-filter value onto a {@link FilterSpec} written into a
 * {@link FilterSet}, which owns the clause lifecycle (publishing, targets,
 * self-exclusion, external-clear detection, persistence):
 *
 * - `'equals'` — null-safe equality (spec kind `point`). Any non-`undefined`
 *   filter value publishes, including `null` (matches SQL NULLs).
 * - `'ilike'` — case-insensitive substring match (spec kind `match`, operator
 *   `'contains'`). Empty/nullish strings clear the spec.
 * - `'prefix'` — case-insensitive prefix match (spec kind `match`, operator
 *   `'prefix'`). Empty/nullish strings clear the spec.
 * - `'range'` — numeric `[lo, hi]` (spec kind `interval`). Either bound may be
 *   open (nullish, empty string, or non-numeric); a half-open range becomes a
 *   plain `>=`/`<=` clause. Both bounds open clears the spec.
 * - `'date-range'` — like `'range'` with bounds coerced to `Date`
 *   (`Date` kept as-is; strings/numbers via `new Date(...)`).
 * - `'in'` — membership over an array of values (spec kind `points`). A scalar
 *   is treated as a single-element array; an empty array clears the spec.
 */
export type ColumnFilterClauseKind =
  | 'equals'
  | 'ilike'
  | 'prefix'
  | 'range'
  | 'date-range'
  | 'in';

export interface FilterBridgeColumn {
  /**
   * SQL column the spec predicates test; defaults to the TanStack Table column id.
   * Dotted paths are struct access (`related_phrase.phrase` →
   * `"related_phrase"."phrase"`).
   */
  column?: string;
  clause: ColumnFilterClauseKind;
  /** Chip label carried onto the spec (`spec.label`); defaults to the column. */
  label?: string;
  /** Named routing target for the spec's clauses; defaults to `'where'`. */
  target?: string;
}

/** Per-column bridge config, keyed by TanStack Table column id. */
export type FilterBridgeColumns = Record<string, FilterBridgeColumn>;

export interface FilterBridgeOptions {
  /**
   * FilterSet that receives one {@link FilterSpec} per actively filtered
   * column. The set owns clause publishing, routing, and external-clear
   * detection; the bridge is only a `columnFilters` → spec translator.
   */
  set: FilterSet;
  /** Per-column clause config; defaults to none (supply later via `setColumns`). */
  columns?: FilterBridgeColumns;
  /**
   * Prefix for every managed spec id: `spec.id = `${idPrefix}${columnId}``.
   * Defaults to `''` (spec id equals the TanStack Table column id).
   */
  idPrefix?: string;
  /**
   * How the bridge reacts to external spec removals (a chip bar's X, a global
   * `set.reset()`, or persisted state hydrated before mount). The bridge
   * inverts the surviving specs back to TanStack Table filter values and reports the
   * full rebuilt state so the consumer can adopt it (prune cleared columns,
   * hydrate persisted ones). Without this callback the bridge leaves such
   * specs untouched and never republishes over them.
   */
  onExternalChange?: (filters: ColumnFiltersState) => void;
}

/**
 * Framework-agnostic core of the TanStack Table column-filter bridge: a thin
 * `columnFilters` → {@link FilterSpec} translator over a {@link FilterSet}.
 * The bridge normalizes each configured column's TanStack Table value into a spec
 * (or removes it when inactive), value-diffs against its last-pushed state so
 * render-loop echoes publish nothing, and watches the set's store for external
 * removals of the ids it manages.
 */
export interface FilterBridge {
  /** Reconcile managed specs against the given TanStack Table filter state. */
  setFilters: (filters: ColumnFiltersState) => void;
  /**
   * Swap the per-column config; affected specs are rewritten or removed.
   * Newly configured column ids whose specs already exist in the set are
   * adopted (reported via `onExternalChange`), like at creation.
   */
  setColumns: (columns: FilterBridgeColumns) => void;
  /**
   * Remove the specs this bridge wrote and stop translating. Adopted specs
   * the consumer's filter state never confirmed are left in the set — the
   * bridge never deletes state it did not publish.
   */
  destroy: () => void;
  /** True once `destroy()` has run; destroyed bridges never publish again. */
  readonly destroyed: boolean;
}
