import {
  MosaicClient,
  coordinator as defaultCoordinator,
  isArrowTable,
  isParam,
} from '@uwdata/mosaic-core';
import * as mSql from '@uwdata/mosaic-sql';
import { Store } from '@tanstack/store';
import { createStructAccess } from './utils';
import { createLifecycleManager, handleQueryError } from './client-utils';
import { logger } from './logger';
import { MosaicSelectionManager } from './selection-manager';
import type { Coordinator, Selection } from '@uwdata/mosaic-core';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type { ColumnType, IMosaicClient, MosaicTableSource } from './types';

export type FacetRequest =
  | {
      type: 'unique';
      column: string;
      sqlColumn: string;
      limit?: number;
      sortMode?: 'alpha' | 'count';
      columnType?: ColumnType;
    }
  | {
      type: 'minmax';
      column: string;
      sqlColumn: string;
      columnType?: ColumnType;
    }
  | { type: 'totalCount'; column: string };

export interface MosaicFacetClientOptions {
  filterBy?: Selection;
  table: MosaicTableSource;
  onUpdate?: (results: Record<string, any>) => void;
  __debugName?: string;
  coordinator?: Coordinator;
}

export interface MosaicFacetClientState {
  facets: Record<string, any>;
  loading: boolean;
}

/**
 * A centralized client for fetching column facet metadata (unique values, min/max ranges).
 * Supports both receiving filters from a table (Passive) and driving filters via inputs (Active).
 * Uses CTEs to consolidate multiple facet queries into a single SQL request.
 */
export class MosaicFacetClient extends MosaicClient implements IMosaicClient {
  private requests = new Map<string, FacetRequest>();
  private onUpdate?: (results: Record<string, any>) => void;
  private table: MosaicTableSource;
  private lifecycle = createLifecycleManager(this);
  private options: MosaicFacetClientOptions;

  // Stores internal table filters: ColumnID -> Predicate
  // Used for Cascading Logic (excluding a column's own filter from its facet query)
  private internalFilters = new Map<string, FilterExpr>();

  // Stores current selected values for Active mode: ColumnID -> Array<Value>
  private selectedValues = new Map<string, Array<any>>();

  // Managers for driving the global selection (One per column)
  private selectionManagers = new Map<string, MosaicSelectionManager>();

  public readonly store: Store<MosaicFacetClientState>;

  constructor(options: MosaicFacetClientOptions) {
    super(options.filterBy);
    this.options = options;
    this.table = options.table;
    this.onUpdate = options.onUpdate;
    this.coordinator = options.coordinator || defaultCoordinator();

    this.store = new Store<MosaicFacetClientState>({
      facets: {},
      loading: false,
    });
  }

  get isConnected() {
    return this.lifecycle.isConnected;
  }

  setCoordinator(coordinator: Coordinator) {
    this.lifecycle.handleCoordinatorSwap(this.coordinator, coordinator, () =>
      this.connect(),
    );
    this.coordinator = coordinator;
  }

  connect(): () => void {
    return this.lifecycle.connect(this.coordinator);
  }

  disconnect() {
    this.lifecycle.disconnect(this.coordinator);
  }

  /**
   * Registers a column for consolidated fetching.
   * Call this during table initialization for every column with facet meta.
   */
  register(columnId: string, req: FacetRequest) {
    if (!this.requests.has(columnId)) {
      this.requests.set(columnId, req);

      // Initialize a SelectionManager if we are driving a selection
      if (this.options.filterBy && req.type !== 'totalCount') {
        // Infer column type: explicit > request type inference > default scalar
        let colType: ColumnType = 'scalar';
        if (req.columnType) {
          colType = req.columnType;
        } else if (req.type === 'unique') {
          colType = 'scalar';
        }

        this.selectionManagers.set(
          columnId,
          new MosaicSelectionManager({
            selection: this.options.filterBy,
            client: this, // The Consolidated Client is the source
            column: req.sqlColumn || req.column,
            columnType: colType,
          }),
        );
      }
    }
  }

  /**
   * Updates the data source (e.g. when table prop changes).
   */
  updateSource(source: MosaicTableSource) {
    if (this.table !== source) {
      this.table = source;
      this.requestUpdate();
    }
  }

