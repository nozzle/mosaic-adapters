/**
 * @file MosaicGroupedTable — framework-agnostic core class for server-side
 * hierarchical grouping.
 *
 * Manages lazy-loaded GROUP BY queries at each depth level, assembles the
 * results into a tree structure with `subRows`, and integrates with Mosaic
 * Selections for reactive cross-filtering.
 *
 * Uses the Mosaic Coordinator directly (not MosaicClient) to fire queries —
 * the grouped table fires ad-hoc queries at multiple depth levels on user
 * expand, which does not fit MosaicClient's single query()/queryResult() lifecycle.
 */
import { Store, batch } from '@tanstack/store';
import { arrowTableToObjects } from './arrow-utils';
import { buildGroupedLevelQuery, buildLeafRowsQuery } from './query-builder';
import { logger } from '../logger';
import type { Coordinator, Selection, SelectionClause } from '@uwdata/mosaic-core';
import type { FilterExpr } from '@uwdata/mosaic-sql';
import type { ExpandedState } from '@tanstack/table-core';
import type { GroupLevel, GroupMetric, GroupedRow, LeafColumn } from './types';

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

/** Build a GroupedRow from a raw query result row. */
function toGroupedRow(
  raw: Record<string, unknown>,
  groupBy: Array<GroupLevel>,
  metrics: Array<GroupMetric>,
  depth: number,
  parentValues: Record<string, string>,
  hasLeafColumns: boolean,
): GroupedRow {
  const level = groupBy[depth]!;
  const value = String(raw[level.column] ?? '');

  const isDeepestLevel = depth === groupBy.length - 1;
  const isGroup = !isDeepestLevel || hasLeafColumns;
  const hasDetailPanel = isDeepestLevel && hasLeafColumns;

  const parentChain = Object.values(parentValues);
  const groupId =
    parentChain.length > 0 ? `${parentChain.join('|')}|${value}` : value;

  const metricsRecord: Record<string, number> = {};
  for (const metric of metrics) {
    const rawVal = raw[metric.id];
    metricsRecord[metric.id] = typeof rawVal === 'number' ? rawVal : 0;
  }

  const row: GroupedRow = {
    _groupId: groupId,
    _depth: depth,
    _isGroup: isGroup,
    _isLeafRow: false,
    _hasDetailPanel: hasDetailPanel,
    _groupColumn: level.column,
    _groupValue: value,
    _parentValues: { ...parentValues },
    _childrenLoaded: false,
    _isLoading: false,
    metrics: metricsRecord,
  };

  if (isGroup && !hasDetailPanel) {
    row.subRows = [];
  }

  return row;
}

/** Build a leaf row (raw data) from a query result. */
function toLeafRow(
  raw: Record<string, unknown>,
  leafColumns: Array<LeafColumn>,
  depth: number,
  parentValues: Record<string, string>,
  index: number,
  selectAll: boolean,
): GroupedRow {
  const parentChain = Object.values(parentValues);
  const uniqueId = raw.unique_key ?? `row_${index}`;
  const groupId =
    parentChain.length > 0
      ? `${parentChain.join('|')}|_leaf_${uniqueId}`
      : `_leaf_${uniqueId}`;

  let leafValues: Record<string, unknown>;
  if (selectAll) {
    leafValues = { ...raw };
  } else {
    leafValues = {};
    for (const col of leafColumns) {
      leafValues[col.column] = raw[col.column];
    }
  }

  return {
    _groupId: groupId,
    _depth: depth,
    _isGroup: false,
    _isLeafRow: true,
    _hasDetailPanel: false,
    _groupColumn: '',
    _groupValue: '',
    _parentValues: { ...parentValues },
    _childrenLoaded: false,
    _isLoading: false,
    metrics: {},
    leafValues,
  };
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
   * All result columns are available in `leafValues`.
   */
  leafSelectAll?: boolean;
}

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

