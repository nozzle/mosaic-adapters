/**
 * Lifecycle tests for the app-owned `ConnectorProvider` (recipe 1). Every
 * connection is created by an effect whose cleanup disposes it, so:
 *
 * - the subtree using a connection is torn down before `coordinator.clear()`
 *   runs (reconnect and provider unmount alike);
 * - a DuckDB-WASM instance that started is terminated, but only after its
 *   in-flight start settles;
 * - a connector that never queried is disposed without starting DuckDB (the
 *   StrictMode throwaway mount is the usual case).
 *
 * `wasmConnector()` is replaced with a fake that records how it is driven, and
 * `Coordinator` with a subclass that logs `clear()` calls made after
 * construction; everything else is the real `@uwdata/mosaic-core`.
 */
import { act, render, settle } from '@nozzleio/test-support/react';
import type { Coordinator } from '@uwdata/mosaic-core';
import { StrictMode, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Mock, MockInstance } from 'vitest';

import { ConnectorProvider, useConnector } from '../src/connector';
import type { ConnectorState } from '../src/connector';

/** The DuckDB-WASM instance surface the provider touches on disposal. */
interface FakeDuckDB {
  terminate: Mock<() => Promise<void>>;
}

/** Stand-in for `DuckDBWASMConnector`: lazy, and started only by a test. */
interface FakeConnector {
  label: number;
  query: Mock<() => Promise<undefined>>;
  getDuckDB: Mock<() => Promise<FakeDuckDB>>;
  _loadPromise?: Promise<unknown>;
  _db?: FakeDuckDB;
}

const harness = vi.hoisted(() => ({
  /** Ordered lifecycle log: `clear:<n>`, `terminate:<n>`, `mount:<n>`, `unmount:<n>`. */
  events: [] as Array<string>,
  connectors: [] as Array<FakeConnector>,
}));

vi.mock('@uwdata/mosaic-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@uwdata/mosaic-core')>();
  const constructed = new WeakSet<object>();

  /** Logs `clear()` calls made after construction (the constructor clears once). */
  class TrackedCoordinator extends actual.Coordinator {
    constructor(...args: ConstructorParameters<typeof actual.Coordinator>) {
      super(...args);
      constructed.add(this);
    }

    override clear(options?: Parameters<InstanceType<typeof actual.Coordinator>['clear']>[0]) {
      if (constructed.has(this)) {
        const connector = this.databaseConnector() as unknown as FakeConnector;
        harness.events.push(`clear:${connector.label}`);
      }
      super.clear(options);
    }
  }

  function wasmConnector(): FakeConnector {
    const connector: FakeConnector = {
      label: harness.connectors.length,
      query: vi.fn(() => Promise.resolve(undefined)),
      getDuckDB: vi.fn(() =>
        Promise.reject(new Error('DuckDB must not start during these tests.')),
      ),
    };
    harness.connectors.push(connector);
    return connector;
  }

  return { ...actual, Coordinator: TrackedCoordinator, wasmConnector };
});

function connectorAt(index: number): FakeConnector {
  const connector = harness.connectors[index];
  if (connector === undefined) {
    throw new Error(`No connector was created at index ${index}.`);
  }
  return connector;
}

function labelOf(coordinator: Coordinator): number {
  return (coordinator.databaseConnector() as unknown as FakeConnector).label;
}

/** A controllable in-flight DuckDB start, shaped like the upstream connector's. */
interface PendingStart {
  terminate: FakeDuckDB['terminate'];
  /** Instantiation and connection succeed. */
  succeed: () => void;
  /** Instantiation succeeded (`_db` assigned) but opening/connecting failed. */
  failAfterInstantiate: () => void;
  /** Instantiation itself failed: upstream never assigns `_db`. */
  failDuringInstantiate: () => void;
}

