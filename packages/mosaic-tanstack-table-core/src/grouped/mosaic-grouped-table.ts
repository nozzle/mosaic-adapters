/**
 * @file MosaicGroupedTable — framework-agnostic core class for server-side
 * hierarchical grouping.
 *
 * ## Why this exists (the gap between TanStack and server-side GROUP BY)
 *
 * TanStack Table has excellent expanding/grouping support — but it assumes
 * the client already has all the data. `getGroupedRowModel()` works on an
 * in-memory dataset. For large tables (millions of rows), client-side grouping
 * is impractical: we need the *database* to run `GROUP BY` and return only
 * aggregated results.
 *
 * This class bridges that gap: it issues SQL GROUP BY queries at each tree
 * level, lazily loads children on expand, and feeds the results into
 * TanStack's expanding model via `getTableOptions()`. TanStack still owns
 * the expand/collapse state and row model — we just supply the data and
 * intercept `onExpandedChange` to trigger server queries.
 *
 * ## Two-tier query strategy
 *
 * **Root query → MosaicClient lifecycle:**
 *   The root GROUP BY (depth 0) goes through the coordinator's managed
 *   lifecycle: `query(filter)` → coordinator executes → `queryResult(data)`.
 *   This gives us automatic cross-filter updates (when any other Mosaic
 *   component updates the shared Selection, the coordinator re-runs our
 *   query), query consolidation, caching, and `filterStable` pre-aggregation
 *   optimizations.
 *
 * **Child queries → direct `coordinator.query()`:**
 *   When a user expands a row, we fire `coordinator.query(sql)` directly.
 *   These are ad-hoc, on-demand queries triggered by user interaction — they
 *   don't fit MosaicClient's single-query lifecycle (which manages exactly
 *   one query at a time). Results are cached in `#childrenCache` so
 *   re-expanding a previously opened row is instant.
 *
 * **On filter change:** The coordinator calls our `queryResult()` with new
 *   root data. We then re-query all currently-expanded children in parallel
 *   via `#refreshExpandedChildren()`, since their aggregations may have
 *   changed too.
 *
 * ## TanStack integration
 *
 * `getTableOptions()` returns a complete `TableOptions<ServerGroupedRow>`
 * including `onExpandedChange`, `getSubRows`, `getRowId`, `getCoreRowModel`,
 * and `getExpandedRowModel`. The consumer passes this directly to
 * `useReactTable()` — same pattern as `MosaicDataTable.getTableOptions()`.
 *
 * The key integration point is `onExpandedChange`: TanStack fires this when
 * `row.toggleExpanded()` is called. We intercept it to:
 * 1. Update our internal expanded state
 * 2. Cascade-collapse children if a parent is collapsed
 * 3. Lazy-load children for newly expanded rows via server queries
 */
import { MosaicClient, isArrowTable } from '@uwdata/mosaic-core';
import { Store, batch } from '@tanstack/store';
import { getCoreRowModel, getExpandedRowModel } from '@tanstack/table-core';
import { logger } from '../logger';
import { createLifecycleManager, handleQueryError } from '../client-utils';
import { functionalUpdate } from '../utils';
import { arrowTableToObjects } from './arrow-utils';
import { buildGroupedLevelQuery, buildLeafRowsQuery } from './query-builder';
import { GROUP_ID_SEPARATOR } from './types';
import type {
  Coordinator,
  Selection,
  SelectionClause,
} from '@uwdata/mosaic-core';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type {
  ColumnDef,
  ExpandedState,
  TableOptions,
  Updater,
} from '@tanstack/table-core';
import type { IMosaicClient } from '../types';
import type {
  GroupLevel,
  GroupMetric,
  GroupRow,
  LeafColumn,
  LeafRow,
  ServerGroupedRow,
} from './types';

// ---------------------------------------------------------------------------
// Stable source identity for Mosaic Selection updates
// ---------------------------------------------------------------------------

const GROUPED_TABLE_SOURCE = { id: 'server-grouped-table' };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Safely extract expanded keys from an ExpandedState.
 * ExpandedState can be `true` (all expanded) or `Record<string, boolean>`.
 */
