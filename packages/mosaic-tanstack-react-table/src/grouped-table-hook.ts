/**
 * @file useServerGroupedTable — React hook for server-side hierarchical grouping.
 *
 * Manages lazy-loaded GROUP BY queries at each depth level, assembles the
 * results into a tree structure with `subRows`, and integrates with Mosaic
 * Selections for reactive cross-filtering.
 *
 * Uses the Mosaic Coordinator directly (not MosaicDataTable) to fire queries —
 * the grouped table fires ad-hoc queries at multiple depth levels on user
 * expand, which does not fit MosaicClient's single query()/queryResult() lifecycle.
 * Precedent: `useMosaicValue` already uses `coordinator.query()` directly.
 */
import * as React from 'react';
import { useOptionalCoordinator } from '@nozzleio/react-mosaic';
import {
  arrowTableToObjects,
  buildGroupedLevelQuery,
  buildLeafRowsQuery,
  logger,
} from '@nozzleio/mosaic-tanstack-table-core';
import type {
  Coordinator,
  Selection,
  SelectionClause,
} from '@uwdata/mosaic-core';
import type { FilterExpr } from '@uwdata/mosaic-sql';
import type { ExpandedState, Row } from '@tanstack/react-table';
import type {
  GroupLevel,
  GroupMetric,
  GroupedRow,
  LeafColumn,
} from '@nozzleio/mosaic-tanstack-table-core';

