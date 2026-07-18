/**
 * React bindings for #181's topology params: `useMosaicParamRef` (the
 * provider-resolving sugar mirroring `useMosaicSelectionRef`, but for owned /
 * external Params) and `useMosaicParamValue` (the instance-taking reactive read
 * mirroring `useMosaicSelectionValue`).
 *
 * These tests pin the React-visible contract only; param construction, reset,
 * and persistence are exercised in mosaic-core's topology-param.test.ts. Mosaic
 * `Param.update` dispatches async (a `value` listener makes back-to-back updates
 * queue), so mutations are wrapped act-safe and awaited via `param.pending`.
 */
import { createElement } from 'react';
import { Param } from '@uwdata/mosaic-core';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { interact, renderHook } from '@nozzleio/test-support/react';
import {
  MosaicTopologyProvider,
  createTopology,
  useMosaicParamRef,
  useMosaicParamValue,
} from '../src/index';
import type { PropsWithChildren } from 'react';
import type { Topology, TopologyConfig } from '../src/index';

/** Apply a param update act-safe and let its async `value` dispatch settle. */
async function setParam(param: Param<any>, value: unknown): Promise<void> {
  await interact(async () => {
    param.update(value);
    await param.pending('value');
  });
}

describe('useMosaicParamRef', () => {
  test('resolves a declared param through the provided topology', async () => {
    const config: TopologyConfig = {
      threshold: { type: 'param', default: 10 },
      mode: { type: 'param', default: 'all' },
    };
    const topology = createTopologyForTest(config);
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(MosaicTopologyProvider, { topology }, children);

    const hook = await renderHook(
      () => ({
        threshold: useMosaicParamRef('threshold'),
        mode: useMosaicParamRef('mode'),
      }),
      { initialProps: {}, wrapper },
    );

    expect(hook.result.current.threshold).toBe(
      topology.resolveParam('threshold'),
    );
    expect(hook.result.current.mode).toBe(topology.resolveParam('mode'));

    await hook.unmount();
    topology.destroy();
  });

  test('the typed form resolves without a cast and keeps runtime behavior', async () => {
    const config: TopologyConfig = {
      metric: { type: 'param', default: 'a' },
    };
    const topology = createTopologyForTest(config);
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(MosaicTopologyProvider, { topology }, children);

    const hook = await renderHook(
      () => {
        // Compile-time coverage: the generic flows to the Param and its value,
        // so no `as Param<...>` cast is needed at the call site.
        const param = useMosaicParamRef<'a' | 'b'>('metric');
        const value: 'a' | 'b' | undefined = useMosaicParamValue(param);
        return { param, value };
      },
      { initialProps: {}, wrapper },
    );

    // Runtime is identical to the untyped form: the same instance, same value.
    expect(hook.result.current.param).toBe(topology.resolveParam('metric'));
    expect(hook.result.current.value).toBe('a');

    await hook.unmount();
    topology.destroy();
  });

  test('throws a clear error outside a provider', async () => {
    let caught: unknown;
    try {
      await renderHook(() => useMosaicParamRef('threshold'), {
        initialProps: {},
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toMatch(/within a <MosaicTopologyProvider>/);
  });

  test('surfaces resolveParam errors for an undeclared ref', async () => {
    const topology = createTopologyForTest({
      threshold: { type: 'param', default: 1 },
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(MosaicTopologyProvider, { topology }, children);

    let caught: unknown;
    try {
      await renderHook(() => useMosaicParamRef('missing'), {
        initialProps: {},
        wrapper,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);

    topology.destroy();
  });
});

describe('useMosaicParamValue', () => {
  test('returns the initial value', async () => {
    const param = Param.value(7);
    const hook = await renderHook(() => useMosaicParamValue<number>(param), {
      initialProps: {},
    });

    expect(hook.result.current).toBe(7);

    await hook.unmount();
  });

  test('re-renders when the param value changes', async () => {
    const param = Param.value(1);
    const hook = await renderHook(() => useMosaicParamValue<number>(param), {
      initialProps: {},
    });

    expect(hook.result.current).toBe(1);

    await setParam(param, 42);
    expect(hook.result.current).toBe(42);

    await hook.unmount();
  });

  test('tracks a swapped param instance and its later updates', async () => {
    const first = Param.value('a');
    const second = Param.value('b');
    const hook = await renderHook(
      ({ param }: { param: Param<string> }) =>
        useMosaicParamValue<string>(param),
      { initialProps: { param: first } },
    );

    expect(hook.result.current).toBe('a');

    await hook.rerender({ param: second });
    expect(hook.result.current).toBe('b');

    // Updates now flow from the swapped instance...
    await setParam(second, 'b2');
    expect(hook.result.current).toBe('b2');

    // ...while the superseded instance no longer drives the render.
    await setParam(first, 'a2');
    expect(hook.result.current).toBe('b2');

    await hook.unmount();
  });

  test('unsubscribes on unmount (no post-unmount act warnings)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const param = Param.value(0);
    const hook = await renderHook(() => useMosaicParamValue<number>(param), {
      initialProps: {},
    });

    await hook.unmount();
    // A value change after unmount must not re-enter the unmounted component.
    await setParam(param, 99);

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('topology param + value hook compose end-to-end', () => {
  test('declare, resolve via context, read, update, observe', async () => {
    const config: TopologyConfig = {
      threshold: { type: 'param', default: 25, label: 'Threshold' },
    };
    const topology = createTopologyForTest(config);
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(MosaicTopologyProvider, { topology }, children);

    const hook = await renderHook(
      () => {
        const param = useMosaicParamRef('threshold');
        return useMosaicParamValue<number>(param);
      },
      { initialProps: {}, wrapper },
    );

    expect(hook.result.current).toBe(25);

    await setParam(topology.resolveParam('threshold'), 60);
    expect(hook.result.current).toBe(60);

    // A topology reset restores the declared default, observed through the hook.
    await interact(async () => {
      topology.reset();
      await topology.resolveParam('threshold').pending('value');
    });
    expect(hook.result.current).toBe(25);

    await hook.unmount();
    topology.destroy();
  });
});

/**
 * Build a topology directly (not via the hook) for provider tests that own
 * teardown themselves. Uses the same core factory the hook wraps.
 */
function createTopologyForTest(config: TopologyConfig): Topology {
  return createTopology(config);
}

afterEach(() => {
  vi.restoreAllMocks();
});
