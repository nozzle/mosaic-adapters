// packages/mosaic-tanstack-table-core/src/sidecar-manager.ts
import { SidecarClient } from './sidecar-client';
import { TotalCountStrategy } from './facet-strategies';
import type { MosaicDataTable } from './data-table';
import type { Coordinator } from '@uwdata/mosaic-core';
import type { RowData } from '@tanstack/table-core';
import type { MosaicTableSource } from './types';
import type { StrategyRegistry } from './registry';
import type { FacetStrategy } from './facet-strategies';

/**
 * Manages "Sidecar" clients for a MosaicDataTable.
 * Ensures only one client exists per column/type pair.
 */
export class SidecarManager<TData extends RowData, TValue = unknown> {
  private clients = new Map<string, SidecarClient<any>>();

  constructor(
    private host: MosaicDataTable<TData, TValue>,
    private facetRegistry: StrategyRegistry<FacetStrategy<any>>,
  ) {}

  /**
   * Idempotently requests a facet sidecar for a column.
   */
  requestFacet(columnId: string, type: string) {
    // Facets are just a specific type of auxiliary query, keyed by column
    this.requestAuxiliary({
      id: `${columnId}:${type}`,
      type,
      column: columnId,
      // For standard facets, we exclude the column itself from the filters
      excludeColumnId: columnId,
      // CRITICAL FIX: Explicitly map the result to the columnId.
      // The host table expects to find the facet values under 'columnId'
      // to satisfy TanStack Table's getFacetedUniqueValues() API.
      // This overrides the default behavior which would store it under 'id' (columnId:type).
      onResult: (val) => {
        this.host.updateFacetValue(columnId, val);
      },
    });
  }

  /**
   * Generic method to request any auxiliary data driven by the table context.
   * Useful for Sidebars, Histograms, or Custom Widgets.
   */
  requestAuxiliary(config: {
    /** Unique identifier for this request (e.g. 'price_hist', 'col_a:unique') */
    id: string;
    /** The name of the registered strategy to use */
    type: string;
    /** The SQL column/expression to operate on */
    column: string;
    /**
     * If provided, filters on this column ID will be EXCLUDED from the query.
     * This is standard Cross-Filter behavior (Multi-Selects shouldn't filter themselves).
     */
    excludeColumnId?: string;
    /** Additional options to pass to the strategy (e.g. bins, limits) */
    options?: Record<string, any>;
    /** Optional custom result handler. Defaults to host.updateFacetValue(id, val) */
    onResult?: (result: any) => void;
  }) {
    if (this.clients.has(config.id)) {
      return;
    }

    const strategy = this.facetRegistry.get(config.type);

    if (!strategy) {
      console.warn(
        `[SidecarManager] No strategy registered for type "${config.type}" (ID: ${config.id}).`,
      );
      return;
    }

    // Resolve SQL column if it's a known table column, otherwise pass raw
    const sqlColumn =
      this.host.getColumnSqlName(config.column) || config.column;

    // Determine sort mode if applicable (heuristic from schema)
    const colDef = this.host.getColumnDef(sqlColumn);
    const sortMode = colDef?.meta?.mosaicDataTable?.facetSortMode || 'alpha';

    // Merge options
    const queryOptions = {
      sortMode,
      ...config.options,
    };

    const client = new SidecarClient(
      {
        source: this.host.source,
        column: sqlColumn,
        filterBy: this.host.filterBy,
        // Dynamic Callback to get current table state
        getFilters: () =>
          this.host.getCascadingFilters({
            excludeColumnId: config.excludeColumnId,
          }),
        onResult: (val) => {
          if (config.onResult) {
            config.onResult(val);
          } else {
            this.host.updateFacetValue(config.id, val);
          }
        },
        options: queryOptions,
        __debugName: `${this.host.options.__debugName || 'Table'}:Aux:${config.id}`,
      },
      strategy,
    );

    // Sync coordinator
    if (this.host.coordinator) {
      client.setCoordinator(this.host.coordinator);
    }

    // Auto-connect if the host table is already active
    if (this.host.isEnabled) {
      client.connect();
      client.requestUpdate();
    }

    this.clients.set(config.id, client);
  }

  /**
   * Requests a dedicated client to fetch the total row count.
   * This respects all current filters on the table.
   */
  requestTotalCount() {
    const key = '__total_rows';
    if (this.clients.has(key)) {
      return;
    }

    const client = new SidecarClient(
      {
        source: this.host.source,
        column: key,
        filterBy: this.host.filterBy,
        // Get ALL filters (no exclusions) for the total count
        getFilters: () => this.host.getCascadingFilters(),
        onResult: (count: number) => this.host.updateTotalRows(count),
        __debugName: `${this.host.options.__debugName || 'Table'}:TotalCount`,
      },
      TotalCountStrategy,
    );

    if (this.host.coordinator) {
      client.setCoordinator(this.host.coordinator);
    }

    if (this.host.isEnabled) {
      client.connect();
      client.requestUpdate();
    }

    this.clients.set(key, client);
  }

  /**
   * Updates the source for all active sidecars.
   * Essential when switching tables or changing the base query.
   */
  updateSource(source: MosaicTableSource) {
    this.clients.forEach((client) => {
      client.updateSource(source);
    });
  }

  /**
   * Propagates a new coordinator to all sidecars.
   */
  updateCoordinators(newCoordinator: Coordinator) {
    this.clients.forEach((c) => c.setCoordinator(newCoordinator));
  }

  /**
   * Connects all sidecars to the coordinator.
   */
  connectAll() {
    this.clients.forEach((c) => c.connect());
  }

  /**
   * Refreshes all sidecars (e.g. when filters change).
   */
  refreshAll() {
    this.clients.forEach((c) => c.requestUpdate());
  }

  /**
   * Disconnects all sidecars.
   */
  disconnectAll() {
    this.clients.forEach((c) => c.disconnect());
  }

  /**
   * Clears all clients.
   */
  clear() {
    this.disconnectAll();
    this.clients.clear();
  }
}
