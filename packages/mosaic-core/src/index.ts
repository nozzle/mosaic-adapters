export { createRowsClient } from './rows-client';
export { createValuesClient } from './values-client';
export { createFacetClient } from './facet-client';
export { createHistogramClient } from './histogram-client';
export {
  histogramBinning,
  histogramBinsFromRows,
  histogramExtentQuery,
  histogramFilter,
  histogramSelect,
} from './histogram';
export type {
  HistogramBase,
  HistogramBinOptions,
  HistogramBinning,
  HistogramBinningOptions,
  HistogramBinsResult,
  HistogramColumn,
  HistogramExtentQueryOptions,
  HistogramScale,
} from './histogram';
export { createSparklineClient } from './sparkline-client';
export { createRollupClient, rollupRowsToTree } from './rollup-client';
export { createPivotClient } from './pivot-client';
export { createSchemaClient } from './schema-client';
export type { SchemaClient, SchemaClientOptions, SchemaClientState } from './schema-client';

export {
  createClearClause,
  createSubqueryClause,
  createValueClause,
  updateClauseIfChanged,
} from './clause-factory';
export type { SubqueryClauseSpec, ValueClauseSpec } from './clause-factory';

export {
  SqlIdentifier,
  createStructAccess,
  createTypedAccess,
  escapeSqlLikePattern,
} from './sql-access';

export { andOrTrue, selectStarExclude, sqlFromParts, tableRef, withRecursive } from './sql-helpers';
export type { SqlTemplateValue, WithRecursiveOptions } from './sql-helpers';

export { isSameQuerySource } from './query-source';

export {
  buildSubqueryClauseParts,
  buildSubqueryPredicate,
  normalizeSubqueryFilterQuery,
} from './subquery-predicate';
export type { BuildSubqueryPredicateOptions, SubqueryFilterQuery } from './subquery-predicate';

export { applyRoutedFilters, routeFilter } from './filter-routing';
export type { RoutedFilterExpr, SqlFilterClauseTarget } from './filter-routing';

export * from './filter-set/index';

export * from './topology/index';

export { createMappedSelection } from './mapped-selection';
export type {
  MappedSelectionHandle,
  MappedSelectionOptions,
  SelectionClauseMap,
} from './mapped-selection';

export { createSkipProjectedSelection } from './skip-projection';
export type { SkipProjectedSelectionHandle } from './skip-projection';

export { isFilterSetPublishTarget } from './types';

export { describeQueryError, isQueryCancellation } from './query-error';
export type { QueryErrorDescription } from './query-error';

export { deepEqual, firstResultRow, resolveCoerce, resultRowCount, toResultRows } from './utils';

export type { Persister, PersisterWriteContext, PersisterWriteReason } from './persistence';

export type {
  CoerceDescriptor,
  CoerceDescriptorMap,
  CoerceOption,
  ColumnPathMode,
  ColumnPathOptions,
  DataClient,
  DataClientOptions,
  DataClientState,
  DataClientStatus,
  FacetClient,
  FacetClientOptions,
  FacetClientState,
  FacetInputs,
  FacetOption,
  FacetSortMode,
  FilterSetPublishTarget,
  HistogramBin,
  HistogramClient,
  HistogramClientOptions,
  HistogramClientState,
  HistogramInputs,
  OrderByItem,
  PivotAggregate,
  PivotClient,
  PivotClientOptions,
  PivotClientState,
  QueryContext,
  QuerySource,
  RollupClient,
  RollupClientOptions,
  RollupClientState,
  RollupInputs,
  RollupRow,
  RollupTreeNode,
  RowCountMode,
  RowsClient,
  RowsClientOptions,
  RowsClientState,
  RowsFilterSetPublishTarget,
  RowsHoverPublishTarget,
  RowsInputs,
  RowsPublishTarget,
  SparklineClient,
  SparklineClientOptions,
  SparklineClientState,
  SparklineInputs,
  SparklinePoint,
  SparklineX,
  SparklineY,
  ValuesClient,
  ValuesClientOptions,
  ValuesClientState,
  ValuesInputs,
} from './types';
