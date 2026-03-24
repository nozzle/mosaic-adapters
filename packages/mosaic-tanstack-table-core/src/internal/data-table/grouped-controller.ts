import { getCoreRowModel, getExpandedRowModel } from '@tanstack/table-core';
import { ReadonlyStore, batch } from '@tanstack/store';
import { logger } from '../../logger';
import { arrowTableToObjects } from '../../grouped/arrow-utils';
import { createGroupedTableFeature } from '../../grouped/feature';
import {
  buildGroupedLevelQuery,
  buildLeafRowsQuery,
} from '../../grouped/query-builder';
import { GROUP_ID_SEPARATOR } from '../../grouped/types';
import { createMosaicFeature } from '../../feature';
import { functionalUpdate } from '../../utils';

import type { MosaicDataTable } from '../../data-table';
import type { MosaicDataTableStore, PrimitiveSqlValue } from '../../types';
import type { FilterExpr } from '@uwdata/mosaic-sql';
import type {
  ColumnDef,
  ExpandedState,
  RowData,
  TableOptions,
  Updater,
} from '@tanstack/table-core';
import type { FlatGroupedRow } from '../../grouped/types';

function getExpandedKeys(state: ExpandedState): Array<string> {
  if (state === true) {
    return [];
  }

  return Object.entries(state)
    .filter(([, isExpanded]) => isExpanded)
    .map(([key]) => key);
}

function isKeyExpanded(state: ExpandedState, key: string): boolean {
  if (state === true) {
    return true;
  }

  return !!state[key];
}

function findNewlyExpandedKeys(
  previousExpanded: ExpandedState,
  nextExpanded: ExpandedState,
): Array<string> {
  if (nextExpanded === true) {
    return [];
  }

  const nextKeys = getExpandedKeys(nextExpanded);
  return nextKeys.filter((key) => !isKeyExpanded(previousExpanded, key));
}

export class GroupedTableController<
  TData extends RowData,
  TValue extends PrimitiveSqlValue = PrimitiveSqlValue,
