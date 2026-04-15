import * as React from 'react';
import { SparklineStrategy } from '@nozzleio/mosaic-tanstack-table-core/facet-strategies';
import { createTypedSidecarClient } from '@nozzleio/mosaic-tanstack-table-core/sidecar';
import { useCoordinator } from '@nozzleio/react-mosaic';
import type { MosaicTableSource } from '@nozzleio/mosaic-tanstack-table-core';
import type { Coordinator, Selection } from '@uwdata/mosaic-core';
import type {
  SparklineAggMode,
  SparklineOutput,
} from '@nozzleio/mosaic-tanstack-table-core/facet-strategies';

export type { SparklineAggMode, SparklineOutput };

const EMPTY_SPARKLINE: SparklineOutput = [];
const TypedSparklineClient = createTypedSidecarClient(SparklineStrategy);

export type MosaicSparklineClient = InstanceType<typeof TypedSparklineClient>;

export type UseMosaicSparklineOptions = {
  /** Function-form source that bakes per-row WHERE into the query. */
  table: MosaicTableSource;
  /** Metric column to aggregate (e.g. 'search_volume'). */
  column: string;
  /** Date/time column to group by (e.g. 'requested'). */
  dateColumn: string;
  /** Aggregation mode for the metric column. */
  aggMode: SparklineAggMode;
  /** Selection to filter by. */
  filterBy?: Selection;
  coordinator?: Coordinator;
  /**
   * If false, the sparkline client will not issue queries.
   * @default true
   */
  enabled?: boolean;
};

export type UseMosaicSparklineResult = {
  data: SparklineOutput;
  loading: boolean;
  error: Error | null;
  client: MosaicSparklineClient | null;
};

type SparklineState = {
  data: SparklineOutput;
  loading: boolean;
  error: Error | null;
};

function createInitialState(): SparklineState {
  return {
    data: EMPTY_SPARKLINE,
    loading: false,
    error: null,
  };
}

class ReactSparklineClient extends TypedSparklineClient {
  constructor(
    config: ConstructorParameters<typeof TypedSparklineClient>[0],
    private callbacks: {
      onPending: () => void;
      onError: (error: Error) => void;
    },
  ) {
    super(config);
  }

  override queryPending() {
    this.callbacks.onPending();
    return this;
  }

  override queryError(error: Error) {
    this.callbacks.onError(error);
    return super.queryError(error);
  }
}

function createSparklineClient({
  table,
  column,
  dateColumn,
  aggMode,
  filterBy,
  setState,
}: UseMosaicSparklineOptions & {
  setState: React.Dispatch<React.SetStateAction<SparklineState>>;
}) {
  return new ReactSparklineClient(
    {
      source: table,
      column,
      filterBy,
      getFilters: () => [],
      options: { dateColumn, aggMode },
      onResult: (result) =>
        setState({
          data: result,
          loading: false,
          error: null,
        }),
      __debugName: `Sparkline:${column}`,
    },
    {
      onPending: () =>
        setState((previous) => ({
          ...previous,
          loading: true,
          error: null,
        })),
      onError: (error) =>
        setState((previous) => ({
          ...previous,
          loading: false,
          error,
        })),
    },
  );
}

/**
 * Fetches time-series sparkline data via a SidecarClient.
 * Manages client lifecycle and reacts to filter changes automatically.
 */
export function useMosaicSparkline({
  table,
  column,
  dateColumn,
  aggMode,
  filterBy,
  coordinator: providedCoordinator,
  enabled = true,
}: UseMosaicSparklineOptions): UseMosaicSparklineResult {
  const contextCoordinator = useCoordinator();
  const coordinator = providedCoordinator ?? contextCoordinator;
  const [state, setState] = React.useState<SparklineState>(createInitialState);
  const [client, setClient] = React.useState<MosaicSparklineClient | null>(
    null,
  );

  // Effect 1: Create/recreate client when identity deps change
  React.useEffect(() => {
    const nextClient = createSparklineClient({
      table,
      column,
      dateColumn,
      aggMode,
      filterBy,
      setState,
    });

    setState(createInitialState());
    setClient(nextClient);

    return () => {
      nextClient.disconnect();
    };
  }, [table, column, dateColumn, aggMode, filterBy]);

  // Effect 2: Set coordinator on client
  React.useEffect(() => {
    if (!client) {
      return;
    }

    client.setCoordinator(coordinator);
  }, [client, coordinator]);

  // Effect 3: Connect/disconnect based on enabled state
  React.useEffect(() => {
    if (!client) {
      return;
    }

    if (!enabled) {
      client.disconnect();
      setState(createInitialState());
      return;
    }

    const cleanup = client.connect();
    client.requestUpdate();

    return cleanup;
  }, [client, enabled]);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    client,
  };
}
