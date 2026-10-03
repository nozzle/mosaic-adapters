/**
 * Subscription stability for the singular read-back hooks. Both pass a
 * `subscribe` to `useSyncExternalStore`; it is keyed on the instance, so a plain
 * re-render must not tear down and re-add the `value` listener — only swapping
 * the instance does.
 */
import { interact, renderHook } from '@nozzleio/test-support/react';
import { Param, Selection } from '@uwdata/mosaic-core';
import { eq, literal } from '@uwdata/mosaic-sql';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { useMosaicParamValue, useMosaicSelectionValue } from '../src/index';
import type { UseMosaicSelectionValueOptions } from '../src/index';

describe('useMosaicParamValue subscription', () => {
  test('does not re-subscribe on re-render with the same param', async () => {
    const param = Param.value(1);
    const add = vi.spyOn(param, 'addEventListener');
    const remove = vi.spyOn(param, 'removeEventListener');

    const hook = await renderHook(
      (_props: { tick: number }) => useMosaicParamValue<number>(param),
      {
        initialProps: { tick: 0 },
      },
    );
    await hook.rerender({ tick: 1 });
    await hook.rerender({ tick: 2 });

    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();

    await hook.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  test('re-subscribes exactly once when the param instance changes', async () => {
    const first = Param.value('a');
    const second = Param.value('b');
    const removeFirst = vi.spyOn(first, 'removeEventListener');
    const addSecond = vi.spyOn(second, 'addEventListener');

    const hook = await renderHook(
      ({ param }: { param: Param<string> }) => useMosaicParamValue<string>(param),
      { initialProps: { param: first } },
    );
    await hook.rerender({ param: second });
    await hook.rerender({ param: second });

    expect(removeFirst).toHaveBeenCalledTimes(1);
    expect(addSecond).toHaveBeenCalledTimes(1);
    expect(hook.result.current).toBe('b');

    await hook.unmount();
  });
});

describe('useMosaicSelectionValue subscription', () => {
  test('does not re-subscribe on re-render, including a new options object', async () => {
    const selection = Selection.single();
    const add = vi.spyOn(selection, 'addEventListener');
    const remove = vi.spyOn(selection, 'removeEventListener');
    const source = {};

    const hook = await renderHook(
      ({ options }: { options: UseMosaicSelectionValueOptions }) =>
        useMosaicSelectionValue<string>(selection, options),
      { initialProps: { options: { source } } },
    );
    // A fresh options literal per render is the common call shape.
    await hook.rerender({ options: { source } });
    await hook.rerender({ options: { source } });

    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();

    // The read still tracks updates through the single subscription.
    await interact(async () => {
      selection.update({ source, value: 'swim', predicate: eq('sport', literal('x')), fields: [] });
      await selection.pending('value');
    });
    expect(hook.result.current).toBe('swim');

    await hook.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  test('applies a changed source at read time without re-subscribing', async () => {
    const selection = Selection.intersect();
    const a = {};
    const b = {};
    selection.update({
      source: a,
      value: 'from-a',
      predicate: eq('sport', literal('x')),
      fields: [],
    });
    selection.update({
      source: b,
      value: 'from-b',
      predicate: eq('sport', literal('x')),
      fields: [],
    });
    const add = vi.spyOn(selection, 'addEventListener');

    const hook = await renderHook(
      ({ source }: { source: object }) => useMosaicSelectionValue<string>(selection, { source }),
      { initialProps: { source: a } },
    );
    expect(hook.result.current).toBe('from-a');

    await hook.rerender({ source: b });
    expect(hook.result.current).toBe('from-b');
    expect(add).toHaveBeenCalledTimes(1);

    await hook.unmount();
  });

  test('re-subscribes when the selection instance changes', async () => {
    const first = Selection.single();
    const second = Selection.single();
    const removeFirst = vi.spyOn(first, 'removeEventListener');
    const addSecond = vi.spyOn(second, 'addEventListener');

    const hook = await renderHook(
      ({ selection }: { selection: Selection }) => useMosaicSelectionValue<string>(selection),
      { initialProps: { selection: first } },
    );
    await hook.rerender({ selection: second });

    expect(removeFirst).toHaveBeenCalledTimes(1);
    expect(addSecond).toHaveBeenCalledTimes(1);

    await hook.unmount();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
