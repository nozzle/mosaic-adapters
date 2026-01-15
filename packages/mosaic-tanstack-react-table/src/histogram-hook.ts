import { useEffect, useState } from 'react';
import {
  HistogramStrategy,
  SidecarClient,
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
}

/**
 * A specialized hook for fetching histogram data via a Sidecar Client.
 * Automatically manages the lifecycle of the client and updates state on changes.
 */
export function useMosaicHistogram({
  table,
  column,
  step,
  filterBy,
}: UseMosaicHistogramOptions) {
  const coordinator = useCoordinator();
  const [data, setData] = useState<HistogramOutput>([]);

  useEffect(() => {
    // Instantiate the Sidecar Client directly
    // This bypasses the Table Core's manager but uses the same robust base class
    const client = new SidecarClient(
      {
        source: table,
        column: column,
        filterBy: filterBy,
        // Histogram usually listens to ALL filters to show current distribution
        // Cascading filters can be passed here if specific exclusion logic is needed
        getFilters: () => [],
        // The SidecarClient expects options to be passed as a partial context.
        // The FacetQueryContext defines 'options' as the field holding TInput (HistogramInput).
        options: { options: { step } },
        onResult: (result) => setData(result),
        __debugName: `Histogram:${column}`,
      },
      HistogramStrategy,
    );

    client.setCoordinator(coordinator);
    const cleanup = client.connect();

    // Trigger initial fetch
    client.requestUpdate();

    return () => {
      cleanup();
      client.disconnect();
    };
  }, [table, column, step, filterBy, coordinator]);

  return data;
}
