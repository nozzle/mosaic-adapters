import { SidecarClient } from './sidecar-client';
import { TotalCountStrategy } from './facet-strategies';
import type { MosaicDataTable } from './data-table';
import type { Coordinator } from '@uwdata/mosaic-core';
import type { RowData } from '@tanstack/table-core';
import type { MosaicTableSource } from './types';
import type { SidecarRequest, StrategyRegistry } from './registry';
import type { FacetStrategy } from './facet-strategies';

/**
 * Manages "Sidecar" clients for a MosaicDataTable.
 * Ensures only one client exists per column/type pair.
 * Enforces strict typing for strategy inputs and column IDs using Discriminated Unions.
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
    // Dynamic request from metadata strings.
    // We cast to SidecarRequest<TData> because metadata strings are runtime-defined
    // and cannot be strictly checked at compile time here, but requestAuxiliary enforces safety internally.
    this.requestAuxiliary({
      id: `${columnId}:${type}`,
      type: type as any,
      column: columnId as any,
      excludeColumnId: columnId,
      options: undefined,
      onResult: (val: unknown) => {
        this.host.updateFacetValue(columnId, val);
      },
    } as SidecarRequest<TData>);
  }

  /**
   * Generic method to request any auxiliary data driven by the table context.
   * Uses Discriminated Union SidecarRequest to strictly enforce options matching the type.
   */
  requestAuxiliary(config: SidecarRequest<TData>) {
    if (this.clients.has(config.id)) {
      return;
    }

    const strategy = this.facetRegistry.get(config.type);

    if (!strategy) {
      console.warn(
        `[SidecarManager] Strategy '${config.type}' not found in registry.`,
      );
      return;
    }

    const sqlColumn =
      this.host.getColumnSqlName(config.column as string) ||
      (config.column as string);

    const colDef = this.host.getColumnDef(sqlColumn);
    const sortMode = colDef?.meta?.mosaicDataTable?.facetSortMode || 'alpha';

    // TS knows config.options matches the strategy because of the discriminated union.
    // We cast to any for the queryOptions merge because 'sortMode' is an extra base property
    // not present in the strict input type of the specific strategy.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const strategyOptions = config.options || {};
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