// Re-export types for convenience
export type { GroupLevel, GroupMetric, GroupedRow, LeafColumn };

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface UseServerGroupedTableOptions {
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

  /** Whether the hook is active. Defaults to true. */
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Return Type
// ---------------------------------------------------------------------------

export interface ServerGroupedTableResult {
  /** Tree-structured data for TanStack Table. */
  data: Array<GroupedRow>;

  /** Current expanded state keyed by row ID. */
  expanded: ExpandedState;

  /** Toggle a row's expanded state. Fires child query if needed. */
  toggleExpand: (row: Row<GroupedRow>) => void;

  /** Whether the root query is loading. */
  isRootLoading: boolean;

  /** Total root-level group count. */
  totalRootRows: number;

  /** Clear the current row selection. */
  clearSelection: () => void;

  /** Leaf columns configuration (if any). */
  leafColumns?: Array<LeafColumn>;

  /** Table name for detail panel queries. */
  tableName: string;

  /** Additional WHERE clause for detail panel queries. */
  additionalWhere?: FilterExpr | null;

  /** Filter selection for detail panel queries. */
  filterBy: Selection;
}

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

  // Check if this is the deepest group level
  const isDeepestLevel = depth === groupBy.length - 1;

  // Row is expandable if:
  // - depth < groupBy.length - 1 (more group levels below), OR
  // - depth === groupBy.length - 1 AND we have leafColumns (can expand to detail panel)
  const isGroup = !isDeepestLevel || hasLeafColumns;

  // Deepest level with leafColumns shows a detail panel instead of subRows
  const hasDetailPanel = isDeepestLevel && hasLeafColumns;

  // Build the group ID by concatenating parent chain + own value
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

  // Group rows (not detail panel rows) get an empty subRows placeholder
  // so TanStack knows they're expandable. Detail panel rows expand inline.
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
  // Build unique ID from parent chain + row index (or unique_key if available)
  const parentChain = Object.values(parentValues);
  const uniqueId = raw.unique_key ?? `row_${index}`;
  const groupId =
    parentChain.length > 0
      ? `${parentChain.join('|')}|_leaf_${uniqueId}`
      : `_leaf_${uniqueId}`;

  let leafValues: Record<string, unknown>;
  if (selectAll) {
    // Copy all columns from the raw result
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
// Hook
// ---------------------------------------------------------------------------

export function useServerGroupedTable(
  options: UseServerGroupedTableOptions,
): ServerGroupedTableResult {
  const {
    table,
    groupBy,
    metrics,
    filterBy,
    rowSelection,
    additionalWhere,
    pageSize = 200,
    leafColumns,
    leafPageSize = 50,
    leafSelectAll = false,
    enabled = true,
  } = options;

  const hasLeafColumns = !!leafColumns && leafColumns.length > 0;

  const coordinator = useOptionalCoordinator();

  // --- State ---
  const [rootRows, setRootRows] = React.useState<Array<GroupedRow>>([]);
  const [isRootLoading, setIsRootLoading] = React.useState(false);
  const [expanded, setExpanded] = React.useState<ExpandedState>(
    {} as ExpandedState,
  );

  // Children cache: parentGroupId → child rows
  const childrenCacheRef = React.useRef<Map<string, Array<GroupedRow>>>(
    new Map(),
  );
  // Loading state for individual groups
  const [loadingGroups, setLoadingGroups] = React.useState<Set<string>>(
    new Set(),
  );

  // Request generation counter for stale-response detection
  const generationRef = React.useRef(0);

  // Keep a ref to the latest expanded state so callbacks can read it
  // without needing `expanded` in their dependency arrays.
  const expandedRef = React.useRef(expanded);
  expandedRef.current = expanded;

  // --- Query helpers ---

  const queryLevel = React.useCallback(
    async (
      coord: Coordinator,
      depth: number,
      parentConstraints: Record<string, string>,
      filterPredicate: FilterExpr | null,
    ): Promise<Array<GroupedRow>> => {
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

      const result = await coord.query(query.toString());
      const rawRows = arrowTableToObjects(result);

      return rawRows.map((raw) =>
        toGroupedRow(
          raw,
          groupBy,
          metrics,
          depth,
          parentConstraints,
          hasLeafColumns,
        ),
      );
    },
    [table, groupBy, metrics, additionalWhere, pageSize, hasLeafColumns],
  );

  /** Query raw leaf rows (no GROUP BY) for detail panel expansion. */
  const queryLeafRows = React.useCallback(
    async (
      coord: Coordinator,
      parentConstraints: Record<string, string>,
      filterPredicate: FilterExpr | null,
    ): Promise<Array<GroupedRow>> => {
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

      const result = await coord.query(query.toString());
      const rawRows = arrowTableToObjects(result);
      const leafDepth = groupBy.length; // One deeper than the last group level

      return rawRows.map((raw, idx) =>
        toLeafRow(
          raw,
          leafColumns,
          leafDepth,
          parentConstraints,
          idx,
          leafSelectAll,
        ),
      );
    },
    [
      table,
      leafColumns,
      additionalWhere,
      leafPageSize,
      leafSelectAll,
      groupBy.length,
    ],
  );

  // --- Root query + re-query expanded children on filter change ---

  const fetchAll = React.useCallback(async () => {
    if (!coordinator || !enabled) {
      return;
    }

    const gen = ++generationRef.current;
    setIsRootLoading(true);

    try {
      const filterPredicate =
        (filterBy.predicate(null) as FilterExpr | null) ?? null;

      // 1. Query root level
      const roots = await queryLevel(coordinator, 0, {}, filterPredicate);
      if (gen !== generationRef.current) {
        return;
      } // stale

      // Build set of valid root IDs for pruning
      const validRootIds = new Set(roots.map((r) => r._groupId));

      // 2. Re-query all currently expanded groups in parallel
      const expandedKeys = getExpandedKeys(expandedRef.current);

      // Collect expand queries (only for non-detail-panel rows)
      const expandQueries: Array<{
        parentId: string;
        depth: number;
        constraints: Record<string, string>;
      }> = [];

      for (const key of expandedKeys) {
        // Skip leaf row entries (they have _leaf_ in the ID)
        if (key.includes('_leaf_')) {
          continue;
        }

        // Parse from the key: root rows have depth 0, children have depth 1+
        const segments = key.split('|');
        const depth = segments.length - 1;

        // Detail panel rows (deepest level with leafColumns) don't have children to re-query
        const isDetailPanelRow = depth === groupBy.length - 1 && hasLeafColumns;
        if (isDetailPanelRow) {
          continue;
        }

        // Check if this row has more group levels below
        if (depth >= groupBy.length - 1) {
          continue;
        }

        // Build parent constraints from the key segments
        const constraints: Record<string, string> = {};
        for (let i = 0; i <= depth; i++) {
          constraints[groupBy[i]!.column] = segments[i]!;
        }

        // Verify parent chain is still valid (root must exist)
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
            const children = await queryLevel(
              coordinator,
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

      if (gen !== generationRef.current) {
        return;
      } // stale

      // 3. Update caches
      const newCache = new Map<string, Array<GroupedRow>>();
      for (const { parentId, children } of childResults) {
        newCache.set(parentId, children);
      }
      childrenCacheRef.current = newCache;

      // 4. Prune expanded state — remove entries whose roots no longer exist
      setExpanded((prev: ExpandedState): ExpandedState => {
        if (prev === true) {
          return prev;
        }
        const pruned: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(prev)) {
          const rootSegment = k.split('|')[0]!;
          if (v && validRootIds.has(rootSegment)) {
            pruned[k] = true;
          }
        }
        return pruned;
      });

      setRootRows(roots);
    } catch (e) {
      logger.warn('Grouped', 'Root query failed', { error: e });
    } finally {
      if (gen === generationRef.current) {
        setIsRootLoading(false);
      }
    }
  }, [coordinator, enabled, filterBy, queryLevel, groupBy, hasLeafColumns]);

  // Initial fetch + re-fetch on filter changes
  React.useEffect(() => {
    if (!coordinator || !enabled) {
      return;
    }

    fetchAll();

    const cb = () => fetchAll();
    filterBy.addEventListener('value', cb);
    return () => filterBy.removeEventListener('value', cb);
  }, [coordinator, enabled, filterBy, queryLevel, groupBy, hasLeafColumns]); // eslint-disable-line -- fetchAll intentionally excluded to avoid re-subscribing on every render

  // --- Expand/Collapse ---

  const toggleExpand = React.useCallback(
    async (row: Row<GroupedRow>) => {
      const rowData = row.original;
      const groupId = rowData._groupId;

      // Collapse
      if (isKeyExpanded(expandedRef.current, row.id)) {
        setExpanded((prev: ExpandedState): ExpandedState => {
          if (prev === true) {
            return {};
          }
          const next = { ...prev };
          delete next[row.id];
          // Also collapse any children of this group
          for (const k of Object.keys(next)) {
            if (k.startsWith(groupId + '|')) {
              delete next[k];
            }
          }
          return next;
        });

        // If the selection was on a child of this group, clear it
        if (rowSelection?.selection) {
          const currentVal = rowSelection.selection
            .value as Array<string> | null;
          if (
            currentVal &&
            currentVal.some((v) => v.startsWith(groupId + '|') && v !== groupId)
          ) {
            rowSelection.selection.update({
              source: GROUPED_TABLE_SOURCE,
              value: null,
              predicate: null,
            } as SelectionClause);
          }
        }
        return;
      }

      // Detail panel rows: fetch leaf rows (individual data) on expand
      if (rowData._hasDetailPanel) {
        if (!childrenCacheRef.current.has(groupId)) {
          if (!coordinator) {
            return;
          }
          setLoadingGroups((prev) => new Set(prev).add(groupId));

          try {
            const filterPredicate =
              (filterBy.predicate(null) as FilterExpr | null) ?? null;

            // Build constraints from this row's ancestry + own value
            const constraints: Record<string, string> = {
              ...rowData._parentValues,
              [rowData._groupColumn]: rowData._groupValue,
            };

            const leaves = await queryLeafRows(
              coordinator,
              constraints,
              filterPredicate,
            );

            childrenCacheRef.current.set(groupId, leaves);
          } catch (e) {
            logger.warn('Grouped', `Failed to load leaf rows for ${groupId}`, {
              error: e,
            });
            childrenCacheRef.current.set(groupId, []);
          } finally {
            setLoadingGroups((prev) => {
              const next = new Set(prev);
              next.delete(groupId);
              return next;
            });
          }
        }

        setExpanded((prev: ExpandedState): ExpandedState => {
          if (prev === true) {
            return { [row.id]: true };
          }
          return { ...prev, [row.id]: true };
        });
        return;
      }

      // Expand — check if we need to fetch children
      if (!childrenCacheRef.current.has(groupId)) {
        if (!coordinator) {
          return;
        }
        setLoadingGroups((prev) => new Set(prev).add(groupId));

        try {
          const filterPredicate =
            (filterBy.predicate(null) as FilterExpr | null) ?? null;

          // Build constraints from this row's ancestry + own value
          const constraints: Record<string, string> = {
            ...rowData._parentValues,
            [rowData._groupColumn]: rowData._groupValue,
          };

          const children = await queryLevel(
            coordinator,
            rowData._depth + 1,
            constraints,
            filterPredicate,
          );

          childrenCacheRef.current.set(groupId, children);
        } catch (e) {
          logger.warn('Grouped', `Failed to load children for ${groupId}`, {
            error: e,
          });
          childrenCacheRef.current.set(groupId, []);
        } finally {
          setLoadingGroups((prev) => {
            const next = new Set(prev);
            next.delete(groupId);
            return next;
          });
        }
      }

      // Mark as expanded
      setExpanded((prev: ExpandedState): ExpandedState => {
        if (prev === true) {
          return { [row.id]: true };
        }
        return { ...prev, [row.id]: true };
      });
    },
    [filterBy, coordinator, queryLevel, queryLeafRows, rowSelection?.selection],
  );

  // --- Row Selection (cross-filter) ---

  const clearSelection = React.useCallback(() => {
    if (rowSelection?.selection) {
      rowSelection.selection.update({
        source: GROUPED_TABLE_SOURCE,
        value: null,
        predicate: null,
      } as SelectionClause);
    }
  }, [rowSelection?.selection]);

  // --- Tree Assembly ---

  const data = React.useMemo((): Array<GroupedRow> => {
    const cache = childrenCacheRef.current;

    function attachChildren(rows: Array<GroupedRow>): Array<GroupedRow> {
      return rows.map((row) => {
        if (!row._isGroup) {
          return row;
        }

        const cachedChildren = cache.get(row._groupId);
        const isLoading = loadingGroups.has(row._groupId);

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
          // Keep empty subRows so TanStack shows expand toggle
          subRows: [],
        };
      });
    }

    return attachChildren(rootRows);
    // expanded is intentionally included as a trigger — when expand state changes,
    // we need to rebuild the tree to pick up newly-cached children from the ref.
    // eslint-disable-next-line -- expanded is an intentional trigger dependency
  }, [rootRows, expanded, loadingGroups]);

  return {
    data,
    expanded,
    toggleExpand,
    isRootLoading,
    totalRootRows: rootRows.length,
    clearSelection,
    leafColumns,
    tableName: table,
    additionalWhere,
    filterBy,
  };
}
