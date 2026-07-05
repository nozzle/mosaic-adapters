import { useState } from 'react';
import { Selection } from '@uwdata/mosaic-core';
import { Query } from '@uwdata/mosaic-sql';
import { beforeEach, describe, expect, test } from 'vitest';
import { createFilterSet, useMosaicRows } from '@nozzleio/react-mosaic';

import {
  createAthletesDb,
  interact,
  renderHook,
  settle,
  waitFor,
} from '@nozzleio/test-support/react';
import { useTanStackFilterBridge } from '../src/index';
import type { FilterSet } from '@nozzleio/react-mosaic';
import type { ColumnFiltersState } from '@tanstack/table-core';
import type { FilterBridgeColumns } from '../src/index';
import type { TestDb } from '@nozzleio/test-support/react';

interface AthleteRow {
  id: number;
  name: string;
  sport: string;
  weight: number;
}

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

const bridgeColumns: FilterBridgeColumns = {
  sport: { clause: 'equals' },
  name: { clause: 'ilike' },
  weight: { clause: 'range' },
};

describe('full loop with a consuming rows client', () => {
  test('publishes on mount, filters the table, suppresses echoes, clears on unmount', async () => {
    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });

    // The north-star wiring: the bridge and the table's rows client share one
    // component and one Selection, so every store update re-renders and
    // re-runs the bridge effects — the exact publish/echo loop shape.
    const hook = await renderHook(
      (props: { filters: ColumnFiltersState }) => {
        useTanStackFilterBridge({
          filters: props.filters,
          set,
          columns: bridgeColumns,
        });
        return useMosaicRows<AthleteRow>({
          coordinator: db.coordinator,
          query: ({ where }) =>
            Query.from('athletes')
              .select('id', 'name', 'sport', 'weight')
              .where(where),
          filterBy: $page,
        });
      },
      { initialProps: { filters: [{ id: 'sport', value: 'swim' }] } },
    );

    await waitFor(() => {
      expect(hook.result.current.rows).toHaveLength(4);
    });
    expect($page.clauses).toHaveLength(1);
    const queriesAfterPublish = db.clientQueries.length;

    // Equal filter content under fresh identities, several times over: no
    // clause churn, no re-query — the feedback loop has nowhere to start.
    await hook.rerender({ filters: [{ id: 'sport', value: 'swim' }] });
    await hook.rerender({ filters: [{ id: 'sport', value: 'swim' }] });
    await settle();
    expect(db.clientQueries.length).toBe(queriesAfterPublish);
    expect($page.clauses).toHaveLength(1);

    // A changed value replaces the clause (same source) and re-filters.
    const source = $page.clauses[0]?.source;
    await hook.rerender({ filters: [{ id: 'sport', value: 'run' }] });
    await waitFor(() => {
      expect(hook.result.current.rows).toHaveLength(2);
    });
    expect($page.clauses).toHaveLength(1);
    expect($page.clauses[0]?.source).toBe(source);

    // Clearing the column filter removes its clause and unfilters.
    await hook.rerender({ filters: [] });
    await waitFor(() => {
      expect(hook.result.current.rows).toHaveLength(6);
    });
    expect($page.clauses).toHaveLength(0);

    await hook.rerender({ filters: [{ id: 'name', value: 'ad' }] });
    await waitFor(() => {
      expect(hook.result.current.rows.map((row) => row.name)).toEqual(['Ada']);
    });

    await hook.unmount();
    expect($page.clauses).toHaveLength(0);
    expect(db.coordinator.clients.size).toBe(0);
  });

  test('StrictMode double-mount settles on one clause set and cleans up fully', async () => {
    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });

    const hook = await renderHook(
      (props: { filters: ColumnFiltersState }) => {
        useTanStackFilterBridge({
          filters: props.filters,
          set,
          columns: bridgeColumns,
        });
        return useMosaicRows<AthleteRow>({
          coordinator: db.coordinator,
          query: ({ where }) =>
            Query.from('athletes').select('id', 'sport').where(where),
          filterBy: $page,
        });
      },
      {
        initialProps: { filters: [{ id: 'weight', value: [60, 70] }] },
        reactStrictMode: true,
      },
    );

    await waitFor(() => {
      expect(hook.result.current.rows).toHaveLength(3);
    });
    // The simulated unmount destroyed the first bridge and removed its spec;
    // exactly one clause (from the second bridge's spec) remains.
    expect($page.clauses).toHaveLength(1);

    await hook.unmount();
    expect($page.clauses).toHaveLength(0);
    expect(db.coordinator.clients.size).toBe(0);
  });
});

