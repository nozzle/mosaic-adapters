import {
  MosaicClient,
  coordinator as defaultCoordinator,
  isArrowTable,
} from '@uwdata/mosaic-core';
import { logger } from './logger';
import { createLifecycleManager, handleQueryError } from './client-utils';
import type { FacetQueryContext, FacetStrategy } from './facet-strategies';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type { IMosaicClient, MosaicTableSource } from './types';
import type { Coordinator, Selection } from '@uwdata/mosaic-core';

export interface SidecarConfig<T> {
  source: MosaicTableSource;
  column: string;
  /**
   * Function to retrieve the current cascading filters from the host table.
   */
  getFilters: () => Array<FilterExpr>;
  onResult: (data: T) => void;
  filterBy?: Selection;
  options?: Partial<
    Omit<
      FacetQueryContext,
      'source' | 'column' | 'cascadingFilters' | 'primaryFilter'
    >
  >;
  __debugName?: string;
}

/**
 * A generic Mosaic Client that delegates query building and result transformation
 * to a Strategy.
 */
export class SidecarClient<T> extends MosaicClient implements IMosaicClient {
  private lifecycle = createLifecycleManager(this);

  constructor(
    private config: SidecarConfig<T>,
    private strategy: FacetStrategy<T>,
  ) {
    super(config.filterBy);
    this.coordinator = defaultCoordinator();
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

  setCoordinatorRef(coordinator: Coordinator) {
    this.coordinator = coordinator;
  }

  disconnect() {
    this.lifecycle.disconnect(this.coordinator);
  }

  /**
   * Update runtime options (like search term) and trigger a re-query.
   */
  updateRuntimeOptions(
    opts: Partial<
      Omit<
        FacetQueryContext,
        'source' | 'column' | 'cascadingFilters' | 'primaryFilter'
      >
    >,
  ) {
    this.config.options = { ...this.config.options, ...opts };
    this.requestUpdate();
  }

  override requestQuery(query?: any): Promise<any> | null {
    if (!this.coordinator) {
      return Promise.resolve();
    }
    return super.requestQuery(query);
  }

  override query(filter?: FilterExpr): SelectQuery {
    const cascadingFilters = this.config.getFilters();
    const primaryFilter = filter;

    const ctx: FacetQueryContext = {
      source: this.config.source,
      column: this.config.column,
      cascadingFilters,
      primaryFilter,
      ...this.config.options,
    };

    const statement = this.strategy.buildQuery(ctx);

    const sqlStr = statement.toString();
    logger.debug('SQL', `Sidecar [${this.debugName}] Query: ${sqlStr}`);

    return statement;
  }

  override queryResult(table: unknown): this {
    if (isArrowTable(table)) {
      const result = this.strategy.transformResult(
        table.toArray(),
        this.config.column,
      );
      this.config.onResult(result);
    }
    return this;
  }

  override queryError(error: Error): this {
    handleQueryError(this.debugName, error);
    return this;
  }

  get debugName() {
    return this.config.__debugName || 'SidecarClient';
  }
}
