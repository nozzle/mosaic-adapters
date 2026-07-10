/**
 * React bindings for #181's topology primitive: `useTopology` (owns a
 * `createTopology` instance — lazy construction, unmount teardown, StrictMode
 * single-wiring), the deliberately dumb `MosaicTopologyProvider` /
 * `useMosaicTopology` / `useMosaicSelectionRef` provider trio, and the thin
 * `useTopologyActiveClauses` / `useMosaicActiveClauses` store subscription.
 *
 * These tests pin the React-visible contract only; the resolution graph, reset
 * type-awareness, and FilterSet-vs-foreign dedup are exercised in mosaic-core's
 * topology.test.ts. Foreign clauses are plain point clauses published directly
 * onto Selections — no coordinator required. Selection `value` events settle on
 * a microtask, so assertions on the active-clause store follow `settle()`.
 */
import { createElement } from 'react';
import { clausePoint } from '@uwdata/mosaic-core';
import { describe, expect, test } from 'vitest';

import { interact, renderHook, settle } from '@nozzleio/test-support/react';
import {
  MosaicTopologyProvider,
  createTopology,
  useMosaicActiveClauses,
  useMosaicSelectionRef,
  useMosaicTopology,
  useTopology,
  useTopologyActiveClauses,
} from '../src/index';
import type { PropsWithChildren } from 'react';
import type { Selection } from '@uwdata/mosaic-core';
import type { Topology, TopologyConfig } from '../src/index';

/** Publish a point clause from an independent (foreign) source; returns it. */
function publishForeign(
  selection: Selection,
  column: string,
  value: string,
  source: object = { column, value },
): object {
  selection.update(clausePoint(column, value, { source }));
  return source;
}

describe('useTopology', () => {
  test('constructs a live topology and keeps it stable across re-renders', async () => {
    const config: TopologyConfig = {
      a: { type: 'crossfilter' },
      b: { type: 'crossfilter' },
    };
    const hook = await renderHook(() => useTopology(config), {
      initialProps: {},
    });

    const first = hook.result.current;
    expect(first.validNames).toEqual(new Set(['a', 'b']));
    expect(first.destroyed).toBe(false);

    await hook.rerender({});
    await hook.rerender({});
    // Same config identity → same instance.
    expect(hook.result.current).toBe(first);

    await hook.unmount();
  });

  test('runs application initialization before returning each new topology', async () => {
    const configA: TopologyConfig = { a: { type: 'single' } };
    const configB: TopologyConfig = { b: { type: 'single' } };
    const initialized: Array<Topology> = [];
    const source = {};
    const hook = await renderHook(
      ({ config }: { config: TopologyConfig }) =>
        useTopology(config, {
          initialize: (topology) => {
            const ref = topology.validNames.has('a') ? 'a' : 'b';
            publishForeign(topology.resolve(ref), 'value', ref, source);
            initialized.push(topology);
          },
        }),
      { initialProps: { config: configA } },
    );

    expect(initialized).toEqual([hook.result.current]);
    expect(
      hook.result.current.activeClauses.state.clauses[0]?.clause.value,
    ).toBe('a');

    await hook.rerender({ config: configA });
    expect(initialized).toHaveLength(1);

    await hook.rerender({ config: configB });
    expect(initialized).toHaveLength(2);
    expect(initialized[1]).toBe(hook.result.current);
    expect(
      hook.result.current.activeClauses.state.clauses[0]?.clause.value,
    ).toBe('b');

    await hook.unmount();
  });

  test('a fresh options bag each render does not recreate when its fields are stable', async () => {
    const config: TopologyConfig = { a: { type: 'crossfilter' } };
    // Stable field identities; the bag wrapper and initializer are rebuilt every
    // render. Only config/selections/filterSets identities key recreation.
    const selections = {};
    const filterSets = {};
    const hook = await renderHook(
      () =>
        useTopology(config, {
          selections,
          filterSets,
          initialize: () => {},
        }),
      { initialProps: {} },
    );

    const first = hook.result.current;
    await hook.rerender({});
    await hook.rerender({});
    // New bag identity + new initializer identity per render, but stable field
    // identities → same live instance.
    expect(hook.result.current).toBe(first);
    expect(first.destroyed).toBe(false);

    await hook.unmount();
  });

  test('destroys a new topology when application initialization throws', async () => {
    const config: TopologyConfig = { a: { type: 'single' } };
    let initialized: Topology | null = null;
    let caught: unknown;

    try {
      await renderHook(
        () =>
          useTopology(config, {
            initialize: (topology) => {
              initialized = topology;
              throw new Error('bootstrap failed');
            },
          }),
        { initialProps: {} },
      );
    } catch (error) {
      caught = error;
    }

    expect(String(caught)).toContain('bootstrap failed');
    expect(initialized).not.toBeNull();
    expect((initialized as Topology | null)?.destroyed).toBe(true);
  });

  test('destroys the topology on unmount', async () => {
    const config: TopologyConfig = { a: { type: 'crossfilter' } };
    const hook = await renderHook(() => useTopology(config), {
      initialProps: {},
    });
    const topology = hook.result.current;
    expect(topology.destroyed).toBe(false);

    await hook.unmount();
    expect(topology.destroyed).toBe(true);
  });

  test('recreates when the config identity changes', async () => {
    const configA: TopologyConfig = { a: { type: 'crossfilter' } };
    const configB: TopologyConfig = { b: { type: 'crossfilter' } };
    const hook = await renderHook(
      ({ config }: { config: TopologyConfig }) => useTopology(config),
      { initialProps: { config: configA } },
    );

    const first = hook.result.current;
    expect(first.validNames).toEqual(new Set(['a']));

    await hook.rerender({ config: configB });
    const second = hook.result.current;
    expect(second).not.toBe(first);
    expect(second.validNames).toEqual(new Set(['b']));
    // The superseded topology was torn down.
    expect(first.destroyed).toBe(true);

    await hook.unmount();
  });

  test('StrictMode double-mount settles on a single live topology', async () => {
    const config: TopologyConfig = { a: { type: 'crossfilter' } };
    const hook = await renderHook(() => useTopology(config), {
      initialProps: {},
      reactStrictMode: true,
    });

    const topology = hook.result.current;
    expect(topology.destroyed).toBe(false);

    // A single foreign publish is observed exactly once — no double-wiring.
    await interact(() => {
      publishForeign(topology.resolve('a'), 'sport', 'swim');
    });
    await settle();
    expect(topology.activeClauses.state.clauses).toHaveLength(1);

    await hook.unmount();
  });
});

