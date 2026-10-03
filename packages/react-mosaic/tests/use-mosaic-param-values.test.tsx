/**
 * `useMosaicParamValues` — the record form of `useMosaicParamValue`: one
 * subscription over several Params, returning a frozen snapshot whose identity
 * holds while every value is `Object.is`-equal. Mosaic `Param.update`
 * dispatches async, so mutations are wrapped act-safe and awaited via
 * `param.pending`.
 */
import { interact, renderHook } from '@nozzleio/test-support/react';
import { Param } from '@uwdata/mosaic-core';
import { createElement, useMemo } from 'react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, expectTypeOf, test, vi } from 'vitest';

import {
  MosaicTopologyProvider,
  createTopology,
  useMosaicParamValues,
  useMosaicTopology,
} from '../src/index';
import type { ParamValueOf, UseMosaicParamValuesResult } from '../src/index';

/** Apply a param update act-safe and let its async `value` dispatch settle. */
async function setParam(param: Param<any>, value: unknown): Promise<void> {
  await interact(async () => {
    param.update(value);
    await param.pending('value');
  });
}

describe('useMosaicParamValues', () => {
  test('returns every current value keyed like the input record', async () => {
    const params = {
      metric: Param.value<'gold' | 'silver'>('gold'),
      threshold: Param.value(10),
    };
    const hook = await renderHook(() => useMosaicParamValues(params), {
      initialProps: {},
    });

    expect(hook.result.current).toEqual({ metric: 'gold', threshold: 10 });
    expect(Object.isFrozen(hook.result.current)).toBe(true);

    await hook.unmount();
  });

  test('types each entry from its Param without a cast', async () => {
    const params = {
      metric: Param.value<'gold' | 'silver'>('gold'),
      threshold: Param.value<number>(10),
      nullable: Param.value<number | null>(null),
      loose: Param.value<any>('x'),
    };
    const hook = await renderHook(() => useMosaicParamValues(params), {
      initialProps: {},
    });

    // Compile-time coverage (tsc / test:types): exact assertions, so an
    // accidental widening to `any` or `unknown` fails to compile.
    expectTypeOf(hook.result.current.metric).toEqualTypeOf<'gold' | 'silver' | undefined>();
    expectTypeOf(hook.result.current.threshold).toEqualTypeOf<number | undefined>();
    expectTypeOf(hook.result.current.nullable).toEqualTypeOf<number | null | undefined>();
    expectTypeOf(hook.result.current.metric).not.toBeAny();
    expectTypeOf(hook.result.current.threshold).not.toBeAny();
    expectTypeOf(hook.result.current.loose).toBeAny();
    expectTypeOf<ParamValueOf<Param<number>>>().toEqualTypeOf<number>();
    expectTypeOf<ParamValueOf<Param<'a' | 'b'>>>().toEqualTypeOf<'a' | 'b'>();
    expectTypeOf<ParamValueOf<string>>().toBeNever();
    expectTypeOf<UseMosaicParamValuesResult<{ a: Param<string> }>>().toEqualTypeOf<{
      readonly a: string | undefined;
    }>();
    expectTypeOf(hook.result.current).toEqualTypeOf<UseMosaicParamValuesResult<typeof params>>();

    expect(hook.result.current.metric).toBe('gold');
    expect(hook.result.current.threshold).toBe(10);
    expect(hook.result.current.nullable).toBeNull();
    expect(hook.result.current.loose).toBe('x');

    await hook.unmount();
  });

  test('reads a never-set param as undefined', async () => {
    const params = { empty: new Param<string>(), set: Param.value('a') };
    const hook = await renderHook(() => useMosaicParamValues(params), {
      initialProps: {},
    });

    expect(hook.result.current.empty).toBeUndefined();
    expect(hook.result.current.set).toBe('a');

    await hook.unmount();
  });

  test('preserves an explicit null instead of normalizing it to undefined', async () => {
    const params = {
      nullable: Param.value<number | null>(null),
      unset: new Param<number | null>(),
    };
    const hook = await renderHook(() => useMosaicParamValues(params), {
      initialProps: {},
    });

    expect(hook.result.current.nullable).toBeNull();
    expect(hook.result.current.unset).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(hook.result.current, 'unset')).toBe(true);

    await hook.unmount();
  });

  test('re-renders on transitions between null and undefined', async () => {
    const param = new Param<number | null | undefined>();
    const params = { v: param };
    const hook = await renderHook(() => useMosaicParamValues(params), {
      initialProps: {},
    });
    const seen: Array<unknown> = [hook.result.current.v];
    let previous = hook.result.current;

    for (const next of [null, undefined, null, 1, null] as const) {
      await setParam(param, next);
      expect(hook.result.current.v).toBe(next);
      expect(hook.result.current).not.toBe(previous);
      previous = hook.result.current;
      seen.push(hook.result.current.v);
    }

    expect(seen).toEqual([undefined, null, undefined, null, 1, null]);

    await hook.unmount();
  });

  test('keeps a __proto__ key as an own entry with a stable snapshot', async () => {
    const protoParam = Param.value(1);
    // A computed key defines an own `__proto__` property (a literal
    // `__proto__: x` would set the prototype instead).
    const params: Record<string, Param<number>> = { ['__proto__']: protoParam };
    expect(Object.keys(params)).toEqual(['__proto__']);
    let renders = 0;
    const hook = await renderHook(
      (_props: { tick: number }) => {
        renders += 1;
        return useMosaicParamValues(params);
      },
      { initialProps: { tick: 0 } },
    );
    const first = hook.result.current;

    expect(Object.keys(first)).toEqual(['__proto__']);
    expect(Object.prototype.hasOwnProperty.call(first, '__proto__')).toBe(true);
    expect(first['__proto__']).toBe(1);
    expect(Object.getPrototypeOf(first)).toBe(Object.prototype);

    // Stable identity: an unrelated re-render renders once and reuses it.
    const rendersBefore = renders;
    await hook.rerender({ tick: 1 });
    expect(renders).toBe(rendersBefore + 1);
    expect(hook.result.current).toBe(first);

    await setParam(protoParam, 2);
    expect(hook.result.current).not.toBe(first);
    expect(hook.result.current['__proto__']).toBe(2);
    expect(Object.prototype.hasOwnProperty.call(hook.result.current, '__proto__')).toBe(true);

    await hook.unmount();
  });

  test('re-renders with a new snapshot when any listed param changes', async () => {
    const params = { a: Param.value(1), b: Param.value(2) };
    const hook = await renderHook(() => useMosaicParamValues(params), {
      initialProps: {},
    });
    const first = hook.result.current;

    await setParam(params.b, 20);

    expect(hook.result.current).toEqual({ a: 1, b: 20 });
    expect(hook.result.current).not.toBe(first);

    await hook.unmount();
  });

  test('keeps snapshot identity across renders and Object.is-equal updates', async () => {
    const params = { a: Param.value(1), b: Param.value('x') };
    let renders = 0;
    const hook = await renderHook(
      (_props: { tick: number }) => {
        renders += 1;
        return useMosaicParamValues(params);
      },
      { initialProps: { tick: 0 } },
    );
    const first = hook.result.current;

    // An unrelated re-render reuses the snapshot.
    await hook.rerender({ tick: 1 });
    expect(hook.result.current).toBe(first);

    // A forced emit of an equal value notifies the listener, but the re-read
    // is Object.is-equal, so the snapshot (and the render) is skipped.
    const notify = vi.fn();
    params.a.addEventListener('value', notify);
    const rendersBefore = renders;
    await interact(async () => {
      params.a.update(1, { force: true });
      await params.a.pending('value');
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(hook.result.current).toBe(first);
    expect(renders).toBe(rendersBefore);

    await hook.unmount();
  });

  test('subscribes once per param and does not re-subscribe on re-render', async () => {
    const shared = Param.value(1);
    const other = Param.value(2);
    const sharedAdd = vi.spyOn(shared, 'addEventListener');
    const otherAdd = vi.spyOn(other, 'addEventListener');
    // The same Param under two keys is subscribed once.
    const params = { a: shared, alias: shared, b: other };

    const hook = await renderHook((_props: { tick: number }) => useMosaicParamValues(params), {
      initialProps: { tick: 0 },
    });
    await hook.rerender({ tick: 1 });
    await hook.rerender({ tick: 2 });

    expect(sharedAdd).toHaveBeenCalledTimes(1);
    expect(otherAdd).toHaveBeenCalledTimes(1);
    expect(hook.result.current).toEqual({ a: 1, alias: 1, b: 2 });

    await setParam(shared, 5);
    expect(hook.result.current).toEqual({ a: 5, alias: 5, b: 2 });

    await hook.unmount();
  });

  test('re-subscribes and re-reads when a different params record is passed', async () => {
    const first = { v: Param.value('a') };
    const second = { v: Param.value('b'), extra: Param.value(3) };
    const hook = await renderHook(
      ({ params }: { params: Record<string, Param<any>> }) => useMosaicParamValues(params),
      { initialProps: { params: first as Record<string, Param<any>> } },
    );
    expect(hook.result.current).toEqual({ v: 'a' });

    await hook.rerender({ params: second });
    expect(hook.result.current).toEqual({ v: 'b', extra: 3 });

    // Updates now flow from the new record...
    await setParam(second.extra, 4);
    expect(hook.result.current).toEqual({ v: 'b', extra: 4 });

    // ...while the superseded record no longer drives the render.
    const before = hook.result.current;
    await setParam(first.v, 'a2');
    expect(hook.result.current).toBe(before);

    await hook.unmount();
  });

  test('a new record with identical keys and values keeps the snapshot', async () => {
    const a = Param.value(1);
    const hook = await renderHook(
      ({ params }: { params: Record<string, Param<any>> }) => useMosaicParamValues(params),
      { initialProps: { params: { a } as Record<string, Param<any>> } },
    );
    const first = hook.result.current;

    await hook.rerender({ params: { a } });
    expect(hook.result.current).toBe(first);

    // A key-set change produces a new snapshot even with equal shared values.
    await hook.rerender({ params: { a, b: a } });
    expect(hook.result.current).not.toBe(first);
    expect(hook.result.current).toEqual({ a: 1, b: 1 });

    await hook.unmount();
  });

  test('reads a non-Param entry as undefined without throwing', async () => {
    // Untyped callers (e.g. a spec lookup that missed) can hand in a hole.
    const params = { a: Param.value(1), missing: undefined } as unknown as Record<
      string,
      Param<any>
    >;
    const hook = await renderHook(() => useMosaicParamValues(params), {
      initialProps: {},
    });

    expect(hook.result.current).toEqual({ a: 1, missing: undefined });

    await hook.unmount();
  });

  test('an empty record returns a stable empty snapshot', async () => {
    const params = {};
    const hook = await renderHook((_props: { tick: number }) => useMosaicParamValues(params), {
      initialProps: { tick: 0 },
    });
    const first = hook.result.current;
    await hook.rerender({ tick: 1 });

    expect(hook.result.current).toEqual({});
    expect(hook.result.current).toBe(first);

    await hook.unmount();
  });

  test('unsubscribes every param on unmount', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const params = { a: Param.value(0), b: Param.value(0) };
    const removeA = vi.spyOn(params.a, 'removeEventListener');
    const removeB = vi.spyOn(params.b, 'removeEventListener');
    const hook = await renderHook(() => useMosaicParamValues(params), {
      initialProps: {},
    });

    await hook.unmount();
    expect(removeA).toHaveBeenCalledTimes(1);
    expect(removeB).toHaveBeenCalledTimes(1);

    // A value change after unmount must not re-enter the unmounted component.
    await setParam(params.a, 99);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('reads topology.params (memoized by the topology) end-to-end', async () => {
    const topology = createTopology({
      metric: { type: 'param', default: 'gold' },
      threshold: { type: 'param', default: 25 },
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(MosaicTopologyProvider, { topology }, children);

    const hook = await renderHook(
      () => {
        const { params } = useMosaicTopology();
        const picked = useMemo(
          () => ({ metric: params.metric!, threshold: params.threshold! }),
          [params],
        );
        return useMosaicParamValues(picked);
      },
      { initialProps: {}, wrapper },
    );
    expect(hook.result.current).toEqual({ metric: 'gold', threshold: 25 });

    await setParam(topology.resolveParam('threshold'), 60);
    expect(hook.result.current).toEqual({ metric: 'gold', threshold: 60 });

    // A topology reset restores both declared defaults.
    await interact(async () => {
      topology.reset();
      await topology.resolveParam('threshold').pending('value');
    });
    expect(hook.result.current).toEqual({ metric: 'gold', threshold: 25 });

    await hook.unmount();
    topology.destroy();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