describe('bridge lifecycle without a client', () => {
  test('set identity change moves specs to the new set', async () => {
    const selA = Selection.crossfilter();
    const selB = Selection.crossfilter();
    const setA = createFilterSet({ targets: { where: selA } });
    const setB = createFilterSet({ targets: { where: selB } });
    const filters: ColumnFiltersState = [{ id: 'sport', value: 'swim' }];

    const hook = await renderHook(
      (props: { set: FilterSet }) => {
        useTanStackFilterBridge({
          filters,
          set: props.set,
          columns: bridgeColumns,
        });
      },
      { initialProps: { set: setA } },
    );

    await settle();
    expect(selA.clauses).toHaveLength(1);
    expect(selB.clauses).toHaveLength(0);

    await hook.rerender({ set: setB });
    await settle();
    expect(selA.clauses).toHaveLength(0);
    expect(selB.clauses).toHaveLength(1);

    await hook.unmount();
    expect(selB.clauses).toHaveLength(0);
  });

  test('columns config is compared by value; a kind change republishes', async () => {
    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });
    const filters: ColumnFiltersState = [{ id: 'sport', value: 'swim' }];
    let valueEvents = 0;
    $page.addEventListener('value', () => {
      valueEvents += 1;
    });

    const hook = await renderHook(
      (props: { kind: 'equals' | 'ilike' }) => {
        useTanStackFilterBridge({
          filters,
          set,
          // Inline literal: fresh identity on every render, by construction.
          columns: { sport: { clause: props.kind } },
        });
      },
      { initialProps: { kind: 'equals' } },
    );

    await settle();
    expect($page.clauses[0]?.meta).toEqual({ type: 'point' });
    const eventsAfterMount = valueEvents;

    await hook.rerender({ kind: 'equals' });
    await settle();
    expect(valueEvents).toBe(eventsAfterMount);

    await hook.rerender({ kind: 'ilike' });
    await settle();
    expect($page.clauses).toHaveLength(1);
    expect($page.clauses[0]?.meta).toEqual({
      type: 'match',
      method: 'contains',
    });

    await hook.unmount();
    expect($page.clauses).toHaveLength(0);
  });

  test('onExternalChange reports the pruned state after a set reset', async () => {
    const $detail = Selection.intersect();
    const set = createFilterSet({ targets: { where: $detail } });
    const reported: Array<ColumnFiltersState> = [];

    const hook = await renderHook(
      (props: { filters: ColumnFiltersState }) => {
        useTanStackFilterBridge({
          filters: props.filters,
          set,
          columns: bridgeColumns,
          onExternalChange: (filters) => {
            reported.push(filters);
          },
        });
      },
      { initialProps: { filters: [{ id: 'sport', value: 'swim' }] } },
    );

    await settle();
    expect($detail.clauses).toHaveLength(1);

    await interact(() => set.reset());
    await settle();
    expect(reported.at(-1)).toEqual([]);
    expect($detail.clauses).toHaveLength(0);

    await hook.unmount();
  });
});

describe('hydration adoption', () => {
  // Exactly the spec shape the bridge builds for `name` under `'ilike'`, as a
  // URL persister would have hydrated it: once the consumer's state catches
  // up, the bridge value-diffs it as unchanged and writes nothing.
  const hydratedNameSpec = {
    id: 'name',
    column: 'name',
    kind: 'match',
    operator: 'contains',
    value: 'ada',
  };

  function trackStoreWrites(set: FilterSet): () => number {
    let writes = 0;
    set.store.subscribe(() => {
      writes += 1;
    });
    return () => writes;
  }

  test('a pre-seeded spec is adopted into columnFilters with zero spec churn', async () => {
    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });
    set.set(hydratedNameSpec);
    const writes = trackStoreWrites(set);

    // The consumer shape: columnFilters state adopted via onExternalChange.
    const hook = await renderHook(
      () => {
        const [filters, setFilters] = useState<ColumnFiltersState>([]);
        useTanStackFilterBridge({
          filters,
          set,
          columns: bridgeColumns,
          onExternalChange: setFilters,
        });
        return filters;
      },
      { initialProps: {} },
    );

    await waitFor(() => {
      expect(hook.result.current).toEqual([{ id: 'name', value: 'ada' }]);
    });
    // The spec was never removed/re-added: adoption writes nothing to the
    // set, the stale same-commit sync skips the protected id, and the
    // caught-up state value-diffs as unchanged.
    expect(writes()).toBe(0);
    expect(set.store.state.specs.map((s) => s.id)).toEqual(['name']);
    expect($page._resolved).toHaveLength(1);

    // Once confirmed by consumer state, unmount clears it like any managed
    // spec.
    await hook.unmount();
    expect(set.store.state.specs).toHaveLength(0);
    expect($page._resolved).toHaveLength(0);
  });

  test('StrictMode double-mount adopts persisted state without churn', async () => {
    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });
    set.set(hydratedNameSpec);
    const writes = trackStoreWrites(set);

    const hook = await renderHook(
      () => {
        const [filters, setFilters] = useState<ColumnFiltersState>([]);
        useTanStackFilterBridge({
          filters,
          set,
          columns: bridgeColumns,
          onExternalChange: setFilters,
        });
        return filters;
      },
      { initialProps: {}, reactStrictMode: true },
    );

    await waitFor(() => {
      expect(hook.result.current).toEqual([{ id: 'name', value: 'ada' }]);
    });
    // The first bridge's destroy left the (unconfirmed) adopted spec in
    // place; the second bridge re-adopted it. No removal, no re-add, no
    // transient persister-visible churn.
    expect(writes()).toBe(0);
    expect(set.store.state.specs.map((s) => s.id)).toEqual(['name']);
    expect($page._resolved).toHaveLength(1);

    await hook.unmount();
    expect(set.store.state.specs).toHaveLength(0);
  });
});
