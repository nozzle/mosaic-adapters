import { Selection, clausePoint } from '@uwdata/mosaic-core';
import { Query, count, sum } from '@uwdata/mosaic-sql';
import { beforeEach, describe, expect, test } from 'vitest';

import { createAthletesDb, waitFor } from '@nozzleio/test-support/duckdb';
import { createRollupClient, rollupRowsToTree } from '../src/index';
import type { TestDb } from '@nozzleio/test-support/duckdb';

interface WeightRollup {
  sport: string | null;
  name: string | null;
  athletes: number | bigint;
  totalWeight: number | bigint;
}

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

function createClient($page?: Selection) {
  return createRollupClient<WeightRollup>({
    coordinator: db.coordinator,
    query: ({ where }) =>
      Query.from('athletes')
        .select({ athletes: count(), totalWeight: sum('weight') })
        .where(where),
    groupBy: ['sport', 'name'],
    filterBy: $page,
  });
}

describe('rollup client', () => {
  test('one ROLLUP query returns the whole tree, GROUPING-tagged and pre-ordered', async () => {
    const rollup = createClient();

    await waitFor(() => {
      expect(rollup.store.state.status).toBe('success');
    });
    // 1 grand total + 2 sport subtotals + 6 leaves, in one query.
    expect(db.clientQueries).toHaveLength(1);
    const rows = rollup.store.state.rows;
    expect(rows).toHaveLength(9);

    // Grand total first: level 0, empty path, all rolled-up columns NULL.
    const total = rows[0]!;
    expect(total.level).toBe(0);
    expect(total.groupPath).toEqual([]);
    expect(total.isLeaf).toBe(false);
    expect(total.data.sport).toBeNull();
    expect(Number(total.data.athletes)).toBe(6);
    expect(Number(total.data.totalWeight)).toBe(420);

    // Pre-order: each subtotal is immediately followed by its own leaves.
    expect(
      rows.slice(1).map((r) => [r.level, r.data.sport, r.data.name]),
    ).toEqual([
      [1, 'run', null],
      [2, 'run', 'Ed'],
      [2, 'run', 'Fi'],
      [1, 'swim', null],
      [2, 'swim', 'Ada'],
      [2, 'swim', 'Bo'],
      [2, 'swim', 'Cy'],
      [2, 'swim', 'Di'],
    ]);

    const run = rows[1]!;
    expect(run.groupPath).toEqual(['run']);
    expect(run.isLeaf).toBe(false);
    expect(Number(run.data.athletes)).toBe(2);
    expect(Number(run.data.totalWeight)).toBe(120);

    const ed = rows[2]!;
    expect(ed.groupPath).toEqual(['run', 'Ed']);
    expect(ed.isLeaf).toBe(true);
    expect(Number(ed.data.athletes)).toBe(1);

    rollup.destroy();
  });

  test('rollupRowsToTree nests the flat rows by level', async () => {
    const rollup = createClient();
    await waitFor(() => {
      expect(rollup.store.state.rows).toHaveLength(9);
    });

    const roots = rollupRowsToTree(rollup.store.state.rows);
    expect(roots).toHaveLength(1);
    const total = roots[0]!;
    expect(total.row.level).toBe(0);
    expect(total.children.map((c) => c.row.data.sport)).toEqual([
      'run',
      'swim',
    ]);
    expect(total.children[0]!.children.map((c) => c.row.data.name)).toEqual([
      'Ed',
      'Fi',
    ]);
    expect(total.children[1]!.children).toHaveLength(4);

    rollup.destroy();
  });

  test('cross-filtering re-aggregates the whole tree', async () => {
    const $page = Selection.crossfilter();
    const rollup = createClient($page);

    await waitFor(() => {
      expect(rollup.store.state.rows).toHaveLength(9);
    });

    $page.update(
      clausePoint('sport', 'run', { source: { peer: true } as object }),
    );
    await waitFor(() => {
      expect(rollup.store.state.rows).toHaveLength(4);
    });
    expect(Number(rollup.store.state.rows[0]!.data.athletes)).toBe(2);

    rollup.destroy();
  });

  test('invalid configurations throw at creation', () => {
    expect(() =>
      createRollupClient({
        coordinator: db.coordinator,
        query: 'athletes',
        groupBy: ['sport'],
      }),
    ).toThrowError(/query factory/);

    expect(() =>
      createRollupClient({
        coordinator: db.coordinator,
        query: ({ where }) =>
          Query.from('athletes').select({ athletes: count() }).where(where),
        groupBy: [],
      }),
    ).toThrowError(/at least one groupBy/);
  });
});