export interface MosaicGroupedTableState {
  treeData: Array<GroupedRow>;
  expanded: ExpandedState;
  isRootLoading: boolean;
  totalRootRows: number;
  loadingGroupIds: Array<string>;
}

// ---------------------------------------------------------------------------
// Core class
// ---------------------------------------------------------------------------

export class MosaicGroupedTable {
  readonly store: Store<MosaicGroupedTableState>;

  #childrenCache: Map<string, Array<GroupedRow>> = new Map();
  #rootRows: Array<GroupedRow> = [];
  #generation = 0;
  #coordinator: Coordinator | null = null;
  #options: MosaicGroupedTableOptions;
  #cleanupListener: (() => void) | null = null;
  #connected = false;

  constructor(options: MosaicGroupedTableOptions) {
    this.#options = options;
    this.store = new Store<MosaicGroupedTableState>({
      treeData: [],
      expanded: {} as ExpandedState,
      isRootLoading: false,
      totalRootRows: 0,
      loadingGroupIds: [],
    });
  }

  // --- Public API ---

  setCoordinator(coord: Coordinator | null): void {
    this.#coordinator = coord;
  }

  updateOptions(options: MosaicGroupedTableOptions): void {
    const filterByChanged = options.filterBy !== this.#options.filterBy;
    this.#options = options;

    if (filterByChanged && this.#connected) {
      this.disconnect();
      this.connect();
    } else if (this.#connected) {
      // Re-fetch with new options (table, groupBy, metrics changed, etc.)
      this.#childrenCache.clear();
      this.#fetchAll();
    }
  }

  connect(): () => void {
    this.#connected = true;

    this.#fetchAll();

    const cb = () => this.#fetchAll();
    this.#options.filterBy.addEventListener('value', cb);
    this.#cleanupListener = () => {
      this.#options.filterBy.removeEventListener('value', cb);
    };

