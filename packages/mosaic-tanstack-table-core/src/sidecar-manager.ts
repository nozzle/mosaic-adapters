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
import type { StrictId } from './types/paths';

/**
 * Manages "Sidecar" clients for a MosaicDataTable.
 * Ensures only one client exists per column/type pair.
 * Enforces strict typing for strategy inputs and column IDs.
 */
export class SidecarManager<TData extends RowData, TValue = unknown> {
  private clients = new Map<string, SidecarClient<any, any>>();

  constructor(
    private host: MosaicDataTable<TData, TValue>,
    private facetRegistry: StrategyRegistry<FacetStrategy<any, any>>,
  ) {}

  /**
   * Idempotently requests a facet sidecar for a column.
   */
  requestFacet(columnId: string, type: string) {
    // Dynamic request from metadata strings (legacy support or dynamic schema)
    // Casts to strict types internally
    this.requestAuxiliary({
      id: `${columnId}:${type}`,
      type: type as any,
      column: columnId as any,
      excludeColumnId: columnId,
      options: undefined,
      onResult: (val) => {
        this.host.updateFacetValue(columnId, val);
      },
    });
  }

  /**
   * Generic method to request any auxiliary data driven by the table context.
   * Strongly typed against the MosaicFacetRegistry and RowData.
   */
  requestAuxiliary<TKey extends FacetStrategyKey>(config: {
    id: string;
    type: TKey;
    column: StrictId<TData>;
    excludeColumnId?: string;
    /**
     * Strongly typed options based on the strategy registry.
     * If the strategy input is void, options are optional.
     * If the strategy input is defined, options are required.
     */
    options: MosaicFacetRegistry[TKey]['input'] extends void
      ? void | undefined
      : MosaicFacetRegistry[TKey]['input'];
    onResult?: (result: MosaicFacetRegistry[TKey]['output']) => void;
  }) {
    if (this.clients.has(config.id)) {
      return;
    }

    const strategy = this.facetRegistry.get(config.type);

    // Removed unnecessary check: strategy is guaranteed to exist due to TKey constraint
    // If strict mode is off or runtime registry is mutated, this might throw, but static analysis guarantees it.

    const sqlColumn =
      this.host.getColumnSqlName(config.column as string) ||
      (config.column as string);

    const colDef = this.host.getColumnDef(sqlColumn);
    const sortMode = colDef?.meta?.mosaicDataTable?.facetSortMode || 'alpha';

    // We trust strict typing at the call site for config.options
    // Cast to any to satisfy linter when registry only contains void-input strategies (Core scope)
    const strategyOptions = (config.options as any) || {};

    const queryOptions = {
      sortMode,
      ...strategyOptions,
    };

    // We know strategy is defined because TKey comes from the Registry keys
    // Casting strategy to any here to satisfy TS instantiation with generic constraint mismatch
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
      strategy!,
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