/** Simulate the connector's first query starting DuckDB. */
function startDuckDB(connector: FakeConnector): PendingStart {
  const terminate = vi.fn(() => {
    harness.events.push(`terminate:${connector.label}`);
    return Promise.resolve();
  });
  let resolveLoad: (value: unknown) => void = () => {};
  let rejectLoad: (reason: unknown) => void = () => {};
  connector._loadPromise = new Promise((resolve, reject) => {
    resolveLoad = resolve;
    rejectLoad = reject;
  });
  return {
    terminate,
    succeed: () => {
      connector._db = { terminate };
      resolveLoad(undefined);
    },
    failAfterInstantiate: () => {
      connector._db = { terminate };
      rejectLoad(new Error('connect failed'));
    },
    failDuringInstantiate: () => {
      rejectLoad(new Error('instantiate failed'));
    },
  };
}

/** The connector state the subtree last committed against. */
const probe: { latest: ConnectorState | null } = { latest: null };

/** Stands in for the page's Mosaic clients: logs mount/unmount per connection. */
function Client() {
  const state = useConnector();
  const label = labelOf(state.coordinator);
  useEffect(() => {
    probe.latest = state;
  }, [state]);
  useEffect(() => {
    harness.events.push(`mount:${label}`);
    return () => {
      harness.events.push(`unmount:${label}`);
    };
  }, [label]);
  return <output>{state.connectionId}</output>;
}

function currentState(): ConnectorState {
  if (probe.latest === null) {
    throw new Error('The connector subtree has not rendered.');
  }
  return probe.latest;
}

/** Assert `before` was logged, and logged earlier than `after`. */
function expectOrder(before: string, after: string): void {
  const beforeIndex = harness.events.indexOf(before);
  const afterIndex = harness.events.indexOf(after);
  expect(beforeIndex, `${before} missing from ${harness.events.join(', ')}`).toBeGreaterThan(-1);
  expect(afterIndex, `${after} missing from ${harness.events.join(', ')}`).toBeGreaterThan(-1);
  expect(beforeIndex, harness.events.join(', ')).toBeLessThan(afterIndex);
}

let consoleWarn: MockInstance<Console['warn']>;

beforeEach(() => {
  harness.events.length = 0;
  harness.connectors.length = 0;
  probe.latest = null;
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  consoleWarn.mockRestore();
});

