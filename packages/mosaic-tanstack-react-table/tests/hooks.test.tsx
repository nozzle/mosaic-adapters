import * as React from 'react';
import { act } from 'react';
import { Store } from '@tanstack/react-store';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  useMosaicHistogram,
  useMosaicReactTable,
  useMosaicTableFacetMenu,
  useMosaicTableFilter,
} from '../src/index';
import { flushEffects, render } from './test-utils';

type MockCoordinator = {
  id: string;
};

const { mockState } = vi.hoisted(() => ({
  mockState: {
    coordinator: { id: 'context' } as MockCoordinator,
    tableClients: [] as Array<unknown>,
    facetClients: [] as Array<unknown>,
    histogramClients: [] as Array<unknown>,
  },
}));

vi.mock('@nozzleio/react-mosaic', () => ({
  useCoordinator: () => mockState.coordinator,
}));

vi.mock('@nozzleio/mosaic-tanstack-table-core', async () => {
  class MockTableClient {
    public readonly store = new Store({ version: 0 });
    public readonly groupedStore = new Store({
      expanded: {},
      loadingGroupIds: [],
      totalRootRows: 0,
      isRootLoading: false,
    });
    public readonly cleanup = vi.fn();
    public readonly connect = vi.fn(() => this.cleanup);
    public readonly disconnect = vi.fn();
    public readonly updateOptions = vi.fn((options: unknown) => {
      this.options = options;
    });
    public readonly getTableOptions = vi.fn((state: { version: number }) => ({
      data: [state.version],
      columns: [],
    }));

    constructor(public options: unknown) {}
  }

  class MockMosaicFacetMenu {
    public readonly store = new Store({
      options: [] as Array<unknown>,
      displayOptions: [] as Array<unknown>,
      loading: false,
      selectedValues: [] as Array<unknown>,
      hasMore: true,
    });
    public readonly cleanup = vi.fn();
    public readonly connect = vi.fn(() => this.cleanup);
    public readonly disconnect = vi.fn();
    public readonly updateOptions = vi.fn((options: unknown) => {
      this.options = options;
    });
    public readonly setSearchTerm = vi.fn();
    public readonly toggle = vi.fn();
    public readonly clear = vi.fn();
    public readonly loadMore = vi.fn();

    constructor(public options: unknown) {}
  }

  class MockMosaicFilter {
    public readonly dispose = vi.fn();
    public readonly setValue = vi.fn();

    constructor(public readonly options: unknown) {}
  }

  return {
    HistogramStrategy: { key: 'histogram' },
    createMosaicDataTableClient: (options: unknown) => {
      const client = new MockTableClient(options);
      mockState.tableClients.push(client);
      return client;
    },
    MosaicFacetMenu: class extends MockMosaicFacetMenu {
      constructor(options: unknown) {
        super(options);
        mockState.facetClients.push(this);
      }
    },
    MosaicFilter: MockMosaicFilter,
  };
});

