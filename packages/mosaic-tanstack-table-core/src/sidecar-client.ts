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

export interface SidecarConfig<TInput, TOutput> {
  source: MosaicTableSource;
  column: string;
  getFilters: () => Array<FilterExpr>;
  onResult: (data: TOutput) => void;
  filterBy?: Selection;
  options?: Partial<
    Omit<
      FacetQueryContext<TInput>,
      'source' | 'column' | 'cascadingFilters' | 'primaryFilter'
    >
  >;
  __debugName?: string;
}

/**
 * A generic Mosaic Client that delegates query building and result transformation to a Strategy.
 * Enforces runtime validation on the output via the Strategy's validate method.
 */
export class SidecarClient<TInput, TOutput>
  extends MosaicClient
  implements IMosaicClient
{
  private lifecycle = createLifecycleManager(this);

  constructor(
    private config: SidecarConfig<TInput, TOutput>,
    private strategy: FacetStrategy<TInput, TOutput>,
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

  updateSource(source: MosaicTableSource) {
    if (this.config.source !== source) {
      this.config.source = source;
      this.requestUpdate();
    }
  }

  updateRuntimeOptions(
    opts: Partial<
      Omit<
        FacetQueryContext<TInput>,
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

  override query(filter?: FilterExpr): SelectQuery | null {
    const src = this.config.source;
    if (typeof src === 'string' && src.trim() === '') {
      return null;
    }

    const cascadingFilters = this.config.getFilters();
    const primaryFilter = filter;

    const ctx: FacetQueryContext<TInput> = {
      source: this.config.source,
      column: this.config.column,
      cascadingFilters,
      primaryFilter,
      ...(this.config.options as any),
    };

    const statement = this.strategy.buildQuery(ctx);
    const sqlStr = statement.toString();
    logger.debug('SQL', `Sidecar [${this.debugName}] Query: ${sqlStr}`);

    return statement;
  }

  override queryResult(table: unknown): this {
    if (isArrowTable(table)) {
      try {
        // 1. Transform raw Arrow rows into expected shape
        const result = this.strategy.transformResult(
          table.toArray(),
          this.config.column,
        );
        // 2. Validate shape using the strategy's own validator
        const safeResult = this.strategy.validate(result);

        this.config.onResult(safeResult);
      } catch (err) {
        logger.error(
          'Core',
          `[Sidecar ${this.debugName}] Result Validation Failed`,
          {
            error: err,
          },
        );
      }
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