function getExpandedKeys(state: ExpandedState): Array<string> {
  if (state === true) {
    return [];
  }
  return Object.entries(state)
    .filter(([, v]) => v)
    .map(([k]) => k);
}

/** Safely check if a specific key is expanded. */
function isKeyExpanded(state: ExpandedState, key: string): boolean {
  if (state === true) {
    return true;
  }
  return !!state[key];
}

/** Find keys that are in newExpanded but not in oldExpanded. */
function findNewlyExpandedKeys(
  oldExpanded: ExpandedState,
  newExpanded: ExpandedState,
): Array<string> {
  if (newExpanded === true) {
    return [];
  }
  const newKeys = getExpandedKeys(newExpanded);
  return newKeys.filter((k) => !isKeyExpanded(oldExpanded, k));
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface MosaicGroupedTableOptions {
  /** Table (or view) name to query. */
  table: string;

  /** Hierarchy of columns to group by, in order. */
  groupBy: Array<GroupLevel>;

  /** Aggregation metrics to compute at each level. */
  metrics: Array<GroupMetric>;

  /** Mosaic Selection that provides cross-filter predicates. */
  filterBy: Selection;

  /** Optional row selection integration for cross-filtering output. */
  rowSelection?: {
    selection: Selection;
  };

  /** Additional static WHERE clauses (e.g., NULL exclusion). */
  additionalWhere?: FilterExpr | null;

  /** Maximum rows per level. Defaults to 200. */
  pageSize?: number;

  /**
   * Columns to fetch for raw leaf rows.
   * When provided, expanding the deepest grouped level shows individual data rows.
   */
  leafColumns?: Array<LeafColumn>;

  /** Maximum leaf rows to fetch per parent. Defaults to 50. */
  leafPageSize?: number;

  /**
   * When true, leaf row queries use SELECT * instead of only named leafColumns.
   * All result columns are available in `values`.
   */
  leafSelectAll?: boolean;
}

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

export interface MosaicGroupedTableState {
  treeData: Array<ServerGroupedRow>;
  expanded: ExpandedState;
  isRootLoading: boolean;
  totalRootRows: number;
  loadingGroupIds: Array<string>;
}

// ---------------------------------------------------------------------------
// Core class
// ---------------------------------------------------------------------------

export class MosaicGroupedTable extends MosaicClient implements IMosaicClient {
  private lifecycle = createLifecycleManager(this);
  readonly store: Store<MosaicGroupedTableState>;

  /**
   * Cache of lazily-fetched child rows, keyed by parent row ID.
   *
   * When a user expands "USA" (root group), we query the next level
   * (e.g. `GROUP BY sport WHERE nationality = 'USA'`) and store the
   * result here as `childrenCache.get("USA") → [Swimming, Track, ...]`.
   *
   * The cache serves two purposes:
   * 1. **Instant re-expand:** Collapsing then re-expanding "USA" reads from
   *    cache without a server round-trip.
   * 2. **Tree assembly:** `#rebuildTree()` walks the cache to attach `subRows`
   *    onto the flat root rows, producing the nested structure TanStack expects.
   *
   * The cache is invalidated (and re-queried) when cross-filters change
   * via `#refreshExpandedChildren()`, since aggregation values may differ.
   */
  #childrenCache: Map<string, Array<ServerGroupedRow>> = new Map();
  /** Flat root-level rows from the most recent root GROUP BY query. */
  #rootRows: Array<ServerGroupedRow> = [];
  #options: MosaicGroupedTableOptions;

  constructor(options: MosaicGroupedTableOptions) {
    super(options.filterBy);
    this.#options = options;
    this.store = new Store<MosaicGroupedTableState>({
      treeData: [],
      expanded: {} as ExpandedState,
      isRootLoading: false,
      totalRootRows: 0,
      loadingGroupIds: [],
    });
  }

  // --- MosaicClient lifecycle ---

  get isConnected() {
    return this.lifecycle.isConnected;
  }

  /**
   * Tells the Mosaic coordinator that our GROUP BY columns don't change when
   * filters change — only the aggregation *values* change. This enables
   * pre-aggregation optimizations: the coordinator can cache the query plan
   * and only re-execute with the new filter predicate, rather than treating
   * each filter change as a completely new query.
   */
  override get filterStable() {
    return true;
  }

  setCoordinator(coord: Coordinator): void {
    this.lifecycle.handleCoordinatorSwap(this.coordinator, coord, () =>
      this.connect(),
    );
    this.coordinator = coord;
  }

  connect(): () => void {
    return this.lifecycle.connect(this.coordinator);
  }

  disconnect(): void {
    this.lifecycle.disconnect(this.coordinator);
  }

  /**
   * MosaicClient lifecycle hook — called by the coordinator to get our SQL.
   *
   * The coordinator calls this whenever cross-filters change (via the
   * `filterBy` Selection). We return the root-level GROUP BY query (depth 0)
   * and the coordinator handles execution, caching, and consolidation.
   *
   * Only the root level uses this lifecycle. Deeper levels are fetched via
   * direct `coordinator.query()` calls in `#loadChildrenIfNeeded()`.
   */
  override query(filter?: FilterExpr | null): SelectQuery | null {
    return buildGroupedLevelQuery({
      table: this.#options.table,
      groupBy: this.#options.groupBy,
      depth: 0,
      metrics: this.#options.metrics,
      parentConstraints: {},
      filterPredicate: filter ?? undefined,
      additionalWhere: this.#options.additionalWhere ?? undefined,
      limit: this.#options.pageSize ?? 200,
    });
  }

  /**
   * MosaicClient lifecycle hook — called by the coordinator with query results.
   *
   * Receives an Arrow table with root-level aggregation rows. After processing
   * these into GroupRow objects, we must also refresh any currently-expanded
   * children — their aggregation values likely changed with the new filter.
   * This is the "two-tier" pattern: the coordinator manages the root query
   * lifecycle, but we manually re-query expanded children in parallel.
   */
  override queryResult(table: unknown): this {
    if (!isArrowTable(table)) {
      return this;
    }

    const rawRows = arrowTableToObjects(table);
    const roots = rawRows.map((raw) => this.#toGroupedRow(raw, 0, {}));
    this.#rootRows = roots;

    batch(() => {
      this.store.setState((prev) => ({
        ...prev,
        isRootLoading: false,
        totalRootRows: roots.length,
      }));
    });

    // Refresh expanded children asynchronously (they need the new filter too)
    this.#refreshExpandedChildren();
    this.#rebuildTree();
    return this;
  }

  override queryError(error: Error): this {
    handleQueryError('MosaicGroupedTable', error);
    this.store.setState((prev) => ({ ...prev, isRootLoading: false }));
    return this;
  }

  // --- Lifecycle hooks (called by createLifecycleManager) ---

  public __onConnect(): void {
    // The coordinator handles filterBy changes automatically via query/queryResult.
    // No manual selection listeners needed.
  }

  public __onDisconnect(): void {
    // Cleanup if needed
  }

  // --- Public API ---

  updateOptions(options: MosaicGroupedTableOptions): void {
    const filterByChanged = options.filterBy !== this.#options.filterBy;
    this.#options = options;

    if (filterByChanged) {
      // Update MosaicClient's internal filterBy reference so the coordinator
      // re-registers with the new selection.
      this._filterBy = options.filterBy;
      this.#childrenCache.clear();
    }
  }

  /**
   * Returns TanStack TableOptions — pass directly to `useReactTable()`.
   *
   * This is the primary integration point with TanStack Table. The returned
   * options wire up:
   * - `data` → the assembled tree (root rows + cached children via `#rebuildTree`)
   * - `state.expanded` → our internal expanded state
   * - `onExpandedChange` → intercepts TanStack's expand/collapse to trigger
   *   lazy server queries for newly expanded rows
   * - `getSubRows` → tells TanStack how to traverse our tree (GroupRow.subRows)
   * - `getRowId` → uses our \x1F-delimited IDs for stable identity
   * - `getCoreRowModel` + `getExpandedRowModel` → TanStack's standard row models
   *
   * The consumer defines column defs with cell renderers that use TanStack's
   * APIs (`row.getIsExpanded()`, `row.depth`, `row.original.type`) — the
   * renderer never needs to know about the server-side query machinery.
   */
  getTableOptions(
    state: MosaicGroupedTableState,
    columns: Array<ColumnDef<ServerGroupedRow, any>>,
  ): TableOptions<ServerGroupedRow> {
    return {
      data: state.treeData,
      columns,
      state: { expanded: state.expanded },
      onExpandedChange: (updater: Updater<ExpandedState>) =>
        this.#handleExpandedChange(updater),
      getSubRows: (row) => (row.type === 'group' ? row.subRows : undefined),
      getRowId: (row) => row.id,
      getCoreRowModel: getCoreRowModel(),
      getExpandedRowModel: getExpandedRowModel(),
    };
  }

  /** Programmatic expand/collapse toggle (convenience). */
  toggleExpand(rowId: string): void {
    const { expanded } = this.store.state;
    const newExpanded =
      expanded === true
        ? { [rowId]: false }
        : { ...expanded, [rowId]: !expanded[rowId] };
    this.#handleExpandedChange(newExpanded);
  }

  /** Check if a row is currently loading children. */
  isRowLoading(rowId: string): boolean {
    return this.store.state.loadingGroupIds.includes(rowId);
  }

  clearSelection(): void {
    if (this.#options.rowSelection?.selection) {
      this.#options.rowSelection.selection.update({
        source: GROUPED_TABLE_SOURCE,
        value: null,
        predicate: null,
      } as SelectionClause);
    }
  }

  // --- Private: Expand/Collapse handling ---
  //
  // This is where server-side grouping diverges from client-side: when
  // TanStack fires onExpandedChange, we can't just show/hide existing rows.
  // We need to check if the children have been fetched, and if not, fire a
  // SQL query. The flow is:
  //   1. Diff old vs new expanded state to find newly expanded keys
  //   2. Update expanded state immediately (so TanStack shows the expand arrow)
  //   3. For collapsed rows: cascade-collapse their children too
  //   4. For expanded rows: load children from cache or fire a server query

  #handleExpandedChange(updater: Updater<ExpandedState>): void {
    const oldExpanded = this.store.state.expanded;
    const newExpanded = functionalUpdate(updater, oldExpanded);

    // Find newly expanded keys
    const newlyExpanded = findNewlyExpandedKeys(oldExpanded, newExpanded);

    // Update expanded state immediately
    this.store.setState((prev) => ({ ...prev, expanded: newExpanded }));

    // Handle collapses: cascade collapse children + clear selection if child was selected
    this.#handleCollapses(oldExpanded, newExpanded);

    // Handle expands: load children if not cached
    for (const rowId of newlyExpanded) {
      this.#loadChildrenIfNeeded(rowId);
    }
  }

  #handleCollapses(
    oldExpanded: ExpandedState,
    newExpanded: ExpandedState,
  ): void {
    const oldKeys = getExpandedKeys(oldExpanded);
    const collapsedKeys = oldKeys.filter((k) => !isKeyExpanded(newExpanded, k));

    if (collapsedKeys.length === 0) {
      return;
    }

    // Cascade collapse: also collapse children of collapsed rows
    this.store.setState((prev) => {
      if (prev.expanded === true) {
        return prev;
      }
      const nextExpanded = { ...prev.expanded } as Record<string, boolean>;

      for (const collapsedId of collapsedKeys) {
        delete nextExpanded[collapsedId];
        for (const k of Object.keys(nextExpanded)) {
          if (k.startsWith(collapsedId + GROUP_ID_SEPARATOR)) {
            delete nextExpanded[k];
          }
        }
      }

      return { ...prev, expanded: nextExpanded };
    });

    // Clear selection if it was on a child of a collapsed group
    if (this.#options.rowSelection?.selection) {
      const sel = this.#options.rowSelection.selection;
      const currentVal = sel.value as Array<string> | null;
      if (currentVal) {
        const shouldClear = collapsedKeys.some((collapsedId) =>
          currentVal.some(
            (v) =>
              v.startsWith(collapsedId + GROUP_ID_SEPARATOR) &&
              v !== collapsedId,
          ),
        );
        if (shouldClear) {
          sel.update({
            source: GROUPED_TABLE_SOURCE,
            value: null,
            predicate: null,
          } as SelectionClause);
        }
      }
    }

    this.#rebuildTree();
  }

  async #loadChildrenIfNeeded(rowId: string): Promise<void> {
    if (this.#childrenCache.has(rowId)) {
      this.#rebuildTree();
      return;
    }

    const row = this.#findRowById(rowId);
    if (!row || row.type !== 'group') {
      return;
    }

    this.#setLoadingGroup(rowId, true);

    try {
      const filterPredicate = this.#getFilterPredicate();
      const constraints = {
        ...row._parentConstraints,
        [row._groupColumn]: row.groupValue,
      };

      const children = row._isDetailPanel
        ? await this.#queryLeafRows(constraints, filterPredicate)
        : await this.#queryLevel(row._depth + 1, constraints, filterPredicate);

      this.#childrenCache.set(rowId, children);
    } catch (e) {
      logger.warn('Grouped', `Failed to load children for ${rowId}`, {
        error: e,
      });
      this.#childrenCache.set(rowId, []);
    } finally {
      this.#setLoadingGroup(rowId, false);
    }

    this.#rebuildTree();
  }

  // --- Private: Refresh expanded children after root update ---
  //
  // When a cross-filter changes, the coordinator re-runs our root query and
  // calls queryResult() with fresh root data. But the cached children are now
  // stale — their aggregation values were computed with the old filter.
  //
  // This method re-queries ALL currently-expanded children in parallel,
  // applying the new filter predicate. It also prunes expanded state for
  // root groups that no longer exist (e.g., a filter removed "USA" entirely).
  //
  // Why not just clear the cache and let the user re-expand? Because that
  // would visually collapse the entire tree on every filter change, losing
  // the user's drill-down context. Re-querying preserves the expanded state.

  async #refreshExpandedChildren(): Promise<void> {
    const expandedKeys = getExpandedKeys(this.store.state.expanded);
    if (expandedKeys.length === 0) {
      return;
    }

    const filterPredicate = this.#getFilterPredicate();
    const validRootIds = new Set(this.#rootRows.map((r) => r.id));

    const queries: Array<{
      parentId: string;
      promise: Promise<Array<ServerGroupedRow>>;
    }> = [];

    for (const key of expandedKeys) {
      // Skip leaf row entries
      if (key.includes('_leaf_')) {
        continue;
      }

      const row = this.#findRowById(key);
      if (row && row.type === 'group') {
        // Verify root is still valid
        const rootSegment = key.split(GROUP_ID_SEPARATOR)[0]!;
        if (!validRootIds.has(rootSegment)) {
          continue;
        }

        const constraints = {
          ...row._parentConstraints,
          [row._groupColumn]: row.groupValue,
        };

        if (row._isDetailPanel) {
          queries.push({
            parentId: key,
            promise: this.#queryLeafRows(constraints, filterPredicate),
          });
        } else {
          queries.push({
            parentId: key,
            promise: this.#queryLevel(
              row._depth + 1,
              constraints,
              filterPredicate,
            ),
          });
        }
        continue;
      }

      // Row not found in current tree — try to reconstruct from ID segments
      // (row may come from a previous generation)
      const { groupBy } = this.#options;
      const hasLeafColumns =
        !!this.#options.leafColumns && this.#options.leafColumns.length > 0;
      const segments = key.split(GROUP_ID_SEPARATOR);
      const depth = segments.length - 1;

      const isDetailPanelRow = depth === groupBy.length - 1 && hasLeafColumns;
      if (isDetailPanelRow) {
        continue;
      }
      if (depth >= groupBy.length - 1) {
        continue;
      }

      const rootSegment = segments[0]!;
      if (!validRootIds.has(rootSegment)) {
        continue;
      }

      const constraints: Record<string, string> = {};
      for (let i = 0; i <= depth; i++) {
        constraints[groupBy[i]!.column] = segments[i]!;
      }

      queries.push({
        parentId: key,
        promise: this.#queryLevel(depth + 1, constraints, filterPredicate),
      });
    }

    // Fire all child queries in parallel
    const results = await Promise.allSettled(
      queries.map(async (q) => ({
        parentId: q.parentId,
        children: await q.promise,
      })),
    );

    // Update cache
    const newCache = new Map<string, Array<ServerGroupedRow>>();
    for (const result of results) {
      if (result.status === 'fulfilled') {
        newCache.set(result.value.parentId, result.value.children);
      }
    }
    this.#childrenCache = newCache;

    // Prune expanded state for invalid roots
    const prevExpanded = this.store.state.expanded;
    if (prevExpanded !== true) {
      const pruned: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(prevExpanded)) {
        const rootSegment = k.split(GROUP_ID_SEPARATOR)[0]!;
        if (v && validRootIds.has(rootSegment)) {
          pruned[k] = true;
        }
      }
      this.store.setState((prev) => ({ ...prev, expanded: pruned }));
    }

    this.#rebuildTree();
  }

  // --- Private: Tree assembly ---
  //
  // The root rows and cached children are stored flat (root rows in
  // `#rootRows`, children keyed by parent ID in `#childrenCache`).
  // `#rebuildTree()` assembles the nested tree that TanStack expects by
  // recursively attaching cached children as `subRows` on their parent.
  // This runs after every cache mutation (load, refresh, collapse).

  #rebuildTree(): void {
    const cache = this.#childrenCache;

    function attachChildren(
      rows: Array<ServerGroupedRow>,
    ): Array<ServerGroupedRow> {
      return rows.map((row) => {
        if (row.type === 'leaf') {
          return row;
        }

        const cachedChildren = cache.get(row.id);

        if (cachedChildren && cachedChildren.length > 0) {
          return {
            ...row,
            subRows: attachChildren(cachedChildren),
          } as GroupRow;
        }

        // Keep empty subRows so TanStack shows expand toggle for expandable rows
        return {
          ...row,
          subRows: [] as Array<ServerGroupedRow>,
        } as GroupRow;
      });
    }

    const treeData = attachChildren(this.#rootRows);
    this.store.setState((prev) => ({ ...prev, treeData }));
  }

  // --- Private: Row builders ---
  //
  // Convert raw SQL result objects into typed GroupRow/LeafRow instances.
  // Each GroupRow embeds its metadata (_depth, _parentConstraints, etc.)
  // so that expand operations can build the correct child SQL query from
  // the row alone — no external lookup required.

  #toGroupedRow(
    raw: Record<string, unknown>,
    depth: number,
    parentConstraints: Record<string, string>,
  ): GroupRow {
    const { groupBy, metrics, leafColumns } = this.#options;
    const hasLeafColumns = !!leafColumns && leafColumns.length > 0;
    const level = groupBy[depth]!;
    const value = String(raw[level.column] ?? '');

    const isDeepestLevel = depth === groupBy.length - 1;
    const isDetailPanel = isDeepestLevel && hasLeafColumns;

    // Build ID with \x1F separator
    const parentChain = Object.values(parentConstraints);
    const id =
      parentChain.length > 0
        ? `${parentChain.join(GROUP_ID_SEPARATOR)}${GROUP_ID_SEPARATOR}${value}`
        : value;

    const metricsRecord: Record<string, number> = {};
    for (const metric of metrics) {
      const rawVal = raw[metric.id];
      metricsRecord[metric.id] = typeof rawVal === 'number' ? rawVal : 0;
    }

    return {
      type: 'group',
      id,
      groupValue: value,
      metrics: metricsRecord,
      _depth: depth,
      _parentConstraints: { ...parentConstraints },
      _groupColumn: level.column,
      _isDetailPanel: isDetailPanel,
      // All group rows get subRows so TanStack shows expand toggle
      subRows: [],
    };
  }

  #toLeafRow(
    raw: Record<string, unknown>,
    parentConstraints: Record<string, string>,
    index: number,
  ): LeafRow {
    const { leafColumns = [], leafSelectAll = false } = this.#options;

    const parentChain = Object.values(parentConstraints);
    const uniqueId = raw.unique_key ?? `row_${index}`;
    const id =
      parentChain.length > 0
        ? `${parentChain.join(GROUP_ID_SEPARATOR)}${GROUP_ID_SEPARATOR}_leaf_${uniqueId}`
        : `_leaf_${uniqueId}`;

    let values: Record<string, unknown>;
    if (leafSelectAll) {
      values = { ...raw };
    } else {
      values = {};
      for (const col of leafColumns) {
        values[col.column] = raw[col.column];
      }
    }

    return {
      type: 'leaf',
      id,
      values,
    };
  }

  // --- Private: Query execution ---
  //
  // These methods fire SQL queries for child data via `coordinator.query()`
  // directly (NOT through the MosaicClient lifecycle). This is intentional:
  // MosaicClient manages exactly one query at a time (the root), but child
  // queries are ad-hoc and on-demand — multiple can be in-flight when the
  // user has several levels expanded. The coordinator still provides caching
  // and connection pooling for these direct queries.

  async #queryLevel(
    depth: number,
    parentConstraints: Record<string, string>,
    filterPredicate: FilterExpr | null,
  ): Promise<Array<GroupRow>> {
    const {
      table,
      groupBy,
      metrics,
      additionalWhere,
      pageSize = 200,
    } = this.#options;

    const query = buildGroupedLevelQuery({
      table,
      groupBy,
      depth,
      metrics,
      parentConstraints,
      filterPredicate,
      additionalWhere: additionalWhere ?? undefined,
      limit: pageSize,
    });

    const result = await this.coordinator!.query(query.toString());
    const rawRows = arrowTableToObjects(result);

    return rawRows.map((raw) =>
      this.#toGroupedRow(raw, depth, parentConstraints),
    );
  }

  async #queryLeafRows(
    parentConstraints: Record<string, string>,
    filterPredicate: FilterExpr | null,
  ): Promise<Array<LeafRow>> {
    const {
      table,
      leafColumns,
      additionalWhere,
      leafPageSize = 50,
      leafSelectAll = false,
    } = this.#options;

    if (!leafColumns || leafColumns.length === 0) {
      return [];
    }

    const query = buildLeafRowsQuery({
      table,
      leafColumns,
      parentConstraints,
      filterPredicate,
      additionalWhere: additionalWhere ?? undefined,
      limit: leafPageSize,
      selectAll: leafSelectAll,
    });

    const result = await this.coordinator!.query(query.toString());
    const rawRows = arrowTableToObjects(result);

    return rawRows.map((raw, idx) =>
      this.#toLeafRow(raw, parentConstraints, idx),
    );
  }

  // --- Private: Helpers ---

  #findRowById(rowId: string): ServerGroupedRow | null {
    function search(rows: Array<ServerGroupedRow>): ServerGroupedRow | null {
      for (const row of rows) {
        if (row.id === rowId) {
          return row;
        }
        if (row.type === 'group' && row.subRows) {
          const found = search(row.subRows);
          if (found) {
            return found;
          }
        }
      }
      return null;
    }

    const fromRoot = search(this.#rootRows);
    if (fromRoot) {
      return fromRoot;
    }

    for (const children of this.#childrenCache.values()) {
      const found = search(children);
      if (found) {
        return found;
      }
    }

    return null;
  }

  #setLoadingGroup(groupId: string, loading: boolean): void {
    this.store.setState((prev) => {
      const ids = prev.loadingGroupIds;
      const next = loading
        ? ids.includes(groupId)
          ? ids
          : [...ids, groupId]
        : ids.filter((id) => id !== groupId);
      return { ...prev, loadingGroupIds: next };
    });
  }

  #getFilterPredicate(): FilterExpr | null {
    return (
      (this.#options.filterBy.predicate(null) as FilterExpr | null) ?? null
    );
  }
}
