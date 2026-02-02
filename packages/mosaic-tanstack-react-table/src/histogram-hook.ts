import { useEffect, useMemo, useState } from 'react';
import {
  HistogramStrategy,
  createTypedSidecarClient,
} from '@nozzleio/mosaic-tanstack-table-core';
import { useCoordinator } from '@nozzleio/react-mosaic';
import type {
  HistogramOutput,
  MosaicTableSource,
} from '@nozzleio/mosaic-tanstack-table-core';
import type { Selection } from '@uwdata/mosaic-core';

interface UseMosaicHistogramOptions {
  table: MosaicTableSource;
  column: string;
  step: number;
  /** The global filter (Input) to respect */
  filterBy?: Selection;
  /**
   * If false, the histogram client will not issue queries.
   * @default true
   */
  enabled?: boolean;
}

// Create the strongly typed client class outside the hook
const TypedHistogramClient = createTypedSidecarClient(HistogramStrategy);

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
  enabled = true,
}: UseMosaicHistogramOptions) {
  const coordinator = useCoordinator();
  const [data, setData] = useState<HistogramOutput>([]);

  // Memoize stats to avoid recalculation on every render
  const stats = useMemo(() => {
    const maxCount = Math.max(...data.map((d) => d.count), 0);
    const totalCount = data.reduce((sum, d) => sum + d.count, 0);
    return { maxCount, totalCount };
  }, [data]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    // Instantiate the Typed Client
    // This enforces that 'options' contains 'step' as a number
    const client = new TypedHistogramClient({
      source: table,
      column: column,
      filterBy: filterBy,
      // Histogram usually listens to ALL filters to show current distribution
      getFilters: () => [],
      // Type Safety: options is strictly typed to HistogramInput
      options: { step },
      onResult: (result) => setData(result),
      __debugName: `Histogram:${column}`,
    });

    client.setCoordinator(coordinator);
    const cleanup = client.connect();

    // Trigger initial fetch
    client.requestUpdate();

    return () => {
      cleanup();
      client.disconnect();
    };
  }, [table, column, step, filterBy, coordinator, enabled]);

  return { bins: data, stats };
}