vi.mock('@nozzleio/mosaic-tanstack-table-core/sidecar', () => {
  class MockHistogramClient {
    public readonly cleanup = vi.fn();
    public readonly connect = vi.fn(() => this.cleanup);
    public readonly disconnect = vi.fn();
    public readonly setCoordinator = vi.fn((coordinator: unknown) => {
      this.coordinator = coordinator;
    });
    public readonly requestUpdate = vi.fn(() => {
      this.queryPending();
      return this;
    });
    public readonly updateRuntimeOptions = vi.fn((options: unknown) => {
      this.runtimeOptions = options;
      this.requestUpdate();
    });
    public coordinator: unknown;
    public runtimeOptions: unknown;

    constructor(
      public readonly config: { onResult: (result: unknown) => void },
    ) {
      mockState.histogramClients.push(this);
    }

    queryPending() {
      return this;
    }

    queryError(_error: Error) {
      return this;
    }

    emitResult(result: unknown) {
      this.config.onResult(result);
    }

    fail(error: Error) {
      this.queryError(error);
    }
  }

  return {
    createTypedSidecarClient: () => MockHistogramClient,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mockState.coordinator = { id: 'context' };
  mockState.tableClients = [];
  mockState.facetClients = [];
  mockState.histogramClients = [];
});

describe('useMosaicReactTable', () => {
  test('normalizes coordinator wiring and only connects while enabled', async () => {
    const snapshots: Array<{ tableOptions: { data: Array<number> } }> = [];
    const explicitCoordinator = { id: 'explicit' };

    function Probe({
      enabled,
      coordinator,
    }: {
      enabled: boolean;
      coordinator?: MockCoordinator;
    }) {
      const { tableOptions } = useMosaicReactTable({
        table: 'athletes',
        columns: [],
        enabled,
        coordinator: coordinator as never,
      });

      snapshots.push({
        tableOptions: tableOptions as { data: Array<number> },
      });

      return null;
    }

    const view = render(<Probe enabled={false} />);
    await flushEffects();

    const client = mockState.tableClients[0] as {
      options: unknown;
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      updateOptions: ReturnType<typeof vi.fn>;
      cleanup: ReturnType<typeof vi.fn>;
      store: Store<{ version: number }>;
    };
    expect(client.options).toMatchObject({
      coordinator: mockState.coordinator,
      enabled: false,
    });
    expect(client.connect).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledTimes(1);

    view.rerender(<Probe enabled={true} coordinator={explicitCoordinator} />);
    await flushEffects();

    expect(client.updateOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        coordinator: explicitCoordinator,
        enabled: true,
      }),
    );
    expect(client.connect).toHaveBeenCalledTimes(1);

    await act(async () => {
      client.store.setState(() => ({ version: 1 }));
    });
    await flushEffects();

    expect(snapshots.at(-1)?.tableOptions.data).toEqual([1]);

    view.rerender(<Probe enabled={false} coordinator={explicitCoordinator} />);
    await flushEffects();

    expect(client.cleanup).toHaveBeenCalledTimes(1);
    expect(client.disconnect).toHaveBeenCalledTimes(2);

    view.unmount();
  });
});

describe('useMosaicTableFacetMenu', () => {
  test('connects only while enabled and exposes the cleaned hook API', async () => {
    const snapshots: Array<{
      loading: boolean;
      displayOptions: Array<unknown>;
      selectedValues: Array<unknown>;
      hasMore: boolean;
    }> = [];
    let controls: ReturnType<typeof useMosaicTableFacetMenu> | undefined;

    function Probe({ enabled }: { enabled: boolean }) {
      controls = useMosaicTableFacetMenu({
        table: 'athletes',
        column: 'sport',
        selection: {} as never,
        enabled,
      });

      snapshots.push({
        loading: controls.loading,
        displayOptions: controls.displayOptions,
        selectedValues: controls.selectedValues,
        hasMore: controls.hasMore,
      });

      return null;
    }

    const view = render(<Probe enabled={false} />);
    await flushEffects();

    const client = mockState.facetClients[0] as {
      options: unknown;
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      cleanup: ReturnType<typeof vi.fn>;
      setSearchTerm: ReturnType<typeof vi.fn>;
      toggle: ReturnType<typeof vi.fn>;
      clear: ReturnType<typeof vi.fn>;
      loadMore: ReturnType<typeof vi.fn>;
      store: Store<{
        options: Array<unknown>;
        displayOptions: Array<unknown>;
        loading: boolean;
        selectedValues: Array<unknown>;
        hasMore: boolean;
      }>;
    };
    expect(client.options).toMatchObject({
      coordinator: mockState.coordinator,
      enabled: false,
    });
    expect(client.connect).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledTimes(1);

    view.rerender(<Probe enabled={true} />);
    await flushEffects();
    expect(client.connect).toHaveBeenCalledTimes(1);

    await act(async () => {
      client.store.setState(() => ({
        options: ['cycling'],
        displayOptions: ['cycling'],
        loading: true,
        selectedValues: ['cycling'],
        hasMore: false,
      }));
    });
    await flushEffects();

    expect(snapshots.at(-1)).toEqual({
      loading: true,
      displayOptions: ['cycling'],
      selectedValues: ['cycling'],
      hasMore: false,
    });

    controls?.setSearchTerm('road');
    controls?.toggle('cycling');
    controls?.select('rowing');
    controls?.clear();
    controls?.loadMore();

    expect(client.setSearchTerm).toHaveBeenCalledWith('road');
    expect(client.toggle).toHaveBeenCalledWith('cycling');
    expect(client.clear).toHaveBeenCalledTimes(2);
    expect(client.toggle).toHaveBeenLastCalledWith('rowing');
    expect(client.loadMore).toHaveBeenCalledTimes(1);

    view.rerender(<Probe enabled={false} />);
    await flushEffects();

    expect(client.cleanup).toHaveBeenCalledTimes(1);
    expect(client.disconnect).toHaveBeenCalledTimes(2);

    view.unmount();
  });
});

