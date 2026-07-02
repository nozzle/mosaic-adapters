import { Selection } from '@uwdata/mosaic-core';
import { Query } from '@uwdata/mosaic-sql';
import { beforeEach, describe, expect, test } from 'vitest';

import { createRowsClient } from '../src/index';
import { createAthletesDb, settle, waitFor } from './test-utils';
import type { TestDb } from './test-utils';

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

function createPublishingClient($picked: Selection, $hovered?: Selection) {
  return createRowsClient<AthleteRow>({
    coordinator: db.coordinator,
    query: ({ where }) => athleteQuery().where(where),
    inputs: { orderBy: [{ column: 'id' }] },
    publish: {
      select: { as: $picked, columns: ['id'] },
      ...($hovered
        ? { hover: { as: $hovered, columns: ['id'], throttleMs: 0 } }
        : {}),
    },
  });
}

describe('row-selection publishing', () => {
  test('selectRows publishes one clause with a stable source; [] clears it', async () => {
    const $picked = Selection.union();
    const client = createPublishingClient($picked);

    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
    });
    const [ada, bo] = client.store.state.rows;

    client.selectRows([ada!, bo!]);
    expect($picked.clauses).toHaveLength(1);
    const firstSource = $picked.clauses[0]!.source;
    expect($picked.clauses[0]!.value).toEqual([[1], [2]]);
    // clausePoints meta drives pre-aggregation; clients drives self-exclusion.
    expect($picked.clauses[0]!.meta).toEqual({ type: 'point' });
    expect($picked.clauses[0]!.clients?.has(client.mosaicClient)).toBe(true);

    // Re-publishing keeps the same source identity: the Selection replaces
    // the clause instead of accumulating one per call.
    client.selectRows([ada!]);
    expect($picked.clauses).toHaveLength(1);
    expect($picked.clauses[0]!.source).toBe(firstSource);
    expect($picked.clauses[0]!.value).toEqual([[1]]);

    // Empty selection clears the clause entirely.
    client.selectRows([]);
    expect($picked.clauses).toHaveLength(0);

    client.destroy();
  });

  test('published predicates actually filter a downstream client', async () => {
    const $picked = Selection.union();
    const publisher = createPublishingClient($picked);

    const consumer = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      filterBy: $picked,
      inputs: { orderBy: [{ column: 'id' }] },
    });

    await waitFor(() => {
      expect(publisher.store.state.status).toBe('success');
      expect(consumer.store.state.rows).toHaveLength(6);
    });

    publisher.selectRows([publisher.store.state.rows[4]!]);
    await waitFor(() => {
      expect(consumer.store.state.rows.map((r) => r.id)).toEqual([5]);
    });

    publisher.destroy();
    consumer.destroy();
  });

  test('hoverRow publishes a transient clause; null clears it', async () => {
    const $picked = Selection.union();
    const $hovered = Selection.union();
    const client = createPublishingClient($picked, $hovered);

    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
    });

    client.hoverRow(client.store.state.rows[2]!);
    await waitFor(() => {
      expect($hovered.clauses).toHaveLength(1);
    });
    expect($hovered.clauses[0]!.value).toEqual([[3]]);

    // Hover and select use distinct clause sources, so publishing both into
    // the same Selection would not collide; here they are separate Selections
    // and the select clause is untouched by hover updates.
    expect($picked.clauses).toHaveLength(0);

    client.hoverRow(null);
    await waitFor(() => {
      expect($hovered.clauses).toHaveLength(0);
    });

    client.destroy();
  });

  test('hover publishing is throttled by default', async () => {
    const $picked = Selection.union();
    const $hovered = Selection.union();

    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      inputs: { orderBy: [{ column: 'id' }] },
      publish: {
        select: { as: $picked, columns: ['id'] },
        hover: { as: $hovered, columns: ['id'] },
      },
    });

    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
    });

    let updates = 0;
    $hovered.addEventListener('value', () => {
      updates += 1;
    });

    // Mouse-speed churn: many hovers inside one throttle window.
    for (const row of client.store.state.rows) {
      client.hoverRow(row);
    }

    await waitFor(() => {
      expect($hovered.clauses).toHaveLength(1);
      // Trailing value wins.
      expect($hovered.clauses[0]!.value).toEqual([[6]]);
    });
    expect(updates).toBeLessThan(6);

    client.destroy();
  });

  test('destroy() removes published clauses and disconnects the client', async () => {
    const $picked = Selection.union();
    const $hovered = Selection.union();
    const client = createPublishingClient($picked, $hovered);

    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
    });

    client.selectRows([client.store.state.rows[0]!]);
    client.hoverRow(client.store.state.rows[1]!);
    await waitFor(() => {
      expect($picked.clauses).toHaveLength(1);
      expect($hovered.clauses).toHaveLength(1);
    });

    expect(db.coordinator.clients.has(client.mosaicClient)).toBe(true);

    client.destroy();

    expect($picked.clauses).toHaveLength(0);
    expect($hovered.clauses).toHaveLength(0);
    expect(db.coordinator.clients.has(client.mosaicClient)).toBe(false);

    // Destroyed clients ignore further interaction instead of resurrecting
    // clauses or queries.
    client.selectRows([{ id: 1, name: 'Ada', sport: 'swim', weight: 60 }]);
    await settle();
    expect($picked.clauses).toHaveLength(0);
  });
});
