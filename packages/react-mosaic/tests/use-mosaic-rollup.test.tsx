import { createAthletesDb, renderHook, waitFor } from '@nozzleio/test-support/react';
import type { TestDb } from '@nozzleio/test-support/react';
import { Selection } from '@uwdata/mosaic-core';
import { Query, count, sum } from '@uwdata/mosaic-sql';
import { beforeEach, describe, expect, test } from 'vitest';

import { rollupRowsToTree, useMosaicRollup } from '../src/index';

interface WeightRollup {
  sport: string | null;
  athletes: number | bigint;
  totalWeight: number | bigint;
}

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

describe('useMosaicRollup', () => {
  test('loads the level-tagged tree; the helper re-exports through the package', async () => {
    const hook = await renderHook(
      () =>
        useMosaicRollup<WeightRollup>({
          coordinator: db.coordinator,
          query: ({ where }) =>
            Query.from('athletes')
              .select({ athletes: count(), totalWeight: sum('weight') })
              .where(where),
          groupBy: ['sport'],
        }),
      { initialProps: {}, reactStrictMode: true },
    );

    await waitFor(() => {
      expect(hook.result.current.rows).toHaveLength(3);
    });
    expect(hook.result.current.rows.map((r) => [r.level, r.data.sport, r.isLeaf])).toEqual([
      [0, null, false],
      [1, 'run', true],
      [1, 'swim', true],
    ]);

    const roots = rollupRowsToTree(hook.result.current.rows);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.children).toHaveLength(2);

    await hook.unmount();
    expect(db.coordinator.clients.size).toBe(0);
  });

  test('coalesceFilterBy is structural: flipping it recreates the client', async () => {
    const $page = Selection.crossfilter();
    const hook = await renderHook(
      (props: { coalesce: boolean }) =>
        useMosaicRollup<WeightRollup>({
          coordinator: db.coordinator,
          query: ({ where }) =>
            Query.from('athletes')
              .select({ athletes: count(), totalWeight: sum('weight') })
              .where(where),
          groupBy: ['sport'],
          filterBy: $page,
          coalesceFilterBy: props.coalesce,
        }),
      { initialProps: { coalesce: true } },
    );

    await waitFor(() => {
      expect(hook.result.current.rows).toHaveLength(3);
    });
    const coalesced = hook.result.current.client;
    // Forced `filterStable: false`, so the default path is the coalesced one.
    expect(db.coordinator.filterGroups.get($page)?.clients.has(coalesced.mosaicClient)).not.toBe(
      true,
    );

    await hook.rerender({ coalesce: false });
    await waitFor(() => {
      expect(hook.result.current.client).not.toBe(coalesced);
      expect(hook.result.current.rows).toHaveLength(3);
    });
    expect(coalesced.destroyed).toBe(true);
    const upstream = hook.result.current.client;
    expect(db.coordinator.filterGroups.get($page)?.clients.has(upstream.mosaicClient)).toBe(true);

    await hook.unmount();
  });
});
