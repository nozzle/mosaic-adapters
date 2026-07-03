/**
 * React bindings for the page-level FilterSet. The set is a long-lived
 * page-scope object created next to the page's Selections (module/test scope
 * here, never per-component); these hooks are only the store subscription. The
 * tests pin the React-visible contract: subscriptions re-render on set/remove/
 * reset, and — the load-bearing StrictMode invariant — mounting and
 * double-rendering a subscriber never writes to a persister-backed set.
 */
import { Selection } from '@uwdata/mosaic-core';
import { createFilterSet } from '@nozzleio/mosaic-core';
import { describe, expect, test, vi } from 'vitest';

import { useFilterSetChips, useFilterSetState } from '../src/index';
import { actWaitFor, renderHook } from './test-utils';
import type { FilterSet, FilterSpec, Persister } from '../src/index';

/** In-memory persister with a write spy, standing in for consumer storage. */
function memoryPersister(initial: Array<FilterSpec> | null = null): {
  persister: Persister<Array<FilterSpec>>;
  write: ReturnType<typeof vi.fn>;
  writes: Array<{ state: Array<FilterSpec> | null; reason: string }>;
} {
  const writes: Array<{ state: Array<FilterSpec> | null; reason: string }> = [];
  const read = vi.fn(() => initial);
  const write = vi.fn(
    (state: Array<FilterSpec> | null, context: { reason: string }) => {
      writes.push({ state, reason: context.reason });
    },
  );
  return { persister: { read, write }, write, writes };
}

describe('useFilterSetState / useFilterSetChips', () => {
  test('subscriptions react to set / removeChip / reset', async () => {
    const $where = Selection.intersect();
    // Page-scope object, created once next to the Selection topology.
    const set: FilterSet = createFilterSet({ targets: { where: $where } });

    const hook = await renderHook(
      () => ({
        state: useFilterSetState(set),
        chips: useFilterSetChips(set),
      }),
      { initialProps: {} },
    );

    expect(hook.result.current.state.specs).toEqual([]);
    expect(hook.result.current.chips).toEqual([]);

    // set(...) publishes a spec → specs and chips update.
    set.set({ id: 'sport', column: 'sport', kind: 'point', value: 'run' });
    await actWaitFor(() => {
      expect(hook.result.current.state.specs).toHaveLength(1);
      expect(hook.result.current.chips).toHaveLength(1);
    });
    expect(hook.result.current.chips[0]?.id).toBe('sport');

    // A multi-value `points` spec explodes into one chip per element.
    set.set({
      id: 'names',
      column: 'name',
      kind: 'points',
      value: ['Ada', 'Bo'],
    });
    await actWaitFor(() => {
      expect(hook.result.current.chips).toHaveLength(3);
    });
    const exploded = hook.result.current.chips.filter((c) => c.exploded);
    expect(exploded).toHaveLength(2);

    // removeChip on an exploded element narrows the spec value (spec survives).
    const first = exploded[0];
    if (!first) {
      throw new Error('expected an exploded chip');
    }
    set.removeChip(first);
    await actWaitFor(() => {
      expect(hook.result.current.chips).toHaveLength(2);
      expect(hook.result.current.state.specs).toHaveLength(2);
    });

    // reset empties everything.
    set.reset();
    await actWaitFor(() => {
      expect(hook.result.current.state.specs).toEqual([]);
      expect(hook.result.current.chips).toEqual([]);
    });

    await hook.unmount();
  });

  test('StrictMode: subscribing never writes to a persister-backed set; interactions still work', async () => {
    const $where = Selection.intersect();
    const { persister, write } = memoryPersister([
      { id: 'sport', column: 'sport', kind: 'point', value: 'run' },
    ]);
    // Persister-backed page-scope set, hydrated before createFilterSet returns.
    const set: FilterSet = createFilterSet({
      targets: { where: $where },
      persist: persister,
    });

    // Hydration alone must not write.
    expect(write).not.toHaveBeenCalled();

    const hook = await renderHook(
      () => ({
        state: useFilterSetState(set),
        chips: useFilterSetChips(set),
      }),
      { initialProps: {}, strict: true },
    );

    // The subscription observes the hydrated spec.
    await actWaitFor(() => {
      expect(hook.result.current.chips).toHaveLength(1);
    });
    // StrictMode mount + double-render: subscription alone never writes.
    expect(write).not.toHaveBeenCalled();

    // A real interaction still works and does write.
    set.set({ id: 'weight', column: 'weight', kind: 'point', value: 70 });
    await actWaitFor(() => {
      expect(hook.result.current.chips).toHaveLength(2);
    });
    expect(write).toHaveBeenCalled();

    await hook.unmount();
    // Destroy (StrictMode unmount included) never writes.
    const writesAfterInteraction = write.mock.calls.length;
    expect(write.mock.calls.length).toBe(writesAfterInteraction);
  });
});
