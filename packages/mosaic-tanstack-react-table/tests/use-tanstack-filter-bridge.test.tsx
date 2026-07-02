import { Selection } from '@uwdata/mosaic-core';
import { Query } from '@uwdata/mosaic-sql';
import { beforeEach, describe, expect, test } from 'vitest';
import { useMosaicRows } from '@nozzleio/react-mosaic';

import { useTanStackFilterBridge } from '../src/index';
import {
  actWaitFor,
  createAthletesDb,
  renderHook,
  settle,
} from '../../react-mosaic/tests/test-utils';
import type { ColumnFiltersState } from '@tanstack/table-core';
import type { FilterBridgeColumns } from '../src/index';
import type { TestDb } from '../../react-mosaic/tests/test-utils';

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

    // The north-star wiring: the bridge and the table's rows client share
    // one component and one Selection, so every store update re-renders and
    // re-runs the bridge effects — the exact publish/echo loop shape.
    const hook = await renderHook(
      (props: { filters: ColumnFiltersState }) => {
        useTanStackFilterBridge({
          filters: props.filters,
          selection: $page,
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

    await actWaitFor(() => {
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
    await actWaitFor(() => {
      expect(hook.result.current.rows).toHaveLength(2);
    });
    expect($page.clauses).toHaveLength(1);
    expect($page.clauses[0]?.source).toBe(source);

    // Clearing the column filter removes its clause and unfilters.
    await hook.rerender({ filters: [] });
    await actWaitFor(() => {
      expect(hook.result.current.rows).toHaveLength(6);
    });
    expect($page.clauses).toHaveLength(0);

    await hook.rerender({ filters: [{ id: 'name', value: 'ad' }] });
    await actWaitFor(() => {
      expect(hook.result.current.rows.map((row) => row.name)).toEqual(['Ada']);
    });

    await hook.unmount();
    expect($page.clauses).toHaveLength(0);
    expect(db.coordinator.clients.size).toBe(0);
  });

  test('StrictMode double-mount settles on one clause set and cleans up fully', async () => {
    const $page = Selection.crossfilter();

    const hook = await renderHook(
      (props: { filters: ColumnFiltersState }) => {
        useTanStackFilterBridge({
          filters: props.filters,
          selection: $page,
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
        strict: true,
      },
    );

    await actWaitFor(() => {
      expect(hook.result.current.rows).toHaveLength(3);
    });
    // The simulated unmount destroyed the first bridge and its clauses;
    // exactly one clause (from the second bridge) remains.
    expect($page.clauses).toHaveLength(1);

    await hook.unmount();
    expect($page.clauses).toHaveLength(0);
    expect(db.coordinator.clients.size).toBe(0);
  });
});

describe('bridge lifecycle without a client', () => {
  test('selection identity change moves clauses to the new Selection', async () => {
    const selA = Selection.crossfilter();
    const selB = Selection.crossfilter();
    const filters: ColumnFiltersState = [{ id: 'sport', value: 'swim' }];

    const hook = await renderHook(
      (props: { selection: Selection }) => {
        useTanStackFilterBridge({
          filters,
          selection: props.selection,
          columns: bridgeColumns,
        });
      },
      { initialProps: { selection: selA } },
    );

    await settle();
    expect(selA.clauses).toHaveLength(1);
    expect(selB.clauses).toHaveLength(0);

    await hook.rerender({ selection: selB });
    await settle();
    expect(selA.clauses).toHaveLength(0);
    expect(selB.clauses).toHaveLength(1);

    await hook.unmount();
    expect(selB.clauses).toHaveLength(0);
  });

  test('columns config is compared by value; a kind change republishes', async () => {
    const $page = Selection.crossfilter();
    const filters: ColumnFiltersState = [{ id: 'sport', value: 'swim' }];
    let valueEvents = 0;
    $page.addEventListener('value', () => {
      valueEvents += 1;
    });

    const hook = await renderHook(
      (props: { kind: 'equals' | 'ilike' }) => {
        useTanStackFilterBridge({
          filters,
          selection: $page,
          // Inline literal: fresh identity on every render, by construction.
          columns: { sport: { clause: props.kind } },
        });
      },
      { initialProps: { kind: 'equals' as 'equals' | 'ilike' } },
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
});
