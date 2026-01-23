/**
 * Manages "Sidecar" clients for a MosaicDataTable.
 * Ensures only one client exists per column/type pair and handles the automatic
 * teardown of these clients when the host table's context changes.
 * Orchestrates metadata fetching for facets and total counts.
 */
import { SidecarClient } from './sidecar-client';
import { TotalCountStrategy } from './facet-strategies';
import type { MosaicDataTable } from './data-table';
import type { Coordinator } from '@uwdata/mosaic-core';
import type { RowData } from '@tanstack/table-core';
import type { MosaicTableSource, PrimitiveSqlValue } from './types';
import type { SidecarRequest, StrategyRegistry } from './registry';
import type { FacetStrategy } from './facet-strategies';

export class SidecarManager<
  TData extends RowData,
  TValue extends PrimitiveSqlValue = PrimitiveSqlValue,
> {
  private clients = new Map<string, SidecarClient<any, any>>();

  constructor(
    private host: MosaicDataTable<TData, TValue>,
    private facetRegistry: StrategyRegistry<FacetStrategy<any, any>>,
  ) {}

  requestFacet(columnId: string, type: string) {
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

  requestAuxiliary(config: SidecarRequest<TData>) {
    if (this.clients.has(config.id)) {
      return;
    }

    // Retrieve strategy from registry. Discriminated unions in SidecarRequest
    // ensure that config.type matches an available strategy in the registry.
    const strategy = this.facetRegistry.get(config.type)!;

    const sqlColumn =
      this.host.getColumnSqlName(config.column) || config.column;

    const colDef = this.host.getColumnDef(sqlColumn);
    const sortMode = colDef?.meta?.mosaicDataTable?.facetSortMode || 'alpha';

    // We cast to any here because config.options is strictly typed based on the current
    // strategies in the registry.
    const strategyInput = config.options;

    // Do not spread strategyInput. It belongs in the 'options' property of the context.
    // This ensures ctx.options is populated for strategies that require inputs (like step for histograms).
    const queryOptions = {
      sortMode,
      options: strategyInput,
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

  updateSource(_source: MosaicTableSource) {
    // When the data source changes, all existing sidecars (facets) are
    // invalidated and must be cleared immediately.
    this.clear();
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
