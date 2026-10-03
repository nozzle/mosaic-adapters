import {
  createAthletesDb,
  interact,
  renderHook,
  settle,
  waitFor,
} from '@nozzleio/test-support/react';
import type { TestDb } from '@nozzleio/test-support/react';
/**
 * The `null` provider as an explicit boundary (#261). Pins the coordinator
 * resolution order — explicit option → nearest `MosaicProvider` → upstream
 * global coordinator only when there is NO provider — plus the new boundary
 * rule: `<MosaicProvider coordinator={null}>` stops the lookup and throws a
 * clear `[react-mosaic]` error instead of silently resolving a parent's (or the
 * global) coordinator. `MosaicTopologyProvider` gets the matching type-only
 * widening, and the by-argument subscription hooks accept an absent source.
 */
import { Selection, clausePoint, coordinator as globalCoordinator } from '@uwdata/mosaic-core';
import type { Coordinator } from '@uwdata/mosaic-core';
import { Query, count } from '@uwdata/mosaic-sql';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  MosaicProvider,
  MosaicTopologyProvider,
  createFilterSet,
  createTopology,
  useFilterSetChips,
  useFilterSetState,
  useMosaicActiveClauses,
  useMosaicCoordinator,
  useMosaicTopology,
  useMosaicValues,
  useTopologyActiveClauses,
} from '../src/index';
import type { FilterSet, Topology } from '../src/index';

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Wrap children in a `MosaicProvider` holding `value`. */
function providerWrapper(value: Coordinator | null) {
  return ({ children }: { children: ReactNode }) =>
    createElement(MosaicProvider, { coordinator: value }, children);
}

/**
 * Render `useHook` and return the error it threw during render (if any). React
 * also reports render errors through `console.error`; that expected noise is
 * silenced for the duration of the render.
 */
async function renderError(
  useHook: () => unknown,
  wrapper?: (props: { children: ReactNode }) => ReactNode,
): Promise<unknown> {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let caught: unknown;
  try {
    await renderHook(useHook, { initialProps: {}, wrapper });
  } catch (error) {
    caught = error;
  }
  return caught;
}

describe('useMosaicCoordinator resolution', () => {
  test('no provider at all keeps the upstream global fallback', async () => {
    const hook = await renderHook(() => useMosaicCoordinator(), { initialProps: {} });
    expect(hook.result.current).toBe(globalCoordinator());
    await hook.unmount();
  });

  test('a provider holding a coordinator resolves it', async () => {
    const hook = await renderHook(() => useMosaicCoordinator(), {
      initialProps: {},
      wrapper: providerWrapper(db.coordinator),
    });
    expect(hook.result.current).toBe(db.coordinator);
    await hook.unmount();
  });

  test('coordinator={null} is an explicit boundary that throws a clear error', async () => {
    const caught = await renderError(() => useMosaicCoordinator(), providerWrapper(null));
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toMatch(/\[react-mosaic\]/);
    expect(String(caught)).toMatch(/coordinator=\{null\}/);
    expect(String(caught)).toMatch(/enabled: false/);
  });

  test('the boundary does not fall through to an outer provider', async () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        MosaicProvider,
        { coordinator: db.coordinator },
        createElement(MosaicProvider, { coordinator: null }, children),
      );
    const caught = await renderError(() => useMosaicCoordinator(), wrapper);
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toMatch(/coordinator=\{null\}/);
  });

  test('a nested provider holding a coordinator re-opens resolution below a boundary', async () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        MosaicProvider,
        { coordinator: null },
        createElement(MosaicProvider, { coordinator: db.coordinator }, children),
      );
    const hook = await renderHook(() => useMosaicCoordinator(), { initialProps: {}, wrapper });
    expect(hook.result.current).toBe(db.coordinator);
    await hook.unmount();
  });

  test('an explicit coordinator wins over the boundary', async () => {
    const hook = await renderHook(() => useMosaicCoordinator(db.coordinator), {
      initialProps: {},
      wrapper: providerWrapper(null),
    });
    expect(hook.result.current).toBe(db.coordinator);
    await hook.unmount();
  });
});

