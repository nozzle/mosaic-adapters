import { createAthletesDb, settle, waitFor } from '@nozzleio/test-support/duckdb';
import type { TestDb } from '@nozzleio/test-support/duckdb';
import { Selection } from '@uwdata/mosaic-core';
import { Query } from '@uwdata/mosaic-sql';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { createFilterSet, createRowsClient } from '../src/index';
import type { RowsClient } from '../src/index';

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

function athleteQuery() {
  return Query.from('athletes').select('id', 'name', 'sport', 'weight');
}

async function untilLoaded(client: RowsClient<AthleteRow>): Promise<void> {
  await waitFor(() => {
    expect(client.store.state.status).toBe('success');
  });
}

describe('state.selected — raw Selection target', () => {
  test('starts empty and follows selectRows / setSelectedValues / clear', async () => {
    const $picked = Selection.union();
    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      inputs: { orderBy: [{ column: 'id' }] },
      publish: { select: { as: $picked, columns: ['id', 'sport'] } },
    });
    expect(client.store.state.selected).toEqual([]);
    await untilLoaded(client);

    const [ada, bo] = client.store.state.rows;
    client.selectRows([ada!, bo!]);
    // Tuples aligned to publish.select.columns, in publish order.
    expect(client.store.state.selected).toEqual([
      [1, 'swim'],
      [2, 'swim'],
    ]);

    client.setSelectedValues([[3, 'swim']]);
    expect(client.store.state.selected).toEqual([[3, 'swim']]);

    client.selectRows([]);
    expect(client.store.state.selected).toEqual([]);

    client.destroy();
  });

  test('the published value is a defensive copy of the caller tuples', async () => {
    const $picked = Selection.union();
    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      publish: { select: { as: $picked, columns: ['id'] } },
    });
    await untilLoaded(client);

    const tuples = [[4]];
    client.setSelectedValues(tuples);
    tuples[0]!.push(99);
    tuples.push([5]);
    expect(client.store.state.selected).toEqual([[4]]);

    client.destroy();
  });

  test('re-publishing an equal selection does not notify store subscribers', async () => {
    const $picked = Selection.union();
    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      publish: { select: { as: $picked, columns: ['id'] } },
    });
    await untilLoaded(client);
    client.setSelectedValues([[1]]);
    const before = client.store.state.selected;

    client.setSelectedValues([[1]]);
    // Same reference: no patch, so `selected` selectors never re-fire.
    expect(client.store.state.selected).toBe(before);

    client.destroy();
  });

  test('an external clear (selection.reset) empties selected', async () => {
    const $picked = Selection.crossfilter();
    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      publish: { select: { as: $picked, columns: ['id'] } },
    });
    await untilLoaded(client);
    client.setSelectedValues([[3], [4]]);
    expect(client.store.state.selected).toEqual([[3], [4]]);

    $picked.reset();
    await waitFor(() => {
      expect(client.store.state.selected).toEqual([]);
    });

    client.destroy();
  });

  test('persisted tuples hydrate into selected before the first result', async () => {
    const $picked = Selection.crossfilter();
    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      publish: { select: { as: $picked, columns: ['id'] } },
      persist: { read: () => [[5]], write: vi.fn() },
    });

    await untilLoaded(client);
    expect(client.store.state.selected).toEqual([[5]]);

    client.destroy();
  });

  test('destroy clears selected along with the clause it removes', async () => {
    const $picked = Selection.union();
    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      publish: { select: { as: $picked, columns: ['id'] } },
    });
    await untilLoaded(client);
    client.setSelectedValues([[2]]);

    client.destroy();
    expect($picked._resolved).toHaveLength(0);
    expect(client.store.state.selected).toEqual([]);
  });

  test('a caller-provided source retains the clause and selected through destroy', async () => {
    const $picked = Selection.union();
    const source = {};
    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      publish: { select: { as: $picked, columns: ['id'], source } },
    });
    await untilLoaded(client);
    client.setSelectedValues([[2]]);

    client.destroy();
    await settle();
    expect($picked.valueFor(source)).toEqual([[2]]);
    expect(client.store.state.selected).toEqual([[2]]);
  });

  test('without a publish.select target, selected stays empty', async () => {
    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
    });
    await untilLoaded(client);

    client.selectRows([client.store.state.rows[0]!]);
    client.setSelectedValues([[1]]);
    expect(client.store.state.selected).toEqual([]);

    client.destroy();
  });
});

describe('state.selected — publish.select.into FilterSet target', () => {
  test('follows the selection and an external set.remove', async () => {
    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });
    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      inputs: { orderBy: [{ column: 'id' }] },
      publish: { select: { into: set, id: 'picked', columns: ['id'] } },
    });
    await untilLoaded(client);

    client.setSelectedValues([[1], [2]]);
    expect(client.store.state.selected).toEqual([[1], [2]]);

    set.remove('picked');
    expect(client.store.state.selected).toEqual([]);

    client.destroy();
    set.destroy();
  });

  test('adopts an externally written points value (flat and envelope shapes)', async () => {
    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });
    const single = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      publish: { select: { into: set, id: 'one', columns: ['id'] } },
    });
    const multi = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      publish: {
        select: { into: set, id: 'two', columns: ['name', 'sport'] },
      },
    });
    await untilLoaded(single);
    await untilLoaded(multi);

    set.set({ id: 'one', column: 'id', kind: 'points', value: [3, 4] });
    expect(single.store.state.selected).toEqual([[3], [4]]);

    set.set({
      id: 'two',
      column: 'name',
      kind: 'points',
      value: { columns: ['name', 'sport'], tuples: [['Ada', 'swim']] },
    });
    expect(multi.store.state.selected).toEqual([['Ada', 'swim']]);

    single.destroy();
    multi.destroy();
    set.destroy();
  });

  test('a pre-existing spec hydrates selected; unrelated set changes do not notify', async () => {
    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });
    set.set({ id: 'picked', column: 'id', kind: 'points', value: [6] });

    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      publish: { select: { into: set, id: 'picked', columns: ['id'] } },
    });
    await untilLoaded(client);
    expect(client.store.state.selected).toEqual([[6]]);

    const before = client.store.state.selected;
    let notifications = 0;
    const subscription = client.store.subscribe(() => {
      notifications += 1;
    });
    // Another writer's spec: the set mirror re-reads ours, finds it unchanged,
    // and leaves the store alone.
    set.set({ id: 'other', column: 'sport', kind: 'point', value: 'swim' });
    expect(client.store.state.selected).toBe(before);
    expect(notifications).toBe(0);
    subscription.unsubscribe();

    // The set owns the spec, so destroy leaves both it and selected intact.
    client.destroy();
    expect(set.store.state.specs.map((spec) => spec.id)).toContain('picked');
    expect(client.store.state.selected).toEqual([[6]]);
    set.destroy();
  });
});
