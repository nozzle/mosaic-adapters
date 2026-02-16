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
 * expand, which does not fit MosaicClient's single query/queryResult() lifecycle.
 */
import { Store, batch } from '@tanstack/store';
import { arrowTableToObjects } from './arrow-utils';
import { buildGroupedLevelQuery, buildLeafRowsQuery } from './query-builder';
import { logger } from '../logger';
import type { Coordinator, Selection, SelectionClause } from '@uwdata/mosaic-core';
import type { FilterExpr } from '@uwdata/mosaic-sql';
import type { ExpandedState } from '@tanstack/table-core';
import type {
  GroupLevel,
  GroupMetric,
  GroupRow,
  LeafColumn,
  LeafRow,
  ServerGroupedRow,
} from './types';
import { GROUP_ID_SEPARATOR } from './types';

// ---------------------------------------------------------------------------
// Stable source identity for Mosaic Selection updates
// ---------------------------------------------------------------------------

const GROUPED_TABLE_SOURCE = { id: 'server-grouped-table' };

// ---------------------------------------------------------------------------
// Internal metadata — NOT stored on rows, NOT in Store
// ---------------------------------------------------------------------------

interface RowMeta {
  depth: number;
  groupColumn: string;
  groupValue: string;
  parentConstraints: Record<string, string>;
  isGroup: boolean;
  hasDetailPanel: boolean;
}

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

export class MosaicGroupedTable {
  readonly store: Store<MosaicGroupedTableState>;

  #childrenCache: Map<string, Array<ServerGroupedRow>> = new Map();
  #rootRows: Array<ServerGroupedRow> = [];
  #rowMeta: Map<string, RowMeta> = new Map();
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
          for (const k of Object.keys(
            nextExpanded as Record<string, boolean>,
          )) {
            if (k.startsWith(rowId + GROUP_ID_SEPARATOR)) {
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
          currentVal.some(
            (v) => v.startsWith(rowId + GROUP_ID_SEPARATOR) && v !== rowId,
          )
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

    // Find metadata to determine row type
    const meta = this.#rowMeta.get(rowId);
    if (!meta) {
      return;
    }

    if (meta.hasDetailPanel) {
      this.#expandDetailPanel(rowId, meta);
    } else {
      this.#expandGroup(rowId, meta);
    }
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

  // --- Private methods ---

  async #expandDetailPanel(rowId: string, meta: RowMeta): Promise<void> {
    if (!this.#childrenCache.has(rowId)) {
      if (!this.#coordinator) {
        return;
      }

      this.#setLoadingGroup(rowId, true);

      try {
        const filterPredicate = this.#getFilterPredicate();
        const constraints: Record<string, string> = {
          ...meta.parentConstraints,
          [meta.groupColumn]: meta.groupValue,
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

  async #expandGroup(rowId: string, meta: RowMeta): Promise<void> {
    if (!this.#childrenCache.has(rowId)) {
      if (!this.#coordinator) {
        return;
      }

      this.#setLoadingGroup(rowId, true);

      try {
        const filterPredicate = this.#getFilterPredicate();
        const constraints: Record<string, string> = {
          ...meta.parentConstraints,
          [meta.groupColumn]: meta.groupValue,
        };

        const children = await this.#queryLevel(
          meta.depth + 1,
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
      const validRootIds = new Set(roots.map((r) => r.id));

      // 2. Re-query all currently expanded groups in parallel
      const expandedKeys = getExpandedKeys(this.store.state.expanded);

      const expandQueries: Array<{
        parentId: string;
        depth: number;
        constraints: Record<string, string>;
      }> = [];

      for (const key of expandedKeys) {
        // Skip leaf row entries
        if (key.includes('_leaf_')) {
          continue;
        }

        const meta = this.#rowMeta.get(key);
        if (!meta) {
          // Row may come from a previous generation — try to parse from ID segments
          const segments = key.split(GROUP_ID_SEPARATOR);
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
          continue;
        }

        if (meta.hasDetailPanel) {
          continue;
        }
        if (!meta.isGroup) {
          continue;
        }

        // Verify root is still valid
        const rootSegment = key.split(GROUP_ID_SEPARATOR)[0]!;
        if (!validRootIds.has(rootSegment)) {
          continue;
        }

        const constraints: Record<string, string> = {
          ...meta.parentConstraints,
          [meta.groupColumn]: meta.groupValue,
        };

        expandQueries.push({
          parentId: key,
          depth: meta.depth + 1,
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
            return { parentId: eq.parentId, children: [] as ServerGroupedRow[] };
          }
        }),
      );

      if (gen !== this.#generation) {
        return;
      }

      // 3. Update caches
      const newCache = new Map<string, Array<ServerGroupedRow>>();
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
          const rootSegment = k.split(GROUP_ID_SEPARATOR)[0]!;
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
    const rowMeta = this.#rowMeta;

    function attachChildren(rows: Array<ServerGroupedRow>): Array<ServerGroupedRow> {
      return rows.map((row) => {
        if (row.type === 'leaf') {
          return row;
        }

        // row is GroupRow — meta was populated at query time
        const meta = rowMeta.get(row.id);
        const cachedChildren = cache.get(row.id);

        if (cachedChildren && cachedChildren.length > 0) {
          return {
            ...row,
            subRows: attachChildren(cachedChildren),
          } as GroupRow;
        }

        // Keep empty subRows so TanStack shows expand toggle for expandable rows
        if (meta?.isGroup || meta?.hasDetailPanel) {
          return {
            ...row,
            subRows: [] as ServerGroupedRow[],
          } as GroupRow;
        }

        return row;
      });
    }

    const treeData = attachChildren(this.#rootRows);
    this.store.setState((prev) => ({ ...prev, treeData }));
  }

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
    const isGroup = !isDeepestLevel || hasLeafColumns;
    const hasDetailPanel = isDeepestLevel && hasLeafColumns;

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

    // Store metadata internally
    this.#rowMeta.set(id, {
      depth,
      groupColumn: level.column,
      groupValue: value,
      parentConstraints: { ...parentConstraints },
      isGroup,
      hasDetailPanel,
    });

    const row: GroupRow = {
      type: 'group',
      id,
      groupValue: value,
      metrics: metricsRecord,
    };

    // Group rows (not detail panel) get empty subRows so TanStack shows expand toggle
    if (isGroup && !hasDetailPanel) {
      row.subRows = [];
    }

    return row;
  }

  #toLeafRow(
    raw: Record<string, unknown>,
    parentConstraints: Record<string, string>,
    index: number,
  ): LeafRow {
    const { leafColumns = [], leafSelectAll = false, groupBy } = this.#options;

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

    const leafDepth = groupBy.length;

    // Store metadata internally
    this.#rowMeta.set(id, {
      depth: leafDepth,
      groupColumn: '',
      groupValue: '',
      parentConstraints: { ...parentConstraints },
      isGroup: false,
      hasDetailPanel: false,
    });

    return {
      type: 'leaf',
      id,
      values,
    };
  }

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

    const result = await this.#coordinator!.query(query.toString());
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

    const result = await this.#coordinator!.query(query.toString());
    const rawRows = arrowTableToObjects(result);

    return rawRows.map((raw, idx) =>
      this.#toLeafRow(raw, parentConstraints, idx),
    );
  }

  #getFilterPredicate(): FilterExpr | null {
    return (
      (this.#options.filterBy.predicate(null) as FilterExpr | null) ?? null
    );
  }
}