  /**
   * Updates the internal filter state.
   * Used to implement cascading facets (Table Client pushes its internal state here).
   */
  setInternalFilters(filters: Map<string, FilterExpr>) {
    this.internalFilters = filters;
    this.requestUpdate();
  }

  /**
   * Handles user input for a specific column (Active Mode).
   * Toggles the value, updates the internal cascading filter map,
   * and pushes the update to the Mosaic Selection.
   */
  handleInput(columnId: string, value: any) {
    if (!this.options.filterBy) {
      logger.warn(
        'Core',
        '[MosaicFacetClient] handleInput called but no filterBy selection provided.',
      );
      return;
    }

    const req = this.requests.get(columnId);
    if (!req) {
      logger.warn(
        'Core',
        `[MosaicFacetClient] handleInput called for unregistered column: ${columnId}`,
      );
      return;
    }

    // Guard: Total Count is not an interactive input type
    if (req.type === 'totalCount') {
      return;
    }

    // 1. Toggle Selection Logic
    const current = this.selectedValues.get(columnId) || [];
    let newValues: Array<any>;

    if (value === null) {
      newValues = [];
    } else {
      const idx = current.indexOf(value);
      if (idx >= 0) {
        newValues = [...current];
        newValues.splice(idx, 1);
      } else {
        newValues = [...current, value];
      }
    }

    if (newValues.length === 0) {
      this.selectedValues.delete(columnId);
      this.internalFilters.delete(columnId);
    } else {
      this.selectedValues.set(columnId, newValues);

      // 2. Generate Predicate for Internal Map (Cascading)
      // This is needed so the facet query knows to filter *other* columns by this choice.
      const colExpr = createStructAccess(req.sqlColumn || req.column);
      let predicate: FilterExpr;
      const isArray = req.columnType === 'array';

      if (isArray) {
        // Array Logic: list_has_any(col, [v1, v2])
        const listContent = newValues.slice(1).reduce((acc, v) => {
          return mSql.sql`${acc}, ${mSql.literal(v)}`;
        }, mSql.literal(newValues[0]));

        const listLiteral = mSql.sql`[${listContent}]`;
        predicate = mSql.listHasAny(colExpr, listLiteral);
      } else {
        // Scalar Logic: eq or in
        if (newValues.length === 1) {
          predicate = mSql.eq(colExpr, mSql.literal(newValues[0]));
        } else {
          predicate = mSql.isIn(
            colExpr,
            newValues.map((v) => mSql.literal(v)),
          );
        }
      }

      this.internalFilters.set(columnId, predicate);
    }

    // 3. Update Mosaic Selection (Drives the Dashboard)
    const manager = this.selectionManagers.get(columnId);
    if (manager) {
      manager.select(newValues.length > 0 ? newValues : null);
    }

    // 4. Trigger Update for facets
    this.requestUpdate();
  }