describe('data hooks below a null boundary', () => {
  const query = () => Query.from('athletes').select({ athletes: count() });

  test('throw even with enabled: false, since the client is created on render', async () => {
    const globalClients = globalCoordinator().clients.size;
    const caught = await renderError(
      () => useMosaicValues<{ athletes: number }>({ query, enabled: false }),
      providerWrapper(null),
    );
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toMatch(/coordinator=\{null\}/);
    // Nothing leaked onto the global coordinator either.
    expect(globalCoordinator().clients.size).toBe(globalClients);
  });

  test('connect to an explicit coordinator option', async () => {
    const hook = await renderHook(
      () => useMosaicValues<{ athletes: number }>({ query, coordinator: db.coordinator }),
      { initialProps: {}, wrapper: providerWrapper(null) },
    );
    await waitFor(() => {
      expect(hook.result.current.status).toBe('success');
      expect(hook.result.current.values).toEqual({ athletes: 6 });
    });
    expect(db.coordinator.clients.size).toBe(1);
    await hook.unmount();
    expect(db.coordinator.clients.size).toBe(0);
  });
});

describe('MosaicTopologyProvider topology={null}', () => {
  test('shadows an outer provider so topology hooks throw', async () => {
    const topology = createTopology({ a: { type: 'crossfilter' } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        MosaicTopologyProvider,
        { topology },
        createElement(MosaicTopologyProvider, { topology: null }, children),
      );

    const caught = await renderError(() => useMosaicTopology(), wrapper);
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toMatch(/within a <MosaicTopologyProvider>/);

    const caughtClauses = await renderError(() => useMosaicActiveClauses(), wrapper);
    expect(caughtClauses).toBeInstanceOf(Error);

    topology.destroy();
  });
});

interface TopologyProps {
  topology: Topology | null | undefined;
}

interface FilterSetProps {
  set: FilterSet | null | undefined;
}

describe('subscription hooks with an absent source', () => {
  test('useTopologyActiveClauses(undefined | null) returns a stable empty array', async () => {
    const initialProps: TopologyProps = { topology: undefined };
    const hook = await renderHook(
      (props: TopologyProps) => useTopologyActiveClauses(props.topology),
      { initialProps },
    );
    const first = hook.result.current;
    expect(first).toEqual([]);
    expect(Object.isFrozen(first)).toBe(true);

    await hook.rerender({ topology: null });
    expect(hook.result.current).toBe(first);

    // Switching to a real topology subscribes to its store.
    const topology = createTopology({ a: { type: 'crossfilter' } });
    await hook.rerender({ topology });
    expect(hook.result.current).toEqual([]);
    await interact(() => {
      topology.resolve('a').update(clausePoint('sport', 'swim', { source: {} }));
    });
    await settle();
    expect(hook.result.current).toHaveLength(1);

    // Back to absent: the empty constant again.
    await hook.rerender({ topology: undefined });
    expect(hook.result.current).toBe(first);

    await hook.unmount();
    topology.destroy();
  });

  test('useFilterSetState / useFilterSetChips(undefined | null) return the empty state', async () => {
    const initialProps: FilterSetProps = { set: undefined };
    const hook = await renderHook(
      (props: FilterSetProps) => ({
        state: useFilterSetState(props.set),
        chips: useFilterSetChips(props.set),
      }),
      { initialProps },
    );
    const firstState = hook.result.current.state;
    const firstChips = hook.result.current.chips;
    expect(firstState).toEqual({ specs: [], chips: [] });
    expect(firstChips).toEqual([]);
    expect(Object.isFrozen(firstState)).toBe(true);
    expect(firstChips).toBe(firstState.chips);

    await hook.rerender({ set: null });
    expect(hook.result.current.state).toBe(firstState);
    expect(hook.result.current.chips).toBe(firstChips);

    // Switching to a real set subscribes to its store.
    const set = createFilterSet({ targets: { where: Selection.intersect() } });
    const initialState = set.store.state;
    await hook.rerender({ set });
    expect(hook.result.current.state).toBe(initialState);
    await interact(() => {
      set.set({ id: 'sport', column: 'sport', kind: 'point', value: 'swim' });
    });
    await waitFor(() => {
      expect(hook.result.current.state.specs).toHaveLength(1);
    });
    expect(hook.result.current.chips).toHaveLength(1);

    // Back to absent: both empty constants again.
    await hook.rerender({ set: undefined });
    expect(hook.result.current.state).toBe(firstState);
    expect(hook.result.current.chips).toBe(firstChips);

    await hook.unmount();
  });
});
