import { Param, Selection } from '@uwdata/mosaic-core';
import { Query, count, eq, gte, literal } from '@uwdata/mosaic-sql';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  createAthletesDb,
  settle,
  waitFor,
} from '@nozzleio/test-support/duckdb';
import { createRowsClient } from '../src/index';
import type { TestDb } from '@nozzleio/test-support/duckdb';

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

describe('latest-ref query factory', () => {
  test('setQuery with a new factory identity does not re-query; the next trigger uses the latest factory', async () => {
    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      inputs: { orderBy: [{ column: 'id' }] },
    });

    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.rows).toHaveLength(6);
    });
    const queriesAfterInit = db.clientQueries.length;

    // New factory identity: swim-only. Must NOT trigger a query by itself.
    client.setQuery(({ where }) =>
      athleteQuery().where(eq('sport', literal('swim')), where),
    );
    await settle();
    expect(db.clientQueries.length).toBe(queriesAfterInit);
    expect(client.store.state.rows).toHaveLength(6);

    // The next trigger (an inputs change) must be built from the latest factory.
    client.setInputs({ limit: 10 });
    await waitFor(() => {
      expect(client.store.state.rows).toHaveLength(4);
    });
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);

    client.destroy();
  });

  test('refetch() uses the latest factory', async () => {
    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
    });

    await waitFor(() => {
      expect(client.store.state.rows).toHaveLength(6);
    });

    client.setQuery(({ where }) =>
      athleteQuery().where(eq('sport', literal('run')), where),
    );
    await client.refetch();
    expect(client.store.state.rows).toHaveLength(2);

    client.destroy();
  });
});

describe('setInputs diffing', () => {
  test('value-equal patch triggers no query; changed patch triggers exactly one', async () => {
    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      inputs: { orderBy: [{ column: 'weight', desc: true }], limit: 3 },
    });

    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.rows.map((r) => r.id)).toEqual([4, 3, 2]);
    });
    const queriesAfterInit = db.clientQueries.length;

    // Same values, fresh object identities: must not query.
    client.setInputs({ orderBy: [{ column: 'weight', desc: true }], limit: 3 });
    await settle();
    expect(db.clientQueries.length).toBe(queriesAfterInit);

    // A changed patch queries exactly once, merge-patching untouched keys.
    client.setInputs({ limit: 2 });
    await waitFor(() => {
      expect(client.store.state.rows.map((r) => r.id)).toEqual([4, 3]);
    });
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);
    expect(client.store.state.inputs).toEqual({
      orderBy: [{ column: 'weight', desc: true }],
      limit: 2,
    });

    client.destroy();
  });
});

describe('input-driven coalescing', () => {
  test('a synchronous burst of setInputs collapses to exactly one query build', async () => {
    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      inputs: { orderBy: [{ column: 'id' }] },
    });

    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.rows).toHaveLength(6);
    });
    const queriesAfterInit = db.clientQueries.length;
    const connectorAfterInit = db.connectorQueries.length;

    // Five distinct input changes in a single synchronous tick.
    client.setInputs({ limit: 5 });
    client.setInputs({ limit: 4 });
    client.setInputs({ limit: 3 });
    client.setInputs({ limit: 2 });
    client.setInputs({ limit: 1 });

    // Loading state reflects synchronously even though the query is deferred to
    // the coalescing frame — no query has run yet.
    expect(client.store.state.status).toBe('pending');
    expect(db.clientQueries.length).toBe(queriesAfterInit);

    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.rows).toHaveLength(1);
    });

    // The whole burst built and ran exactly one query.
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);
    expect(db.connectorQueries.length).toBe(connectorAfterInit + 1);

    client.destroy();
  });

  test('the last inputs in a synchronous burst win', async () => {
    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      inputs: { orderBy: [{ column: 'id' }] },
    });

    await waitFor(() => {
      expect(client.store.state.rows).toHaveLength(6);
    });

    client.setInputs({ limit: 4 });
    client.setInputs({ limit: 3 });
    client.setInputs({ limit: 2 });

    await waitFor(() => {
      expect(client.store.state.rows.map((r) => r.id)).toEqual([1, 2]);
    });
    expect(client.store.state.inputs).toEqual({
      orderBy: [{ column: 'id' }],
      limit: 2,
    });

    client.destroy();
  });

  test('refetch() bypasses coalescing and queries immediately', async () => {
    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
    });

    await waitFor(() => {
      expect(client.store.state.rows).toHaveLength(6);
    });
    const queriesAfterInit = db.clientQueries.length;

    // The awaited request resolves against a query that already ran — no
    // coalescing frame elapsed between the call and the completed round trip.
    await client.refetch();
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);
    expect(client.store.state.status).toBe('success');

    client.destroy();
  });
});

