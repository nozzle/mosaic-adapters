import { beforeEach, describe, expect, test, vi } from 'vitest';

import { useMosaicClient } from '../src/hooks/use-mosaic-client';
import {
  MosaicConnectorProvider,
  useMosaicCoordinator,
  type ConnectorMode,
} from '../src/context/connector-provider';
import { useRequireMode } from '../src/hooks/use-require-mode';
import { flushEffects, render } from './test-utils';

import type { Connector, MosaicClient } from '@uwdata/mosaic-core';

type MockConnector = {
  kind: 'default' | 'wasm' | 'remote';
  label?: string;
  failHealthCheck?: Error;
  query: ReturnType<typeof vi.fn<() => Promise<unknown>>>;
};

type MockClient = Pick<MosaicClient, 'filterBy'> & {
  coordinator: MockCoordinator | null;
  initialize: ReturnType<typeof vi.fn<() => void>>;
};

type MockCoordinator = {
  connector: MockConnector;
  clients: Set<MockClient>;
  clear: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  logger: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
};

type MockMosaicCoreModule = typeof import('@uwdata/mosaic-core') & {
  __mock: {
    state: {
      coordinators: Array<MockCoordinator>;
      globalCoordinator: MockCoordinator | null;
      wasmConnector: ReturnType<typeof vi.fn>;
    };
  };
};

vi.mock('@uwdata/mosaic-core', () => {
  type LocalMockClient = {
    coordinator: MockCoordinator | null;
    initialize: ReturnType<typeof vi.fn<() => void>>;
    filterBy?: undefined;
  };

  class MockCoordinatorImpl {
    public readonly clients = new Set<LocalMockClient>();
    public readonly clear = vi.fn((_options?: unknown) => {
      for (const client of Array.from(this.clients)) {
        this.disconnectClient(client);
      }
    });
    public readonly connect = vi.fn((client: LocalMockClient) => {
      this.clients.add(client);
      client.coordinator = this as unknown as MockCoordinator;
      client.initialize();
    });
    public readonly disconnect = vi.fn((client: LocalMockClient) => {
      this.disconnectClient(client);
    });
    public readonly logger = vi.fn();
    public readonly query = vi.fn(async () => {
      if (this.connector.failHealthCheck) {
        throw this.connector.failHealthCheck;
      }
      return 'ok';
    });

    constructor(public readonly connector: MockConnector) {}

    private disconnectClient(client: LocalMockClient) {
      this.clients.delete(client);
      client.coordinator = null;
    }
  }

  const state = {
    coordinators: [] as Array<MockCoordinator>,
    globalCoordinator: null as MockCoordinator | null,
    wasmConnector: vi.fn((options?: Record<string, unknown>) => ({
      kind: 'wasm' as const,
      label: typeof options?.label === 'string' ? options.label : undefined,
      query: vi.fn(async () => undefined),
    })),
  };

  function createDefaultCoordinator() {
    const coordinator = new MockCoordinatorImpl({
      kind: 'default',
      label: 'baseline',
      query: vi.fn(async () => undefined),
    }) as unknown as MockCoordinator;
    state.coordinators.push(coordinator);
    return coordinator;
  }

  return {
    Coordinator: class extends MockCoordinatorImpl {
      constructor(connector: MockConnector) {
        super(connector);
        state.coordinators.push(this as unknown as MockCoordinator);
      }
    },
    coordinator(instance?: MockCoordinator) {
      if (instance) {
        state.globalCoordinator = instance;
      } else if (!state.globalCoordinator) {
        state.globalCoordinator = createDefaultCoordinator();
      }
      return state.globalCoordinator;
    },
    wasmConnector: state.wasmConnector,
    __mock: { state },
  };
});

async function getMockMosaicCore() {
  return (await import('@uwdata/mosaic-core')) as MockMosaicCoreModule;
}

function createRemoteConnector(
  overrides: Partial<MockConnector> = {},
): MockConnector {
  return {
    kind: 'remote',
    query: vi.fn(async () => undefined),
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  const mosaicCore = await getMockMosaicCore();
  mosaicCore.__mock.state.coordinators = [];
  mosaicCore.__mock.state.globalCoordinator = null;
});

function createMockClient(): MockClient {
  return {
    coordinator: null,
    filterBy: undefined,
    initialize: vi.fn(),
  };
}

type CoordinatorSnapshot = {
  mode: ConnectorMode;
  status: 'connecting' | 'connected' | 'error';
  isMosaicInitialized: boolean;
  error: Error | null;
  coordinator: MockCoordinator | null;
  setMode: (mode: ConnectorMode) => void;
};

function ClientProbe({ client }: { client: MockClient }) {
  useMosaicClient(client as unknown as MosaicClient);
  return null;
}

function CoordinatorProbe({
  client,
  onSnapshot,
}: {
  client?: MockClient;
  onSnapshot: (snapshot: CoordinatorSnapshot) => void;
}) {
  const snapshot = useMosaicCoordinator();

  onSnapshot({
    mode: snapshot.mode,
    status: snapshot.status,
    isMosaicInitialized: snapshot.isMosaicInitialized,
    error: snapshot.error,
    coordinator: snapshot.coordinator as unknown as MockCoordinator | null,
    setMode: snapshot.setMode,
  });

  return client && snapshot.coordinator ? (
    <ClientProbe client={client} />
  ) : null;
}

