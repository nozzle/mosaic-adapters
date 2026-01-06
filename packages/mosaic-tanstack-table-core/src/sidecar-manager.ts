// packages/mosaic-tanstack-table-core/src/sidecar-manager.ts

import { SidecarClient } from './sidecar-client';
import { TotalCountStrategy } from './facet-strategies';
import type { MosaicDataTable } from './data-table';
import type { Coordinator } from '@uwdata/mosaic-core';
import type { RowData } from '@tanstack/table-core';
import type { MosaicTableSource } from './types';
import type {
  FacetStrategyKey,
  MosaicFacetRegistry,
  StrategyRegistry,
} from './registry';
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
    // We cast type to any here because requestFacet is often called dynamically based on
    // column metadata strings which might not be strictly typed to the Registry keys at that call site.
    // However, the underlying requestAuxiliary will enforce it if called directly.
    this.requestAuxiliary({
      id: `${columnId}:${type}`,
      type: type as any,
      column: columnId,
      excludeColumnId: columnId,
      onResult: (val) => {
        this.host.updateFacetValue(columnId, val);
      },
    });
  }

  /**
   * Generic method to request any auxiliary data driven by the table context.
   * Strongly typed against the MosaicFacetRegistry.
   */
  requestAuxiliary<TKey extends FacetStrategyKey>(config: {
    /** Unique identifier for this request (e.g. 'price_hist', 'col_a:unique') */
    id: string;
    /** The name of the registered strategy to use */
    type: TKey;
    /** The SQL column/expression to operate on */
    column: string;
    /**
     * If provided, filters on this column ID will be EXCLUDED from the query.
     * This is standard Cross-Filter behavior.
     */
    excludeColumnId?: string;
    /**
     * Additional options to pass to the strategy.
     * Strongly typed based on the strategy definition.
     */
    options?: MosaicFacetRegistry[TKey]['input'];
    /**
     * Custom result handler.
     * Strongly typed based on the strategy output.
     */
    onResult?: (result: MosaicFacetRegistry[TKey]['output']) => void;
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

    const sqlColumn =
      this.host.getColumnSqlName(config.column) || config.column;

    const colDef = this.host.getColumnDef(sqlColumn);
    const sortMode = colDef?.meta?.mosaicDataTable?.facetSortMode || 'alpha';

    // We cast to unknown first to erase the inferred 'void' type from the base registry.
    // We then cast to 'object | undefined' to acknowledge it might be an options object
    // (from augmentation) or undefined (from base).
    // This makes the '|| {}' fallback necessary and valid to the linter.
    const strategyOptions =
      (config.options as unknown as object | undefined) || {};

    const queryOptions = {
      sortMode,
      ...strategyOptions,
    };

    const client = new SidecarClient(
      {
        source: this.host.source,
        column: sqlColumn,
        filterBy: this.host.filterBy,
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

    if (this.host.coordinator) {
      client.setCoordinator(this.host.coordinator);
    }

    if (this.host.isEnabled) {
      client.connect();
      client.requestUpdate();
    }

    this.clients.set(config.id, client);
  }

  /**
   * Requests a dedicated client to fetch the total row count.
   */
  requestTotalCount() {
    const key = '__total_rows';
    if (this.clients.has(key)) {
      return;
    }

    // Explicitly typed request for totalCount
    const client = new SidecarClient(
      {
        source: this.host.source,
        column: key,
        filterBy: this.host.filterBy,
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

  updateSource(source: MosaicTableSource) {
    this.clients.forEach((client) => {
      client.updateSource(source);
    });
  }

  updateCoordinators(newCoordinator: Coordinator) {
    this.clients.forEach((c) => c.setCoordinator(newCoordinator));
  }

  connectAll() {
    this.clients.forEach((c) => c.connect());
  }

  refreshAll() {
    this.clients.forEach((c) => c.requestUpdate());
  }

  disconnectAll() {
    this.clients.forEach((c) => c.disconnect());
  }

  clear() {
    this.disconnectAll();
    this.clients.clear();
  }
}