    return () => this.disconnect();
  }

  disconnect(): void {
    this.#connected = false;
    if (this.#cleanupListener) {
      this.#cleanupListener();
      this.#cleanupListener = null;
    }
  }

  toggleExpand(rowId: string): void {
    const { expanded } = this.store.state;

    // Collapse
    if (isKeyExpanded(expanded, rowId)) {
      batch(() => {
        this.store.setState((prev) => {
          const nextExpanded =
            prev.expanded === true ? {} : { ...prev.expanded };
          delete (nextExpanded as Record<string, boolean>)[rowId];
          // Also collapse any children of this group
          for (const k of Object.keys(
            nextExpanded as Record<string, boolean>,
          )) {
            if (k.startsWith(rowId + '|')) {
              delete (nextExpanded as Record<string, boolean>)[k];
            }
          }
          return { ...prev, expanded: nextExpanded };
        });
      });

      // If the selection was on a child of this group, clear it
      if (this.#options.rowSelection?.selection) {
        const sel = this.#options.rowSelection.selection;
        const currentVal = sel.value as Array<string> | null;
        if (
          currentVal &&
          currentVal.some((v) => v.startsWith(rowId + '|') && v !== rowId)
        ) {
          sel.update({
            source: GROUPED_TABLE_SOURCE,
            value: null,
            predicate: null,
          } as SelectionClause);
        }
      }

      this.#rebuildTree();
      return;
    }

    // Find the row data from rootRows or cache to determine its type
    const rowData = this.#findRow(rowId);
    if (!rowData) {
      return;
    }

    // Detail panel rows or regular expand
    if (rowData._hasDetailPanel) {
      this.#expandDetailPanel(rowId, rowData);
    } else {
      this.#expandGroup(rowId, rowData);
    }
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

  // --- Private methods ---

  #findRow(rowId: string): GroupedRow | undefined {
    // Search root rows first
    for (const row of this.#rootRows) {
      if (row._groupId === rowId) {
        return row;
      }
    }
    // Search cached children
    for (const children of this.#childrenCache.values()) {
      for (const child of children) {
        if (child._groupId === rowId) {
          return child;
        }
      }
    }
    return undefined;
  }

  async #expandDetailPanel(rowId: string, rowData: GroupedRow): Promise<void> {
    if (!this.#childrenCache.has(rowId)) {
      if (!this.#coordinator) {
        return;
      }

      this.#setLoadingGroup(rowId, true);

      try {
        const filterPredicate = this.#getFilterPredicate();
        const constraints: Record<string, string> = {
          ...rowData._parentValues,
          [rowData._groupColumn]: rowData._groupValue,
        };

        const leaves = await this.#queryLeafRows(constraints, filterPredicate);
        this.#childrenCache.set(rowId, leaves);
      } catch (e) {
        logger.warn('Grouped', `Failed to load leaf rows for ${rowId}`, {
          error: e,
        });
        this.#childrenCache.set(rowId, []);
      } finally {
        this.#setLoadingGroup(rowId, false);
      }
    }

    this.store.setState((prev) => ({
      ...prev,
      expanded:
        prev.expanded === true
          ? { [rowId]: true }
          : { ...(prev.expanded as Record<string, boolean>), [rowId]: true },
    }));
    this.#rebuildTree();
  }

  async #expandGroup(rowId: string, rowData: GroupedRow): Promise<void> {
    if (!this.#childrenCache.has(rowId)) {
      if (!this.#coordinator) {
        return;
      }

      this.#setLoadingGroup(rowId, true);

      try {
        const filterPredicate = this.#getFilterPredicate();
        const constraints: Record<string, string> = {
          ...rowData._parentValues,
          [rowData._groupColumn]: rowData._groupValue,
        };

        const children = await this.#queryLevel(
          rowData._depth + 1,
          constraints,
          filterPredicate,
        );
        this.#childrenCache.set(rowId, children);
      } catch (e) {
        logger.warn('Grouped', `Failed to load children for ${rowId}`, {
          error: e,
        });
        this.#childrenCache.set(rowId, []);
      } finally {
        this.#setLoadingGroup(rowId, false);
      }
    }

    this.store.setState((prev) => ({
      ...prev,
      expanded:
        prev.expanded === true
          ? { [rowId]: true }
          : { ...(prev.expanded as Record<string, boolean>), [rowId]: true },
    }));
    this.#rebuildTree();
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
    this.#rebuildTree();
  }

  async #fetchAll(): Promise<void> {
    if (!this.#coordinator || !this.#connected) {
      return;
    }

    const gen = ++this.#generation;
    this.store.setState((prev) => ({ ...prev, isRootLoading: true }));

    try {
      const filterPredicate = this.#getFilterPredicate();
      const { groupBy } = this.#options;
      const hasLeafColumns =
        !!this.#options.leafColumns && this.#options.leafColumns.length > 0;

      // 1. Query root level
      const roots = await this.#queryLevel(0, {}, filterPredicate);
      if (gen !== this.#generation) {
        return;
      }

      // Build set of valid root IDs for pruning
      const validRootIds = new Set(roots.map((r) => r._groupId));

      // 2. Re-query all currently expanded groups in parallel
      const expandedKeys = getExpandedKeys(this.store.state.expanded);

      const expandQueries: Array<{
        parentId: string;
        depth: number;
        constraints: Record<string, string>;
      }> = [];

      for (const key of expandedKeys) {
        if (key.includes('_leaf_')) {
          continue;
        }

        const segments = key.split('|');
        const depth = segments.length - 1;

        const isDetailPanelRow =
          depth === groupBy.length - 1 && hasLeafColumns;
        if (isDetailPanelRow) {
          continue;
        }

        if (depth >= groupBy.length - 1) {
          continue;
        }

        const constraints: Record<string, string> = {};
        for (let i = 0; i <= depth; i++) {
          constraints[groupBy[i]!.column] = segments[i]!;
        }

        if (!validRootIds.has(segments[0]!)) {
          continue;
        }

        expandQueries.push({
          parentId: key,
          depth: depth + 1,
          constraints,
        });
      }

      // Fire all child queries in parallel
      const childResults = await Promise.all(
        expandQueries.map(async (eq) => {
          try {
            const children = await this.#queryLevel(
              eq.depth,
              eq.constraints,
              filterPredicate,
            );
            return { parentId: eq.parentId, children };
          } catch {
            return { parentId: eq.parentId, children: [] };
          }
        }),
      );

      if (gen !== this.#generation) {
        return;
      }

      // 3. Update caches
      const newCache = new Map<string, Array<GroupedRow>>();
      for (const { parentId, children } of childResults) {
        newCache.set(parentId, children);
      }
      this.#childrenCache = newCache;

      // 4. Prune expanded state
      const prevExpanded = this.store.state.expanded;
      let prunedExpanded: ExpandedState = prevExpanded;
      if (prevExpanded !== true) {
        const pruned: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(prevExpanded)) {
          const rootSegment = k.split('|')[0]!;
          if (v && validRootIds.has(rootSegment)) {
            pruned[k] = true;
          }
        }
        prunedExpanded = pruned;
      }

      this.#rootRows = roots;

      batch(() => {
        this.store.setState((prev) => ({
          ...prev,
          expanded: prunedExpanded,
          totalRootRows: roots.length,
          isRootLoading: false,
        }));
      });

      this.#rebuildTree();
    } catch (e) {
      logger.warn('Grouped', 'Root query failed', { error: e });
      if (gen === this.#generation) {
        this.store.setState((prev) => ({ ...prev, isRootLoading: false }));
      }
    }
  }

  #rebuildTree(): void {
    const cache = this.#childrenCache;
    const loadingGroupIds = this.store.state.loadingGroupIds;

    function attachChildren(rows: Array<GroupedRow>): Array<GroupedRow> {
      return rows.map((row) => {
        if (!row._isGroup) {
          return row;
        }

        const cachedChildren = cache.get(row._groupId);
        const isLoading = loadingGroupIds.includes(row._groupId);

        if (cachedChildren && cachedChildren.length > 0) {
          return {
            ...row,
            _childrenLoaded: true,
            _isLoading: false,
            subRows: attachChildren(cachedChildren),
          };
        }

        return {
          ...row,
          _childrenLoaded: !!cachedChildren,
          _isLoading: isLoading,
          subRows: [],
        };
      });
    }

    const treeData = attachChildren(this.#rootRows);
    this.store.setState((prev) => ({ ...prev, treeData }));
  }

  async #queryLevel(
    depth: number,
    parentConstraints: Record<string, string>,
    filterPredicate: FilterExpr | null,
  ): Promise<Array<GroupedRow>> {
    const {
      table,
      groupBy,
      metrics,
      additionalWhere,
      pageSize = 200,
      leafColumns,
    } = this.#options;
    const hasLeafColumns = !!leafColumns && leafColumns.length > 0;

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

    const result = await this.#coordinator!.query(query.toString());
    const rawRows = arrowTableToObjects(result);

    return rawRows.map((raw) =>
      toGroupedRow(raw, groupBy, metrics, depth, parentConstraints, hasLeafColumns),
    );
  }

  async #queryLeafRows(
    parentConstraints: Record<string, string>,
    filterPredicate: FilterExpr | null,
  ): Promise<Array<GroupedRow>> {
    const {
      table,
      leafColumns,
      additionalWhere,
      leafPageSize = 50,
      leafSelectAll = false,
      groupBy,
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

    const result = await this.#coordinator!.query(query.toString());
    const rawRows = arrowTableToObjects(result);
    const leafDepth = groupBy.length;

    return rawRows.map((raw, idx) =>
      toLeafRow(raw, leafColumns, leafDepth, parentConstraints, idx, leafSelectAll),
    );
  }

  #getFilterPredicate(): FilterExpr | null {
    return (
      (this.#options.filterBy.predicate(null) as FilterExpr | null) ?? null
    );
  }
}
