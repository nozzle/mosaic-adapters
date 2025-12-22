import { isArrowTable } from '@uwdata/mosaic-core';
import { BaseMosaicClient } from './base-client';
import { logger } from './logger';
import type { FacetQueryContext, FacetStrategy } from './facet-strategies';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type { MosaicTableSource } from './types';
import type { Selection } from '@uwdata/mosaic-core';

export interface SidecarConfig<T> {
  source: MosaicTableSource;
  column: string;
  /**
   * Function to retrieve the current cascading filters from the host table.
   * This is called dynamically at query time.
   */
  getFilters: () => Array<FilterExpr>;
  onResult: (data: T) => void;
  /**
   * Optional global filter selection (e.g. table's filterBy).
   * Usually handled via getFilters() but kept for flexibility.
   */
  filterBy?: Selection;
  /**
   * Initial options for the query context.
   */
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
 * to a Strategy. Used for fetching metadata like Unique Values or Min/Max.
 */
export class SidecarClient<T> extends BaseMosaicClient {
  constructor(
    private config: SidecarConfig<T>,
    private strategy: FacetStrategy<T>,
  ) {
    super(config.filterBy);
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

  get debugName() {
    return this.config.__debugName || 'SidecarClient';
  }
}