describe('MosaicConnectorProvider', () => {
  test('keeps the previous global coordinator when remote initialization fails', async () => {
    const mosaicCore = await getMockMosaicCore();
    const baseline = mosaicCore.coordinator() as unknown as MockCoordinator;
    const snapshots: Array<CoordinatorSnapshot> = [];

    const view = render(
      <MosaicConnectorProvider
        initialMode="remote"
        remoteConnectorFactory={() =>
          createRemoteConnector({
            failHealthCheck: new Error('remote offline'),
          }) as unknown as Connector
        }
      >
        <CoordinatorProbe onSnapshot={(snapshot) => snapshots.push(snapshot)} />
      </MosaicConnectorProvider>,
    );

    await flushEffects();

    const latestSnapshot = snapshots.at(-1);
    if (!latestSnapshot) {
      throw new Error('Expected a coordinator snapshot.');
    }

    expect(latestSnapshot.status).toBe('error');
    expect(latestSnapshot.coordinator).toBeNull();
    expect(latestSnapshot.error?.message).toBe('remote offline');
    expect(mosaicCore.coordinator()).toBe(baseline);

    view.unmount();
  });

  test('disconnects old clients and reconnects them when switching connector modes', async () => {
    const mosaicCore = await getMockMosaicCore();
    const baseline = mosaicCore.coordinator() as unknown as MockCoordinator;
    const client = createMockClient();
    const snapshots: Array<CoordinatorSnapshot> = [];

    const view = render(
      <MosaicConnectorProvider
        initialMode="wasm"
        remoteConnectorFactory={() =>
          createRemoteConnector() as unknown as Connector
        }
      >
        <CoordinatorProbe
          client={client}
          onSnapshot={(snapshot) => snapshots.push(snapshot)}
        />
      </MosaicConnectorProvider>,
    );

    await flushEffects();

    const wasmSnapshot = snapshots.at(-1);
    if (!wasmSnapshot?.coordinator) {
      throw new Error('Expected the wasm coordinator to be connected.');
    }

    expect(wasmSnapshot.mode).toBe('wasm');
    expect(wasmSnapshot.status).toBe('connected');
    expect(wasmSnapshot.isMosaicInitialized).toBe(true);
    expect(wasmSnapshot.coordinator.clients.has(client)).toBe(true);

    wasmSnapshot.setMode('remote');
    await flushEffects();

    const remoteSnapshot = snapshots.at(-1);
    if (!remoteSnapshot?.coordinator) {
      throw new Error('Expected the remote coordinator to be connected.');
    }

    expect(remoteSnapshot.mode).toBe('remote');
    expect(remoteSnapshot.status).toBe('connected');
    expect(remoteSnapshot.coordinator).not.toBe(wasmSnapshot.coordinator);
    expect(wasmSnapshot.coordinator.clear).toHaveBeenCalledTimes(1);
    expect(wasmSnapshot.coordinator.clients.size).toBe(0);
    expect(remoteSnapshot.coordinator.clients.has(client)).toBe(true);
    expect(client.initialize).toHaveBeenCalledTimes(2);

    view.unmount();

    expect(remoteSnapshot.coordinator.clear).toHaveBeenCalledTimes(1);
    expect(mosaicCore.coordinator()).toBe(baseline);
  });

  test('uses connectionKey as the explicit reconnect trigger for updated remote connector inputs', async () => {
    let remoteLabel = 'first';
    const snapshots: Array<CoordinatorSnapshot> = [];

    const view = render(
      <MosaicConnectorProvider
        initialMode="remote"
        connectionKey="first"
        remoteConnectorFactory={() =>
          createRemoteConnector({
            label: remoteLabel,
          }) as unknown as Connector
        }
      >
        <CoordinatorProbe onSnapshot={(snapshot) => snapshots.push(snapshot)} />
      </MosaicConnectorProvider>,
    );

    await flushEffects();

    const firstCoordinator = snapshots.at(-1)?.coordinator;
    expect(firstCoordinator?.connector.label).toBe('first');

    remoteLabel = 'second';
    view.rerender(
      <MosaicConnectorProvider
        initialMode="remote"
        connectionKey="second"
        remoteConnectorFactory={() =>
          createRemoteConnector({
            label: remoteLabel,
          }) as unknown as Connector
        }
      >
        <CoordinatorProbe onSnapshot={(snapshot) => snapshots.push(snapshot)} />
      </MosaicConnectorProvider>,
    );

    await flushEffects();

    const secondCoordinator = snapshots.at(-1)?.coordinator;
    expect(secondCoordinator?.connector.label).toBe('second');
    expect(secondCoordinator).not.toBe(firstCoordinator);

    view.unmount();
  });

  test('useRequireMode returns readiness while requesting the required mode', async () => {
    const states: Array<{ ready: boolean; mode: ConnectorMode }> = [];

    function RequireModeProbe() {
      const coordinator = useMosaicCoordinator();
      const ready = useRequireMode('remote');
      states.push({ ready, mode: coordinator.mode });
      return null;
    }

    const view = render(
      <MosaicConnectorProvider
        initialMode="wasm"
        remoteConnectorFactory={() =>
          createRemoteConnector() as unknown as Connector
        }
      >
        <RequireModeProbe />
      </MosaicConnectorProvider>,
    );

    await flushEffects();

    expect(states.some((state) => state.ready === false)).toBe(true);
    expect(states.at(-1)).toEqual({ ready: true, mode: 'remote' });

    view.unmount();
  });
});