> {
  readonly groupedStore = new ReadonlyStore<
    MosaicDataTableStore<TData, TValue>['_grouped']
  >(() => this.client.store.state._grouped);

  #childrenCache = new Map<string, Array<FlatGroupedRow>>();
  #groupedRootRows: Array<FlatGroupedRow> = [];
  #autoLeafColumnDefs: Array<ColumnDef<TData, any>> = [];

  constructor(private readonly client: MosaicDataTable<TData, TValue>) {}

  reset(): void {
    this.#childrenCache.clear();
    this.#groupedRootRows = [];
    this.#autoLeafColumnDefs = [];
  }

  handleQueryError(): void {
    batch(() => {
      this.client.store.setState((previousState) => ({
        ...previousState,
        _grouped: { ...previousState._grouped, isRootLoading: false },
      }));
    });
  }

  handleQueryResult(table: unknown): void {
    const rawRows = arrowTableToObjects(table);
    this.#groupedRootRows = rawRows.map((raw) =>
      this.#toFlatGroupedRow(raw, 0, {}),
    );

    batch(() => {
      this.client.store.setState((previousState) => ({
        ...previousState,
        _grouped: {
          ...previousState._grouped,
          isRootLoading: false,
          totalRootRows: this.#groupedRootRows.length,
        },
      }));
    });

    void this.#refreshExpandedChildren();
    this.#rebuildGroupedTree();
  }

  getTableOptions(
    state: MosaicDataTableStore<TData, TValue>,
  ): TableOptions<TData> {
    const groupBy = this.client.options.groupBy!;
    const userFeatures = Array.isArray(state.tableOptions._features)
      ? state.tableOptions._features
      : [];
    const features = [
      ...userFeatures,
      createMosaicFeature(this.client),
      createGroupedTableFeature(this.client),
    ];
    const columns =
      this.#autoLeafColumnDefs.length > 0
        ? ([...state.columnDefs, ...this.#autoLeafColumnDefs] as Array<
            ColumnDef<TData, any>
          >)
        : state.columnDefs;

    const alwaysVisibleKeys = new Set([
      ...groupBy.metrics.map((metric) => metric.id),
      ...groupBy.levels.map((level) => level.column),
    ]);

    const leafVisible = this.#hasExpandedLeafRows();
    const columnVisibility: Record<string, boolean> = {};
    for (const column of columns) {
      const accessorKey = (
        column as ColumnDef<TData, any> & { accessorKey?: string }
      ).accessorKey;
      if (accessorKey && !alwaysVisibleKeys.has(accessorKey)) {
        columnVisibility[accessorKey] = leafVisible;
      }
    }

    return {
      data: state.rows,
      columns,
      state: {
        expanded: state._grouped.expanded,
        columnVisibility,
      },
      onExpandedChange: (updater: Updater<ExpandedState>) =>
        this.#handleExpandedChange(updater),
      getSubRows: (row) => {
        const meta = (row as unknown as FlatGroupedRow)._groupMeta;
        if (meta.type === 'group') {
          return (row as unknown as FlatGroupedRow).subRows as
            | Array<TData>
            | undefined;
        }

        return undefined;
      },
      getRowId: (row) => (row as unknown as FlatGroupedRow)._groupMeta.id,
      getRowCanExpand: (row) => {
        const meta = (row.original as unknown as FlatGroupedRow)._groupMeta;
        return meta.type === 'group';
      },
      getCoreRowModel: getCoreRowModel(),
      getExpandedRowModel: getExpandedRowModel(),
      manualPagination: true,
      manualSorting: true,
      ...state.tableOptions,
      _features: features,
    } as TableOptions<TData>;
  }

  get groupedState() {
    return this.groupedStore.state;
  }

  isRowLoading(rowId: string): boolean {
    return this.client.store.state._grouped.loadingGroupIds.includes(rowId);
  }

  #handleExpandedChange(updater: Updater<ExpandedState>): void {
    const previousExpanded = this.client.store.state._grouped.expanded;
    const nextExpanded = functionalUpdate(updater, previousExpanded);
    const newlyExpanded = findNewlyExpandedKeys(previousExpanded, nextExpanded);

    this.client.store.setState((previousState) => ({
      ...previousState,
      _grouped: { ...previousState._grouped, expanded: nextExpanded },
    }));

    this.#handleCollapses(previousExpanded, nextExpanded);

    newlyExpanded.forEach((rowId) => {
      void this.#loadChildrenIfNeeded(rowId);
    });
  }

  #handleCollapses(
    previousExpanded: ExpandedState,
    nextExpanded: ExpandedState,
  ): void {
    const previousKeys = getExpandedKeys(previousExpanded);
    const collapsedKeys = previousKeys.filter(
      (key) => !isKeyExpanded(nextExpanded, key),
    );

    if (collapsedKeys.length === 0) {
      return;
    }

    this.client.store.setState((previousState) => {
      if (previousState._grouped.expanded === true) {
        return previousState;
      }

      const nextExpandedState = {
        ...previousState._grouped.expanded,
      } as Record<string, boolean>;

      for (const collapsedId of collapsedKeys) {
        delete nextExpandedState[collapsedId];
        for (const key of Object.keys(nextExpandedState)) {
          if (key.startsWith(collapsedId + GROUP_ID_SEPARATOR)) {
            delete nextExpandedState[key];
          }
        }
      }

      return {
        ...previousState,
        _grouped: { ...previousState._grouped, expanded: nextExpandedState },
      };
    });

    this.#clearDescendantSelection(collapsedKeys);
    this.#rebuildGroupedTree();
  }

  #clearDescendantSelection(collapsedKeys: Array<string>): void {
    const selection = this.client.options.rowSelection?.selection;
    if (!selection) {
      return;
    }

    const currentValue = selection.value as Array<string> | null;
    if (!currentValue) {
      return;
    }

    const shouldClear = collapsedKeys.some((collapsedId) =>
      currentValue.some(
        (value) =>
          value.startsWith(collapsedId + GROUP_ID_SEPARATOR) &&
          value !== collapsedId,
      ),
    );

    if (!shouldClear) {
      return;
    }

    selection.update({
      source: this.client,
      value: null,
      predicate: null,
    });
  }

  async #loadChildrenIfNeeded(rowId: string): Promise<void> {
    if (this.#childrenCache.has(rowId)) {
      this.#rebuildGroupedTree();
      return;
    }

    const row = this.#findGroupedRowById(rowId);
    if (!row || row._groupMeta.type !== 'group') {
      return;
    }

    this.#setGroupLoading(rowId, true);

    try {
      const filterPredicate = this.#getGroupedFilterPredicate();
      const meta = row._groupMeta;
      const constraints = {
        ...meta.parentConstraints,
        [meta.groupColumn!]: meta.groupValue!,
      };
      const children = meta.isLeafParent
        ? await this.#queryGroupLeafRows(constraints, filterPredicate)
        : await this.#queryGroupLevel(
            meta.depth + 1,
            constraints,
            filterPredicate,
          );

      this.#childrenCache.set(rowId, children);

      if (
        meta.isLeafParent &&
        children.length > 0 &&
        this.#autoLeafColumnDefs.length === 0
      ) {
        this.#generateAutoLeafColumns(children[0]!);
      }
    } catch (error) {
      logger.warn('Grouped', `Failed to load children for ${rowId}`, {
        error,
      });
      this.#childrenCache.set(rowId, []);
    } finally {
      this.#setGroupLoading(rowId, false);
    }

    this.#rebuildGroupedTree();
  }

  async #refreshExpandedChildren(): Promise<void> {
    const expandedKeys = getExpandedKeys(
      this.client.store.state._grouped.expanded,
    );
    if (expandedKeys.length === 0) {
      return;
    }

    const filterPredicate = this.#getGroupedFilterPredicate();
    const validRootIds = new Set(
      this.#groupedRootRows.map((row) => row._groupMeta.id),
    );
    const groupBy = this.client.options.groupBy!;

    const pendingQueries: Array<{
      parentId: string;
      promise: Promise<Array<FlatGroupedRow>>;
    }> = [];

    for (const key of expandedKeys) {
      if (key.includes('_leaf_')) {
        continue;
      }

      const row = this.#findGroupedRowById(key);
      if (row && row._groupMeta.type === 'group') {
        const rootSegment = key.split(GROUP_ID_SEPARATOR)[0]!;
        if (!validRootIds.has(rootSegment)) {
          continue;
        }

        const meta = row._groupMeta;
        const constraints = {
          ...meta.parentConstraints,
          [meta.groupColumn!]: meta.groupValue!,
        };

        pendingQueries.push({
          parentId: key,
          promise: meta.isLeafParent
            ? this.#queryGroupLeafRows(constraints, filterPredicate)
            : this.#queryGroupLevel(
                meta.depth + 1,
                constraints,
                filterPredicate,
              ),
        });
        continue;
      }

      const hasLeafColumns =
        !!groupBy.leafColumns && groupBy.leafColumns.length > 0;
      const segments = key.split(GROUP_ID_SEPARATOR);
      const depth = segments.length - 1;
      const isLeafParentRow =
        depth === groupBy.levels.length - 1 && hasLeafColumns;

      if (isLeafParentRow || depth >= groupBy.levels.length - 1) {
        continue;
      }

      const rootSegment = segments[0]!;
      if (!validRootIds.has(rootSegment)) {
        continue;
      }

      const constraints: Record<string, string> = {};
      for (let index = 0; index <= depth; index++) {
        constraints[groupBy.levels[index]!.column] = segments[index]!;
      }

      pendingQueries.push({
        parentId: key,
        promise: this.#queryGroupLevel(depth + 1, constraints, filterPredicate),
      });
    }

    const results = await Promise.allSettled(
      pendingQueries.map(async (query) => ({
        parentId: query.parentId,
        children: await query.promise,
      })),
    );

    const refreshedCache = new Map<string, Array<FlatGroupedRow>>();
    for (const result of results) {
      if (result.status === 'fulfilled') {
        refreshedCache.set(result.value.parentId, result.value.children);
      }
    }
    this.#childrenCache = refreshedCache;

    const previousExpanded = this.client.store.state._grouped.expanded;
    if (previousExpanded !== true) {
      const nextExpanded: Record<string, boolean> = {};
      for (const [key, isExpanded] of Object.entries(previousExpanded)) {
        const rootSegment = key.split(GROUP_ID_SEPARATOR)[0]!;
        if (isExpanded && validRootIds.has(rootSegment)) {
          nextExpanded[key] = true;
        }
      }

      this.client.store.setState((previousState) => ({
        ...previousState,
        _grouped: { ...previousState._grouped, expanded: nextExpanded },
      }));
    }

    this.#rebuildGroupedTree();
  }

  #rebuildGroupedTree(): void {
    const attachChildren = (
      rows: Array<FlatGroupedRow>,
    ): Array<FlatGroupedRow> => {
      return rows.map((row) => {
        if (row._groupMeta.type === 'leaf') {
          return row;
        }

        const cachedChildren = this.#childrenCache.get(row._groupMeta.id);
        if (cachedChildren && cachedChildren.length > 0) {
          return { ...row, subRows: attachChildren(cachedChildren) };
        }

        return { ...row, subRows: [] as Array<FlatGroupedRow> };
      });
    };

    const treeData = attachChildren(this.#groupedRootRows);
    batch(() => {
      this.client.store.setState((previousState) => ({
        ...previousState,
        rows: treeData as Array<TData>,
      }));
    });
  }

  #toFlatGroupedRow(
    raw: Record<string, unknown>,
    depth: number,
    parentConstraints: Record<string, string>,
  ): FlatGroupedRow {
    const groupBy = this.client.options.groupBy!;
    const hasLeafColumns =
      !!groupBy.leafColumns && groupBy.leafColumns.length > 0;
    const level = groupBy.levels[depth]!;
    const value = String(raw[level.column] ?? '');
    const isDeepestLevel = depth === groupBy.levels.length - 1;
    const isLeafParent = isDeepestLevel && hasLeafColumns;
    const parentChain = Object.values(parentConstraints);
    const id =
      parentChain.length > 0
        ? `${parentChain.join(GROUP_ID_SEPARATOR)}${GROUP_ID_SEPARATOR}${value}`
        : value;

    return {
      ...raw,
      _groupMeta: {
        type: 'group',
        id,
        depth,
        parentConstraints: { ...parentConstraints },
        groupColumn: level.column,
        groupValue: value,
        isLeafParent,
      },
      subRows: [],
    };
  }

  #toFlatLeafRow(
    raw: Record<string, unknown>,
    parentConstraints: Record<string, string>,
    index: number,
  ): FlatGroupedRow {
    const parentChain = Object.values(parentConstraints);
    const uniqueId = raw.unique_key ?? `row_${index}`;
    const id =
      parentChain.length > 0
        ? `${parentChain.join(GROUP_ID_SEPARATOR)}${GROUP_ID_SEPARATOR}_leaf_${uniqueId}`
        : `_leaf_${uniqueId}`;
    const depth = Object.keys(parentConstraints).length;

    return {
      ...raw,
      _groupMeta: {
        type: 'leaf',
        id,
        depth,
        parentConstraints: { ...parentConstraints },
      },
    };
  }

  async #queryGroupLevel(
    depth: number,
    parentConstraints: Record<string, string>,
    filterPredicate: FilterExpr | null,
  ): Promise<Array<FlatGroupedRow>> {
    const groupBy = this.client.options.groupBy!;
    const query = buildGroupedLevelQuery({
      table: this.client.source as string,
      groupBy: groupBy.levels,
      depth,
      metrics: groupBy.metrics,
      parentConstraints,
      filterPredicate,
      additionalWhere: groupBy.additionalWhere ?? undefined,
      limit: groupBy.pageSize ?? 200,
    });

    const result = await this.client.coordinator!.query(query.toString());
    const rawRows = arrowTableToObjects(result);

    return rawRows.map((raw) =>
      this.#toFlatGroupedRow(raw, depth, parentConstraints),
    );
  }

  async #queryGroupLeafRows(
    parentConstraints: Record<string, string>,
    filterPredicate: FilterExpr | null,
  ): Promise<Array<FlatGroupedRow>> {
    const groupBy = this.client.options.groupBy!;
    if (!groupBy.leafColumns || groupBy.leafColumns.length === 0) {
      return [];
    }

    const query = buildLeafRowsQuery({
      table: this.client.source as string,
      leafColumns: groupBy.leafColumns,
      parentConstraints,
      filterPredicate,
      additionalWhere: groupBy.additionalWhere ?? undefined,
      limit: groupBy.leafPageSize ?? 50,
      selectAll: groupBy.leafSelectAll ?? false,
    });

    const result = await this.client.coordinator!.query(query.toString());
    const rawRows = arrowTableToObjects(result);

    return rawRows.map((raw, index) =>
      this.#toFlatLeafRow(raw, parentConstraints, index),
    );
  }

  #findGroupedRowById(rowId: string): FlatGroupedRow | null {
    const search = (rows: Array<FlatGroupedRow>): FlatGroupedRow | null => {
      for (const row of rows) {
        if (row._groupMeta.id === rowId) {
          return row;
        }
        if (row._groupMeta.type === 'group' && row.subRows) {
          const found = search(row.subRows);
          if (found) {
            return found;
          }
        }
      }

      return null;
    };

    const rootMatch = search(this.#groupedRootRows);
    if (rootMatch) {
      return rootMatch;
    }

    for (const children of this.#childrenCache.values()) {
      const found = search(children);
      if (found) {
        return found;
      }
    }

    return null;
  }

  #setGroupLoading(groupId: string, loading: boolean): void {
    this.client.store.setState((previousState) => {
      const currentIds = previousState._grouped.loadingGroupIds;
      const nextIds = loading
        ? currentIds.includes(groupId)
          ? currentIds
          : [...currentIds, groupId]
        : currentIds.filter((id) => id !== groupId);

      return {
        ...previousState,
        _grouped: { ...previousState._grouped, loadingGroupIds: nextIds },
      };
    });
  }

  #getGroupedFilterPredicate(): FilterExpr | null {
    return (this.client.filterBy?.predicate(null) as FilterExpr | null) ?? null;
  }

  #hasExpandedLeafRows(): boolean {
    const expanded = this.client.store.state._grouped.expanded;
    if (expanded === true) {
      return false;
    }

    for (const [key, isExpanded] of Object.entries(expanded)) {
      if (!isExpanded) {
        continue;
      }

      const cachedChildren = this.#childrenCache.get(key);
      if (
        cachedChildren &&
        cachedChildren.length > 0 &&
        cachedChildren[0]!._groupMeta.type === 'leaf'
      ) {
        return true;
      }
    }

    return false;
  }

  #generateAutoLeafColumns(sampleRow: FlatGroupedRow): void {
    const existingKeys = new Set(
      this.client.store.state.columnDefs
        .map(
          (column) =>
            (column as ColumnDef<TData, any> & { accessorKey?: string })
              .accessorKey ?? column.id,
        )
        .filter(Boolean),
    );
    const groupBy = this.client.options.groupBy!;
    const groupKeys = new Set([
      ...groupBy.metrics.map((metric) => metric.id),
      ...groupBy.levels.map((level) => level.column),
    ]);
    const leafKeys = Object.keys(sampleRow).filter(
      (key) =>
        key !== '_groupMeta' &&
        key !== 'subRows' &&
        !existingKeys.has(key) &&
        !groupKeys.has(key),
    );

    this.#autoLeafColumnDefs = leafKeys.map((key) => {
      const leafColumn = groupBy.leafColumns?.find(
        (item) => item.column === key,
      );
      return {
        accessorKey: key,
        header: leafColumn?.label ?? key,
      } as ColumnDef<TData, any>;
    });
  }
}
