import * as React from 'react';
import { HistogramStrategy } from '@nozzleio/mosaic-tanstack-table-core/facet-strategies';
import { createTypedSidecarClient } from '@nozzleio/mosaic-tanstack-table-core/sidecar';
import { useCoordinator } from '@nozzleio/react-mosaic';
import type { MosaicTableSource } from '@nozzleio/mosaic-tanstack-table-core';
import type { Coordinator, Selection } from '@uwdata/mosaic-core';
import type { HistogramOutput } from '@nozzleio/mosaic-tanstack-table-core/facet-strategies';

const EMPTY_HISTOGRAM: HistogramOutput = [];
const TypedHistogramClient = createTypedSidecarClient(HistogramStrategy);

export interface UseMosaicHistogramOptions {
  table: MosaicTableSource;
  column: string;
  step: number;
  /** The global filter (Input) to respect */
  filterBy?: Selection;
  coordinator?: Coordinator;
  /**
   * If false, the histogram client will not issue queries.
   * @default true
   */
  enabled?: boolean;
}

export type MosaicHistogramClient = InstanceType<typeof TypedHistogramClient>;

export interface UseMosaicHistogramResult {
  bins: HistogramOutput;
  stats: {
    maxCount: number;
    totalCount: number;
  };
  loading: boolean;
  error: Error | null;
  client: MosaicHistogramClient | null;
}

type HistogramState = {
  bins: HistogramOutput;
  loading: boolean;
  error: Error | null;
};

function createInitialHistogramState(): HistogramState {
  return {
    bins: EMPTY_HISTOGRAM,
    loading: false,
    error: null,
  };
}

class ReactHistogramClient extends TypedHistogramClient {
  constructor(
    config: ConstructorParameters<typeof TypedHistogramClient>[0],
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

function createHistogramClient({
  table,
  column,
  step,
  filterBy,
  setState,
}: UseMosaicHistogramOptions & {
  setState: React.Dispatch<React.SetStateAction<HistogramState>>;
}) {
  return new ReactHistogramClient(
    {
      source: table,
      column,
      filterBy,
      getFilters: () => [],
      options: { step },
      onResult: (result) =>
        setState({
          bins: result,
          loading: false,
          error: null,
        }),
      __debugName: `Histogram:${column}`,
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
 * A specialized hook for fetching histogram data via a Sidecar Client.
 * Automatically manages the lifecycle of the client and updates state on changes.
 *
 * Now uses the TypedSidecarClient for strict input checking and returns calculated stats.
 */
export function useMosaicHistogram({
  table,
  column,
  step,
  filterBy,
  coordinator: providedCoordinator,
  enabled = true,
}: UseMosaicHistogramOptions): UseMosaicHistogramResult {
  const contextCoordinator = useCoordinator();
  const coordinator = providedCoordinator ?? contextCoordinator;
  const [state, setState] = React.useState<HistogramState>(
    createInitialHistogramState,
  );
  const [client, setClient] = React.useState<MosaicHistogramClient | null>(
    null,
  );
  const getInitialStep = React.useEffectEvent(() => step);

  React.useEffect(() => {
    const nextClient = createHistogramClient({
      table,
      column,
      step: getInitialStep(),
      filterBy,
      setState,
    });

    setState(createInitialHistogramState());
    setClient(nextClient);

    return () => {
      nextClient.disconnect();
    };
  }, [column, filterBy, table]);

  React.useEffect(() => {
    if (!client) {
      return;
    }

    client.setCoordinator(coordinator);
  }, [client, coordinator]);

  React.useEffect(() => {
    if (!client || !enabled) {
      return;
    }

    client.updateRuntimeOptions({
      options: { step },
    });
  }, [client, enabled, step]);

  React.useEffect(() => {
    if (!client) {
      return;
    }

    if (!enabled) {
      client.disconnect();
      setState(createInitialHistogramState());
      return;
    }

    const cleanup = client.connect();
    client.requestUpdate();

    return cleanup;
  }, [client, enabled]);

  const stats = React.useMemo(() => {
    const maxCount = Math.max(...state.bins.map((d) => d.count), 0);
    const totalCount = state.bins.reduce((sum, d) => sum + d.count, 0);
    return { maxCount, totalCount };
  }, [state.bins]);

  return {
    bins: state.bins,
    stats,
    loading: state.loading,
    error: state.error,
    client,
  };
}
