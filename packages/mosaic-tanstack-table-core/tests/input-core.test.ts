import { Param, Selection } from '@uwdata/mosaic-core';
import { describe, expect, test } from 'vitest';
import {
  BaseInputCore,
  isScalarParamTarget,
  isSelectionTarget,
  subscribeParamStringSource,
  subscribeScalarParamValue,
} from '../src/input-core';
import type { BaseInputCoreConfig, MosaicInputSource } from '../src/input-core';

type TestState = {
  value: string;
  count: number;
};

type TestConfig = BaseInputCoreConfig & {
  source?: MosaicInputSource;
};

class FakeCoordinator {
  readonly connectedClients = new Set<unknown>();
  readonly requests: Array<unknown> = [];
  connectCount = 0;
  disconnectCount = 0;

  connect(client: {
    coordinator: FakeCoordinator | null;
    initialize: () => void;
  }) {
    this.connectCount += 1;
    this.connectedClients.add(client);
    client.coordinator = this;
    client.initialize();
  }

  disconnect(client: { coordinator: FakeCoordinator | null }) {
    if (!this.connectedClients.has(client)) {
      return;
    }

    this.disconnectCount += 1;
    this.connectedClients.delete(client);
    client.coordinator = null;
  }

  requestQuery(client: unknown, query: unknown) {
    this.requests.push(query);
    return Promise.resolve(client);
  }
}

class TestInputCore extends BaseInputCore<TestState, TestConfig> {
  connectHooks = 0;
  disconnectHooks = 0;
  cleanupRuns = 0;
  configChanges = 0;

  constructor(config: TestConfig) {
    super({ value: 'initial', count: 0 }, config);
  }

  override query() {
    return 'SELECT 1';
  }

  exposeSetState(patch: Partial<TestState>) {
    this.setState(patch);
  }

  addTestCleanup() {
    this.addSubscription(() => {
      this.cleanupRuns += 1;
    });
  }

  protected override onConnect(): void {
    this.connectHooks += 1;
  }

  protected override onDisconnect(): void {
    this.disconnectHooks += 1;
  }

  protected override onConfigChange(): void {
    this.configChanges += 1;
  }
}

async function flushParam<TValue>(param: Param<TValue>) {
  await param.pending('value');
}

describe('input-core primitives', () => {
  test('creates an initial TanStack Store for render state', () => {
    const core = new TestInputCore({});

    expect(core.store.state).toEqual({ value: 'initial', count: 0 });

    core.exposeSetState({ value: 'updated' });

    expect(core.store.state).toEqual({ value: 'updated', count: 0 });
  });

  test('connect and disconnect are idempotent', () => {
    const coordinator = new FakeCoordinator();
    const core = new TestInputCore({ coordinator: coordinator as never });

    const cleanup = core.connect();
    core.connect();

    expect(coordinator.connectCount).toBe(1);
    expect(core.connectHooks).toBe(1);
    expect(core.isConnected).toBe(true);

    cleanup();
    core.disconnect();

    expect(coordinator.disconnectCount).toBe(1);
    expect(core.disconnectHooks).toBe(1);
    expect(core.isConnected).toBe(false);
  });

  test('swaps coordinators while preserving active connection state', () => {
    const firstCoordinator = new FakeCoordinator();
    const secondCoordinator = new FakeCoordinator();
    const core = new TestInputCore({
      coordinator: firstCoordinator as never,
    });

    core.connect();
    core.setCoordinator(secondCoordinator as never);

    expect(firstCoordinator.disconnectCount).toBe(1);
    expect(secondCoordinator.connectCount).toBe(1);
    expect(core.coordinator).toBe(secondCoordinator);
    expect(core.isConnected).toBe(true);
  });

  test('reconnects when filterBy identity changes', () => {
    const firstFilter = Selection.intersect();
    const secondFilter = Selection.intersect();
    const coordinator = new FakeCoordinator();
    const core = new TestInputCore({
      coordinator: coordinator as never,
      filterBy: firstFilter,
    });

    core.connect();
    core.updateOptions({
      coordinator: coordinator as never,
      filterBy: secondFilter,
    });

    expect(coordinator.disconnectCount).toBe(1);
    expect(coordinator.connectCount).toBe(2);
    expect(core.filterBy).toBe(secondFilter);
    expect(core.isConnected).toBe(true);
  });

  test('enabled false suppresses query execution', () => {
    const coordinator = new FakeCoordinator();
    const core = new TestInputCore({
      coordinator: coordinator as never,
      enabled: false,
    });

    core.connect();
    core.requestQuery();

    expect(coordinator.requests).toHaveLength(0);
  });

  test('distinguishes Selection from scalar Param output targets', () => {
    const scalarParam = Param.value('alpha');
    const selection = Selection.intersect();

    expect(isScalarParamTarget(scalarParam)).toBe(true);
    expect(isSelectionTarget(scalarParam)).toBe(false);
    expect(isSelectionTarget(selection)).toBe(true);
    expect(isScalarParamTarget(selection)).toBe(false);
  });

  test('cleans up scalar Param subscriptions', async () => {
    const param = Param.value('first');
    const values: Array<string | undefined> = [];
    const cleanup = subscribeScalarParamValue(param, (value) => {
      values.push(value);
    });

    param.update('second');
    await flushParam(param);

    cleanup();
    param.update('third');
    await flushParam(param);

    expect(values).toEqual(['second']);
  });

  test('cleans up Param-backed source subscriptions', async () => {
    const source = Param.value('athletes');
    const values: Array<string | undefined> = [];
    const cleanup = subscribeParamStringSource(source, (value) => {
      values.push(value);
    });

    source.update('teams');
    await flushParam(source);

    cleanup();
    source.update('events');
    await flushParam(source);

    expect(values).toEqual(['teams']);
  });

  test('destroy is idempotent and disposes runtime subscriptions', () => {
    const coordinator = new FakeCoordinator();
    const core = new TestInputCore({ coordinator: coordinator as never });

    core.addTestCleanup();
    core.connect();
    core.destroy();
    core.destroy();

    expect(coordinator.disconnectCount).toBe(1);
    expect(core.cleanupRuns).toBe(1);
    expect(core.isConnected).toBe(false);
  });
});
