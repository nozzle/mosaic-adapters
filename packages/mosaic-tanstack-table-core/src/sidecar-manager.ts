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
    const key = `${columnId}:${type}`;
    if (this.clients.has(key)) {
      return;
    }

    const strategy = this.facetRegistry.get(type);

    if (!strategy) {
      console.warn(
        `[SidecarManager] No strategy registered for facet type "${type}" on column "${columnId}".`,
      );
      return;
    }

    const sqlColumn = this.host.getColumnSqlName(columnId);

    if (!sqlColumn) {
      console.warn(
        `[SidecarManager] Cannot request facet for unknown column: ${columnId}`,
      );
      return;
    }

    // Get Sort Mode from Column Definition Meta
    const colDef = this.host.getColumnDef(sqlColumn);
    const sortMode = colDef?.meta?.mosaicDataTable?.facetSortMode || 'alpha';

    const client = new SidecarClient(
      {
        source: this.host.source,
        column: sqlColumn,
        filterBy: this.host.filterBy,
        // Dynamic Callback to get current table state
        getFilters: () =>
          this.host.getCascadingFilters({ excludeColumnId: columnId }),
        onResult: (val) => this.host.updateFacetValue(columnId, val),
        options: {
          sortMode: type === 'unique' ? sortMode : undefined,
        },
        __debugName: `${this.host.options.__debugName || 'Table'}:${type}:${columnId}`,
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

    this.clients.set(key, client);
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