describe('useMosaicTableFilter', () => {
  test('keeps a stable filter instance until its configuration changes and disposes on cleanup', async () => {
    const instances: Array<unknown> = [];
    const selection = {} as never;

    function Probe({ column }: { column: string }) {
      const filter = useMosaicTableFilter({
        selection,
        column,
        mode: 'TEXT',
      });
      instances.push(filter);
      return null;
    }

    const view = render(<Probe column="name" />);
    await flushEffects();

    view.rerender(<Probe column="name" />);
    await flushEffects();
    expect(instances[0]).toBe(instances[1]);

    view.rerender(<Probe column="sport" />);
    await flushEffects();

    const first = instances[0] as { dispose: ReturnType<typeof vi.fn> };
    const second = instances[2] as { dispose: ReturnType<typeof vi.fn> };

    expect(second).not.toBe(first);
    expect(first.dispose).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(second.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('useMosaicHistogram', () => {
  test('tracks loading, results, errors, and clears stale bins while disabled', async () => {
    const snapshots: Array<{
      bins: Array<{ bin: number; count: number }>;
      loading: boolean;
      error: string | null;
      maxCount: number;
      client: unknown;
    }> = [];

    function Probe({ enabled, step }: { enabled: boolean; step: number }) {
      const histogram = useMosaicHistogram({
        table: 'athletes',
        column: 'height',
        step,
        enabled,
      });

      snapshots.push({
        bins: histogram.bins,
        loading: histogram.loading,
        error: histogram.error?.message ?? null,
        maxCount: histogram.stats.maxCount,
        client: histogram.client,
      });

      return null;
    }

    const view = render(<Probe enabled={false} step={5} />);
    await flushEffects();

    const client = mockState.histogramClients[0] as {
      setCoordinator: ReturnType<typeof vi.fn>;
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      cleanup: ReturnType<typeof vi.fn>;
      requestUpdate: ReturnType<typeof vi.fn>;
      updateRuntimeOptions: ReturnType<typeof vi.fn>;
      emitResult: (result: unknown) => void;
      fail: (error: Error) => void;
    };
    expect(client.setCoordinator).toHaveBeenCalledWith(mockState.coordinator);
    expect(client.connect).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(snapshots.at(-1)).toMatchObject({
      bins: [],
      loading: false,
      error: null,
    });

    view.rerender(<Probe enabled={true} step={5} />);
    await flushEffects();

    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.requestUpdate).toHaveBeenCalledTimes(2);
    expect(snapshots.at(-1)?.loading).toBe(true);

    await act(async () => {
      client.emitResult([
        { bin: 150, count: 2 },
        { bin: 155, count: 5 },
      ]);
    });
    await flushEffects();

    expect(snapshots.at(-1)).toMatchObject({
      bins: [
        { bin: 150, count: 2 },
        { bin: 155, count: 5 },
      ],
      loading: false,
      error: null,
      maxCount: 5,
      client,
    });

    view.rerender(<Probe enabled={true} step={10} />);
    await flushEffects();

    expect(mockState.histogramClients).toHaveLength(1);
    expect(client.updateRuntimeOptions).toHaveBeenLastCalledWith({
      options: { step: 10 },
    });

    await act(async () => {
      client.fail(new Error('sidecar failed'));
    });
    await flushEffects();

    expect(snapshots.at(-1)).toMatchObject({
      error: 'sidecar failed',
      loading: false,
    });

    view.rerender(<Probe enabled={false} step={10} />);
    await flushEffects();

    expect(client.cleanup).toHaveBeenCalledTimes(1);
    expect(client.disconnect).toHaveBeenCalledTimes(2);
    expect(snapshots.at(-1)).toMatchObject({
      bins: [],
      loading: false,
      error: null,
    });

    view.unmount();
  });
});
