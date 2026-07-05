/**
 * React bindings for the Selection topology helpers. These tests pin the
 * React-visible contract of the singular `useMosaicSelection` hook: it hands
 * back a real Selection, keeps a stable identity across renders (so it is safe
 * in `filterBy` / effect dependency arrays), and mints a fresh instance only
 * when the requested resolution `type` changes.
 */
import { Selection } from '@uwdata/mosaic-core';
import { describe, expect, test } from 'vitest';

import { renderHook } from '@nozzleio/test-support/react';
import { useMosaicSelection } from '../src/index';

describe('useMosaicSelection', () => {
  test('returns a Selection instance', async () => {
    const hook = await renderHook(() => useMosaicSelection(), {
      initialProps: {},
    });

    expect(hook.result.current).toBeInstanceOf(Selection);
  });

  test('keeps a stable identity across re-renders', async () => {
    const hook = await renderHook(() => useMosaicSelection(), {
      initialProps: {},
    });

    const first = hook.result.current;
    await hook.rerender({});
    await hook.rerender({});

    expect(hook.result.current).toBe(first);
  });

  test('mints a new instance when the type changes', async () => {
    const hook = await renderHook(
      ({ type }: { type: 'intersect' | 'single' }) => useMosaicSelection(type),
      { initialProps: { type: 'intersect' } },
    );

    const first = hook.result.current;
    expect(first.single).toBe(false);

    await hook.rerender({ type: 'single' });

    expect(hook.result.current).not.toBe(first);
    expect(hook.result.current.single).toBe(true);
  });

  test("defaults to the 'intersect' resolution type", async () => {
    const hook = await renderHook(() => useMosaicSelection(), {
      initialProps: {},
    });

    // `intersect` (and every non-single resolution) reports `single === false`.
    expect(hook.result.current.single).toBe(false);
  });
});