describe('ConnectorProvider lifecycle', () => {
  test('renders nothing until the effect has created a connection', async () => {
    const view = await render(
      <ConnectorProvider>
        <Client />
      </ConnectorProvider>,
    );

    expect(harness.connectors).toHaveLength(1);
    expect(currentState().connectionId).toBe(0);
    expect(labelOf(currentState().coordinator)).toBe(0);
    expect(view.container.textContent).toBe('0');
  });

  test('provider unmount: clients go first, a started worker is terminated once loading settles', async () => {
    const view = await render(
      <ConnectorProvider>
        <Client />
      </ConnectorProvider>,
    );
    const start = startDuckDB(connectorAt(0));

    view.unmount();
    await settle();

    expect(harness.events).toEqual(['mount:0', 'unmount:0', 'clear:0']);
    // Still loading: termination waits for the start to settle.
    expect(start.terminate).not.toHaveBeenCalled();

    start.succeed();
    await settle();

    expect(start.terminate).toHaveBeenCalledTimes(1);
    expect(harness.events).toEqual(['mount:0', 'unmount:0', 'clear:0', 'terminate:0']);
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  test('reconnect: the old subtree unmounts before its coordinator clears, then a fresh connection mounts', async () => {
    await render(
      <ConnectorProvider>
        <Client />
      </ConnectorProvider>,
    );
    const first = currentState();
    const start = startDuckDB(connectorAt(0));
    start.succeed();
    await settle();

    act(() => {
      first.recreate();
    });
    await settle();

    const second = currentState();
    expect(second.connectionId).toBe(1);
    expect(second.coordinator).not.toBe(first.coordinator);
    expect(labelOf(second.coordinator)).toBe(1);

    expectOrder('unmount:0', 'clear:0');
    expectOrder('clear:0', 'terminate:0');
    expect(start.terminate).toHaveBeenCalledTimes(1);
    // The fresh connection is live, and nothing disposed it.
    expect(harness.events).toContain('mount:1');
    expect(harness.events).not.toContain('clear:1');
    expect(harness.events.filter((event) => event === 'unmount:1')).toEqual([]);
  });

  test('a connector that never queried is disposed without starting DuckDB', async () => {
    const view = await render(
      <ConnectorProvider>
        <Client />
      </ConnectorProvider>,
    );

    act(() => {
      currentState().recreate();
    });
    view.unmount();
    await settle();

    expect(harness.connectors).toHaveLength(2);
    for (const connector of harness.connectors) {
      expect(connector._loadPromise).toBeUndefined();
      expect(connector.getDuckDB).not.toHaveBeenCalled();
      expect(connector.query).not.toHaveBeenCalled();
    }
    expect(harness.events.filter((event) => event.startsWith('terminate:'))).toEqual([]);
    expectOrder('unmount:0', 'clear:0');
    expectOrder('unmount:1', 'clear:1');
  });

  test('StrictMode: the throwaway connection is disposed unstarted and never reaches the subtree', async () => {
    const view = await render(
      <StrictMode>
        <ConnectorProvider>
          <Client />
        </ConnectorProvider>
      </StrictMode>,
    );
    await settle();

    // StrictMode replays the effect: connection 0 is created and disposed, and
    // connection 1 is the one the subtree uses.
    expect(harness.connectors).toHaveLength(2);
    expect(labelOf(currentState().coordinator)).toBe(1);
    expect(currentState().connectionId).toBe(0);

    const throwaway = connectorAt(0);
    expect(throwaway.getDuckDB).not.toHaveBeenCalled();
    expect(throwaway.query).not.toHaveBeenCalled();
    expect(harness.events).toContain('clear:0');
    expect(harness.events.some((event) => event === 'mount:0' || event === 'unmount:0')).toBe(
      false,
    );
    expect(harness.events).not.toContain('clear:1');

    const start = startDuckDB(connectorAt(1));
    start.succeed();
    view.unmount();
    await settle();

    expect(harness.events.slice(-3)).toEqual(['unmount:1', 'clear:1', 'terminate:1']);
    expect(start.terminate).toHaveBeenCalledTimes(1);
  });

  test('a start that failed after instantiation still terminates the instance it produced', async () => {
    const view = await render(
      <ConnectorProvider>
        <Client />
      </ConnectorProvider>,
    );
    const start = startDuckDB(connectorAt(0));

    view.unmount();
    start.failAfterInstantiate();
    await settle();

    expect(start.terminate).toHaveBeenCalledTimes(1);
    expect(harness.events).toEqual(['mount:0', 'unmount:0', 'clear:0', 'terminate:0']);
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  test('a start that failed during instantiation has no instance to terminate', async () => {
    const view = await render(
      <ConnectorProvider>
        <Client />
      </ConnectorProvider>,
    );
    const start = startDuckDB(connectorAt(0));

    view.unmount();
    start.failDuringInstantiate();
    await settle();

    // Upstream assigns `_db` only after instantiation succeeds, so there is
    // nothing reachable to terminate — and the rejection is swallowed.
    expect(connectorAt(0)._db).toBeUndefined();
    expect(start.terminate).not.toHaveBeenCalled();
    expect(harness.events).toEqual(['mount:0', 'unmount:0', 'clear:0']);
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  test('a failing terminate is reported, not thrown', async () => {
    const view = await render(
      <ConnectorProvider>
        <Client />
      </ConnectorProvider>,
    );
    const start = startDuckDB(connectorAt(0));
    start.terminate.mockRejectedValueOnce(new Error('terminate failed'));
    start.succeed();

    view.unmount();
    await settle();

    expect(start.terminate).toHaveBeenCalledTimes(1);
    expect(consoleWarn).toHaveBeenCalledWith(
      '[nozzle-paa] Failed to terminate DuckDB-WASM.',
      expect.any(Error),
    );
  });
});