describe('MosaicTopologyProvider / useMosaicTopology / useMosaicSelectionRef', () => {
  test('provides the topology instance and resolves refs through it', async () => {
    const config: TopologyConfig = {
      a: { type: 'crossfilter' },
      filters: { type: 'filter-set', targets: { where: 'crossfilter' } },
    };
    const topology = createTopologyForTest(config);
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(MosaicTopologyProvider, { topology }, children);

    const hook = await renderHook(
      () => ({
        provided: useMosaicTopology(),
        a: useMosaicSelectionRef('a'),
        where: useMosaicSelectionRef('filters.where'),
      }),
      { initialProps: {}, wrapper },
    );

    expect(hook.result.current.provided).toBe(topology);
    expect(hook.result.current.a).toBe(topology.resolve('a'));
    expect(hook.result.current.where).toBe(topology.resolve('filters.where'));

    await hook.unmount();
    topology.destroy();
  });

  test('useMosaicTopology throws a clear error outside a provider', async () => {
    let caught: unknown;
    try {
      await renderHook(() => useMosaicTopology(), { initialProps: {} });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toMatch(/within a <MosaicTopologyProvider>/);
  });
});

describe('useTopologyActiveClauses / useMosaicActiveClauses', () => {
  test('reflects a foreign publish and its clear (by-argument variant)', async () => {
    const config: TopologyConfig = {
      a: { type: 'crossfilter', label: 'Region', meta: { group: 'geo' } },
    };
    const topology = createTopologyForTest(config);
    const hook = await renderHook(() => useTopologyActiveClauses(topology), {
      initialProps: {},
    });

    expect(hook.result.current).toEqual([]);

    let source: object = {};
    await interact(() => {
      source = publishForeign(topology.resolve('a'), 'sport', 'swim');
    });
    await settle();
    expect(hook.result.current).toHaveLength(1);
    expect(hook.result.current[0]).toMatchObject({
      entry: 'a',
      ref: 'a',
      label: 'Region',
      meta: { group: 'geo' },
    });

    // Clearing the clause (a null-predicate publish for the same source
    // reference) empties the subscription.
    await interact(() => {
      topology.resolve('a').update({ source, value: null, predicate: null });
    });
    await settle();
    expect(hook.result.current).toEqual([]);

    await hook.unmount();
    topology.destroy();
  });

  test('provider-consuming variant reflects publishes', async () => {
    const config: TopologyConfig = { a: { type: 'crossfilter' } };
    const topology = createTopologyForTest(config);
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(MosaicTopologyProvider, { topology }, children);

    const hook = await renderHook(() => useMosaicActiveClauses(), {
      initialProps: {},
      wrapper,
    });

    expect(hook.result.current).toEqual([]);
    await interact(() => {
      publishForeign(topology.resolve('a'), 'name', 'Ada');
    });
    await settle();
    expect(hook.result.current).toHaveLength(1);
    expect(hook.result.current[0]?.entry).toBe('a');

    await hook.unmount();
    topology.destroy();
  });

  test('dedup holds through the React layer: a FilterSet-published clause is not foreign', async () => {
    const config: TopologyConfig = {
      filters: { type: 'filter-set', targets: { where: 'crossfilter' } },
    };
    const topology = createTopologyForTest(config);
    const filterSet = topology.getFilterSet('filters');
    if (filterSet === undefined) {
      throw new Error('expected a filter-set for entry "filters"');
    }

    const hook = await renderHook(() => useTopologyActiveClauses(topology), {
      initialProps: {},
    });

    // A spec-derived clause on the shared target must NOT appear as foreign.
    await interact(() =>
      filterSet.set({ id: 'p', column: 'sport', kind: 'point', value: 'swim' }),
    );
    await settle();
    expect(hook.result.current).toEqual([]);

    // A genuinely foreign clause on the same target IS reported.
    await interact(() => {
      publishForeign(topology.resolve('filters.where'), 'name', 'Ada');
    });
    await settle();
    expect(hook.result.current).toHaveLength(1);
    expect(hook.result.current[0]).toMatchObject({
      entry: 'filters',
      ref: 'filters.where',
    });

    await hook.unmount();
    topology.destroy();
  });
});

/**
 * Build a topology directly (not via the hook) for provider/subscription tests
 * that own teardown themselves. Uses the same core factory the hook wraps.
 */
function createTopologyForTest(config: TopologyConfig): Topology {
  return createTopology(config);
}