describe('param wiring', () => {
  test('param.update() triggers exactly one re-query', async () => {
    const $minWeight = Param.value(0);

    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) =>
        athleteQuery().where(gte('weight', literal($minWeight.value!)), where),
      params: { minWeight: $minWeight },
    });

    await waitFor(() => {
      expect(client.store.state.rows).toHaveLength(6);
    });
    const queriesAfterInit = db.clientQueries.length;

    $minWeight.update(70);
    await waitFor(() => {
      expect(client.store.state.rows).toHaveLength(3);
    });
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);

    // Unchanged value: Param does not emit, so no re-query.
    $minWeight.update(70);
    await settle();
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);

    client.destroy();
    $minWeight.update(0);
    await settle();
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);
  });
});

describe('havingBy routing', () => {
  test('havingBy predicates land in HAVING; updates re-query', async () => {
    const $agg = Selection.intersect();

    const client = createRowsClient<{ sport: string; total: number }>({
      coordinator: db.coordinator,
      query: ({ where, having }) =>
        Query.from('athletes')
          .select('sport', { total: count() })
          .groupby('sport')
          .where(where)
          .having(having),
      havingBy: $agg,
      inputs: { orderBy: [{ column: 'sport' }] },
    });

    await waitFor(() => {
      expect(client.store.state.rows).toHaveLength(2);
    });

    $agg.update({
      source: {},
      value: 3,
      fields: [],
      predicate: gte('total', literal(3)),
    });

    await waitFor(() => {
      expect(client.store.state.rows.map((r) => r.sport)).toEqual(['swim']);
    });
    expect(client.store.state.lastQuery).toMatch(/HAVING/i);

    client.destroy();
  });

  test('the same Selection as filterBy and havingBy queries exactly once per activation', async () => {
    const $sel = Selection.intersect();

    const client = createRowsClient<{ sport: string; total: number }>({
      coordinator: db.coordinator,
      query: ({ where, having }) =>
        Query.from('athletes')
          .select('sport', { total: count() })
          .groupby('sport')
          .where(where)
          .having(having),
      filterBy: $sel,
      havingBy: $sel,
    });

    await waitFor(() => {
      expect(client.store.state.rows).toHaveLength(2);
    });
    const queriesAfterInit = db.clientQueries.length;

    // Grouped-column predicate: legal in both WHERE and HAVING, which is
    // where a shared Selection routes it.
    $sel.update({
      source: {},
      value: 'swim',
      fields: [],
      predicate: eq('sport', literal('swim')),
    });

    await waitFor(() => {
      expect(client.store.state.rows.map((r) => r.sport)).toEqual(['swim']);
    });
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);
    expect(client.store.state.lastQuery).toMatch(/HAVING/i);

    client.destroy();
  });
});

describe('enabled + refetch', () => {
  test('enabled: false defers the initial query until setEnabled(true)', async () => {
    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      enabled: false,
    });

    await settle();
    expect(client.store.state.status).toBe('idle');
    expect(db.clientQueries.length).toBe(0);

    client.setEnabled(true);
    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.rows).toHaveLength(6);
    });

    client.destroy();
  });

  test('query errors surface on the store with status "error"', async () => {
    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: () => Query.from('does_not_exist').select('*'),
    });

    await waitFor(() => {
      expect(client.store.state.status).toBe('error');
      expect(client.store.state.error).toBeInstanceOf(Error);
    });

    client.destroy();
  });

  test('store echoes inputs and lastQuery for the executed query', async () => {
    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      inputs: { limit: 4 },
    });

    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
    });
    expect(client.store.state.inputs).toEqual({ limit: 4 });
    expect(client.store.state.lastQuery).toMatch(/LIMIT 4/i);

    client.destroy();
  });
});
