import { Query, count, sum } from '@uwdata/mosaic-sql';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  createAthletesDb,
  renderHook,
  waitFor,
} from '@nozzleio/test-support/react';
import { rollupRowsToTree, useMosaicRollup } from '../src/index';
import type { TestDb } from '@nozzleio/test-support/react';

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
    expect(
      hook.result.current.rows.map((r) => [r.level, r.data.sport, r.isLeaf]),
    ).toEqual([
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
});