  /**
   * The Consolidated Query Generator.
   * Uses CTEs to apply filters once, then aggregates all requested facets.
   */
  override query(filter: FilterExpr): SelectQuery | null {
    if (this.requests.size === 0) {
      return null;
    }

    const source = this.resolveSource(filter);
    if (!source || (typeof source === 'string' && source.trim() === '')) {
      return null;
    }

    // 1. Create the Base CTE (The Viewport)
    let baseQuery: SelectQuery;

    if (typeof source === 'string') {
      baseQuery = mSql.Query.from(source).select('*');
      if (filter) {
        baseQuery.where(filter);
      }
    } else {
      baseQuery = source;
    }

    // 2. Build Subqueries for each Facet
    const selectionMap: Record<string, any> = {};

    for (const [colId, req] of this.requests.entries()) {
      let subQuery: SelectQuery;

      // Cascading Logic: Collect all filters EXCEPT the one for the current column
      const cascadingClauses: Array<FilterExpr> = [];
      for (const [filterColId, predicate] of this.internalFilters.entries()) {
        if (filterColId !== colId) {
          cascadingClauses.push(predicate);
        }
      }

      if (req.type === 'totalCount') {
        subQuery = mSql.Query.from('viewport').select({
          count: mSql.count(),
        });
        // Total Count should respect ALL filters, including itself
        if (this.internalFilters.has(colId)) {
          cascadingClauses.push(this.internalFilters.get(colId)!);
        }
        if (cascadingClauses.length > 0) {
          subQuery.where(mSql.and(...cascadingClauses));
        }
      } else if (req.type === 'unique') {
        const colExpr = createStructAccess(req.sqlColumn);
        const isArray = req.columnType === 'array';
        let distinctSub: SelectQuery;

        if (isArray) {
          // Array: UNNEST logic
          distinctSub = mSql.Query.from(
            mSql.sql`"viewport", UNNEST(${colExpr}) AS "u"("val")`,
          )
            .select({ val: mSql.column('val') })
            .groupby(mSql.column('val'))
            .limit(req.limit || 50);

          if (req.sortMode === 'alpha') {
            distinctSub.orderby(mSql.asc(mSql.column('val')));
          } else {
            distinctSub.orderby(mSql.desc(mSql.count()));
          }
        } else {
          // Scalar: Standard Group By
          distinctSub = mSql.Query.from('viewport')
            .select({ val: colExpr })
            .groupby(colExpr)
            .limit(req.limit || 50);

          if (req.sortMode === 'alpha') {
            distinctSub.orderby(mSql.asc(colExpr));
          } else {
            distinctSub.orderby(mSql.desc(mSql.count()));
          }
        }

        // --- FILTER LOGIC ---
        // 1. Cascading filters (Peer filters)
        // 2. Not Null check (Always exclude NULLs from dropdown options)
        const clauses = [...cascadingClauses];
        const valRef = isArray ? mSql.column('val') : colExpr;
        clauses.push(mSql.isNotNull(valRef));

        if (clauses.length > 0) {
          distinctSub.where(mSql.and(...clauses));
        }

        subQuery = mSql.Query.from(distinctSub).select({
          list: mSql.sql`list(${mSql.column('val')})`,
        });
      } else {
        // MinMax
        const colExpr = createStructAccess(req.sqlColumn);
        subQuery = mSql.Query.from('viewport').select({
          stats: mSql.sql`{'min': MIN(${colExpr}), 'max': MAX(${colExpr})}`,
        });

        if (cascadingClauses.length > 0) {
          subQuery.where(mSql.and(...cascadingClauses));
        }
      }

      selectionMap[colId] = mSql.sql`(${subQuery})`;
    }

    if (Object.keys(selectionMap).length === 0) {
      return null;
    }

    const query = mSql.Query.with({ viewport: baseQuery }).select(selectionMap);

    logger.debug(
      'SQL',
      `[MosaicFacetClient] Consolidated Facet Query:\n${query.toString()}`,
    );

    return query;
  }

  override queryPending() {
    this.store.setState((s) => ({ ...s, loading: true }));
    return this;
  }

  override queryResult(arrowTable: any) {
    if (!isArrowTable(arrowTable) || arrowTable.numRows === 0) {
      this.store.setState((s) => ({ ...s, loading: false }));
      return this;
    }

    const row = arrowTable.get(0);
    const results: Record<string, any> = {};

    for (const [colId, req] of this.requests.entries()) {
      const val = row[colId];

      if (val !== undefined && val !== null) {
        const jsonVal = val?.toJSON ? val.toJSON() : val;

        if (req.type === 'totalCount') {
          results[colId] =
            typeof jsonVal === 'object' &&
            jsonVal !== null &&
            'count' in jsonVal
              ? jsonVal.count
              : jsonVal;
        } else {
          results[colId] = jsonVal;
        }
      }
    }

    this.store.setState((s) => ({
      ...s,
      facets: { ...s.facets, ...results },
      loading: false,
    }));

    if (this.onUpdate) {
      this.onUpdate(results);
    }
    return this;
  }

  override queryError(error: Error): this {
    handleQueryError(this.options.__debugName || 'MosaicFacetClient', error);
    this.store.setState((s) => ({ ...s, loading: false }));
    return this;
  }

  private resolveSource(filter: FilterExpr): string | SelectQuery {
    if (typeof this.table === 'function') {
      return this.table(filter);
    }
    if (isParam(this.table)) {
      return this.table.value as string;
    }
    return this.table as string;
  }
}
