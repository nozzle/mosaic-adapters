/**
 * `state.settled` (provenance of the payload in the store) and
 * `client.invalidate()` (a batched re-query after the query itself changed).
 * A controllable connector holds each query open so the gap between "built"
 * (`inputs`/`lastQuery`) and "settled" can be observed exactly.
 */
import { createAthletesDb, rowsToIPC, settle, waitFor } from '@nozzleio/test-support/duckdb';
import { Coordinator, Param, Selection, clausePoint } from '@uwdata/mosaic-core';
import type { ArrowQueryRequest, Connector, ExecQueryRequest } from '@uwdata/mosaic-core';
import { Query, count, eq, literal } from '@uwdata/mosaic-sql';
import { describe, expect, test, vi } from 'vitest';

import { createRowsClient, createSparklineClient, createValuesClient } from '../src/index';
import type { QuerySource, RowsInputs, ValuesInputs } from '../src/index';

interface Deferred {
  sql: string;
  resolve: (rows: Array<Record<string, unknown>>) => void;
  reject: (error: Error) => void;
}

interface ControlledDb {
  coordinator: Coordinator;
  /** Every request that reached the connector, in submission order. */
  requests: Array<Deferred>;
}

function createControlledDb(): ControlledDb {
  const requests: Array<Deferred> = [];
  const connector = {
    query(request: ArrowQueryRequest | ExecQueryRequest) {
      return new Promise<Uint8Array>((resolve, reject) => {
        requests.push({
          sql: request.sql,
          resolve: (rows) => resolve(rowsToIPC(rows)),
          reject,
        });
      });
    },
  } as Connector;
  const coordinator = new Coordinator(connector, {
    logger: null,
    consolidate: false,
    cache: false,
    preagg: { enabled: false },
  });
  return { coordinator, requests };
}

interface Row {
  id: number;
}

const rowsFrom: QuerySource<RowsInputs> = ({ where }) => Query.from('t').select('id').where(where);

describe('state.settled', () => {
  test('is null until the first response, then names the request that produced the rows', async () => {
    const db = createControlledDb();
    const client = createRowsClient<Row>({
      coordinator: db.coordinator,
      query: rowsFrom,
      inputs: { limit: 10 },
    });
    expect(client.store.state.settled).toBeNull();
    await settle(0);
    expect(db.requests).toHaveLength(1);

    // Built, not settled: `inputs`/`lastQuery` already describe the request.
    expect(client.store.state.status).toBe('pending');
    expect(client.store.state.lastQuery).toBe(db.requests[0]!.sql);
    expect(client.store.state.settled).toBeNull();

    db.requests[0]!.resolve([{ id: 1 }]);
    await settle(0);
    expect(client.store.state.status).toBe('success');
    expect(client.store.state.settled).toEqual({
      inputs: { limit: 10 },
      query: db.requests[0]!.sql,
    });
    expect(client.store.state.settled?.query).toBe(client.store.state.lastQuery);

    client.destroy();
  });

  test('keeps describing the rows on screen while a re-query is pending', async () => {
    const db = createControlledDb();
    const client = createRowsClient<Row>({
      coordinator: db.coordinator,
      query: rowsFrom,
      inputs: { limit: 10 },
    });
    await settle(0);
    db.requests[0]!.resolve([{ id: 1 }]);
    await settle(0);
    const first = client.store.state.settled;

    client.setInputs({ limit: 20 });
    await settle(0);
    expect(db.requests).toHaveLength(2);

    // `inputs`/`lastQuery` moved to the pending request; the rows and their
    // provenance did not — the documented stale derivation holds.
    const pending = client.store.state;
    expect(pending.status).toBe('pending');
    expect(pending.inputs).toEqual({ limit: 20 });
    expect(pending.lastQuery).toBe(db.requests[1]!.sql);
    expect(pending.rows).toEqual([{ id: 1 }]);
    expect(pending.settled).toBe(first);
    expect(pending.settled?.inputs).toEqual({ limit: 10 });
    expect(pending.settled?.query).not.toBe(pending.lastQuery);

    db.requests[1]!.resolve([{ id: 2 }]);
    await settle(0);
    expect(client.store.state.settled).toEqual({
      inputs: { limit: 20 },
      query: db.requests[1]!.sql,
    });
    expect(client.store.state.settled?.query).toBe(client.store.state.lastQuery);

    client.destroy();
  });

  test('a superseded response does not move it; the current one does', async () => {
    const db = createControlledDb();
    const filterBy = Selection.intersect();
    const client = createValuesClient<{ total: number }>({
      coordinator: db.coordinator,
      filterBy,
      query: ({ where }) =>
        Query.from('t')
          .select({ total: literal(1) })
          .where(where),
    });
    await settle(0);
    filterBy.update(clausePoint('sport', 'swim', { source: {} }));
    await settle(0);
    expect(db.requests).toHaveLength(2);

    db.requests[0]!.resolve([{ total: 6 }]);
    await settle(0);
    expect(client.store.state.settled).toBeNull();

    db.requests[1]!.resolve([{ total: 4 }]);
    await settle(0);
    expect(client.store.state.settled?.query).toBe(db.requests[1]!.sql);
    expect(client.store.state.settled?.query).toContain('swim');

    client.destroy();
  });

  test('is not updated when the current request fails', async () => {
    const db = createControlledDb();
    const client = createRowsClient<Row>({
      coordinator: db.coordinator,
      query: rowsFrom,
      inputs: { limit: 10 },
    });
    await settle(0);
    db.requests[0]!.resolve([{ id: 1 }]);
    await settle(0);
    const first = client.store.state.settled;
    expect(first).not.toBeNull();

    client.setInputs({ limit: 20 });
    await settle(0);
    db.requests[1]!.reject(new Error('boom'));
    await settle(0);

    expect(client.store.state.status).toBe('error');
    expect(client.store.state.rows).toEqual([{ id: 1 }]);
    expect(client.store.state.settled).toBe(first);
    expect(client.store.state.settled?.query).not.toBe(client.store.state.lastQuery);

    client.destroy();
  });

  test('a first request that fails leaves it null', async () => {
    const db = createControlledDb();
    const client = createRowsClient<Row>({
      coordinator: db.coordinator,
      query: rowsFrom,
    });
    await settle(0);
    db.requests[0]!.reject(new Error('boom'));
    await settle(0);

    expect(client.store.state.status).toBe('error');
    expect(client.store.state.settled).toBeNull();

    client.destroy();
  });

  test('an empty round settles with the current inputs and no SQL', async () => {
    const db = await createAthletesDb();
    const spark = createSparklineClient({
      coordinator: db.coordinator,
      from: 'athletes',
      key: 'sport',
      x: { column: 'weight', step: 10 },
      y: { agg: 'count' },
    });

    await waitFor(() => {
      expect(spark.store.state.status).toBe('success');
    });
    expect(db.clientQueries).toHaveLength(0);
    expect(spark.store.state.lastQuery).toBeNull();
    expect(spark.store.state.settled).toEqual({
      inputs: spark.store.state.inputs,
      query: null,
    });

    spark.destroy();
  });
});

describe('state.settled with pre-aggregation', () => {
  // `createAthletesDb` leaves the coordinator's pre-aggregation on (upstream's
  // default), and a values client keeps `filterStable` on, so selection
  // updates from another source are answered from a materialized view. The
  // optimizer calls the client's `query()` to analyze it and build that view;
  // none of those builds is the query the response answers.
  const totals: QuerySource<ValuesInputs> = ({ where }) =>
    Query.from('athletes').select({ athletes: count() }).where(where);

  test('a pre-aggregated response settles with no SQL, the first one included', async () => {
    const db = await createAthletesDb();
    const $page = Selection.crossfilter();
    const source = { id: 'sport' };
    const client = createValuesClient<{ athletes: number }>({
      coordinator: db.coordinator,
      filterBy: $page,
      query: totals,
    });
    await waitFor(() => {
      expect(client.store.state.values?.athletes).toBe(6);
    });
    expect(client.store.state.settled?.query).toBe(client.store.state.lastQuery);

    // First update for this source: the optimizer analyzes the client query
    // (building it with and without the active clause) and creates the view.
    $page.activate(clausePoint('sport', 'swim', { source }));
    $page.update(clausePoint('sport', 'swim', { source }));
    await waitFor(() => {
      expect(client.store.state.values?.athletes).toBe(4);
    });
    expect(db.clientQueries.at(-1)).toContain('preagg_');
    expect(client.store.state.settled).toEqual({
      inputs: client.store.state.inputs,
      query: null,
    });

    // Later updates reuse the cached view.
    $page.update(clausePoint('sport', 'run', { source }));
    await waitFor(() => {
      expect(client.store.state.values?.athletes).toBe(2);
    });
    expect(db.clientQueries.at(-1)).toContain('preagg_');
    expect(client.store.state.settled?.query).toBeNull();

    // A query the client builds itself names its SQL again.
    client.invalidate();
    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.settled?.query).not.toBeNull();
    });
    expect(client.store.state.settled?.query).toBe(client.store.state.lastQuery);
    expect(client.store.state.settled?.query).toBe(db.clientQueries.at(-1));
    expect(client.store.state.values?.athletes).toBe(2);

    client.destroy();
  });

  test('the standard query a failed pre-aggregated update falls back to keeps its SQL', async () => {
    const db = await createAthletesDb();
    const $page = Selection.crossfilter();
    const source = { id: 'sport' };
    const client = createValuesClient<{ athletes: number }>({
      coordinator: db.coordinator,
      filterBy: $page,
      query: totals,
    });
    await waitFor(() => {
      expect(client.store.state.values?.athletes).toBe(6);
    });

    $page.update(clausePoint('sport', 'swim', { source }));
    await waitFor(() => {
      expect(client.store.state.values?.athletes).toBe(4);
    });
    expect(client.store.state.settled?.query).toBeNull();

    // Break the cached view: upstream retries the update with the client's
    // own query, whose response does carry the SQL it answers.
    const view = /"mosaic"\."preagg_[0-9a-f]+"/.exec(db.clientQueries.at(-1) ?? '')?.[0];
    expect(view).toBeDefined();
    await db.exec(`DROP TABLE ${view}`);
    $page.update(clausePoint('sport', 'run', { source }));
    await waitFor(() => {
      expect(client.store.state.values?.athletes).toBe(2);
    });
    expect(client.store.state.status).toBe('success');
    expect(db.clientQueries.at(-1)).not.toContain('preagg_');
    expect(client.store.state.settled?.query).toBe(db.clientQueries.at(-1));
    expect(client.store.state.settled?.query).toBe(client.store.state.lastQuery);

    client.destroy();
  });

  test('the standard query a reset submits while a view is cached keeps its SQL', async () => {
    const db = await createAthletesDb();
    const $page = Selection.crossfilter();
    const source = { id: 'sport' };
    const client = createValuesClient<{ athletes: number }>({
      coordinator: db.coordinator,
      filterBy: $page,
      query: totals,
    });
    await waitFor(() => {
      expect(client.store.state.values?.athletes).toBe(6);
    });

    $page.update(clausePoint('sport', 'swim', { source }));
    await waitFor(() => {
      expect(client.store.state.values?.athletes).toBe(4);
    });
    expect(db.clientQueries.at(-1)).toContain('preagg_');
    expect(client.store.state.settled?.query).toBeNull();

    // A reset leaves no active clause: upstream submits the client's own
    // query even though the cached pre-aggregation entry is still held.
    expect(db.coordinator.preaggregator.entries.size).toBeGreaterThan(0);
    $page.reset();
    await waitFor(() => {
      expect(client.store.state.values?.athletes).toBe(6);
    });
    expect(db.coordinator.preaggregator.entries.size).toBeGreaterThan(0);
    expect(client.store.state.status).toBe('success');
    expect(db.clientQueries.at(-1)).not.toContain('preagg_');
    expect(client.store.state.settled?.query).not.toBeNull();
    expect(client.store.state.settled?.query).toBe(db.clientQueries.at(-1));
    expect(client.store.state.settled?.query).toBe(client.store.state.lastQuery);

    client.destroy();
  });
});

describe('invalidate()', () => {
  test('re-queries with the latest factory, which setQuery alone never does', async () => {
    const db = await createAthletesDb();
    const client = createRowsClient<{ id: number }>({
      coordinator: db.coordinator,
      query: ({ where }) => Query.from('athletes').select('id').where(where),
      inputs: { orderBy: [{ column: 'id' }] },
    });
    await waitFor(() => {
      expect(client.store.state.rows).toHaveLength(6);
    });
    const queriesAfterInit = db.clientQueries.length;

    client.setQuery(({ where }) =>
      Query.from('athletes')
        .select('id')
        .where(eq('sport', literal('swim')), where),
    );
    await settle();
    expect(db.clientQueries.length).toBe(queriesAfterInit);

    client.invalidate();
    // Same-tick pending signal, like any coalesced trigger.
    expect(client.store.state.status).toBe('pending');
    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.rows).toHaveLength(4);
    });
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);
    expect(client.store.state.settled?.query).toBe(client.store.state.lastQuery);
    expect(client.store.state.lastQuery).toContain('swim');

    client.destroy();
  });

  test('coalesces with an inputs change in the same tick into one query', async () => {
    const db = await createAthletesDb();
    const client = createRowsClient<{ id: number }>({
      coordinator: db.coordinator,
      query: ({ where }) => Query.from('athletes').select('id').where(where),
      inputs: { orderBy: [{ column: 'id' }], limit: 10 },
    });
    await waitFor(() => {
      expect(client.store.state.rows).toHaveLength(6);
    });
    const queriesAfterInit = db.clientQueries.length;

    client.setQuery(({ where }) =>
      Query.from('athletes')
        .select('id')
        .where(eq('sport', literal('swim')), where),
    );
    client.setInputs({ limit: 2 });
    client.invalidate();
    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.rows).toHaveLength(2);
    });
    await settle();
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);
    expect(client.store.state.settled?.inputs).toEqual({
      orderBy: [{ column: 'id' }],
      limit: 2,
    });

    client.destroy();
  });

  test('coalesces with a Param change in the same tick into one query', async () => {
    const db = await createAthletesDb();
    const $min = Param.value(0);
    const client = createValuesClient<{ n: number }>({
      coordinator: db.coordinator,
      params: { min: $min },
      query: ({ where }) =>
        Query.from('athletes')
          .select({ n: literal(1) })
          .where(where)
          .limit(1),
    });
    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
    });
    const queriesAfterInit = db.clientQueries.length;

    $min.update(1);
    client.invalidate();
    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
    });
    await settle();
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);

    client.destroy();
  });

  test('keeps the rows COUNT memo when the count SQL is unchanged, unlike refetch()', async () => {
    const db = await createAthletesDb();
    const querySpy = vi.spyOn(db.coordinator, 'query');
    const countCalls = () =>
      querySpy.mock.calls.filter(([q]) => /__total_rows__/.test(String(q))).length;

    const client = createRowsClient<{ id: number }>({
      coordinator: db.coordinator,
      query: ({ where }) => Query.from('athletes').select('id').where(where),
      inputs: { orderBy: [{ column: 'id' }], limit: 2 },
      rowCount: 'query',
    });
    await waitFor(() => {
      expect(client.store.state.totalRows).toBe(6);
    });
    expect(countCalls()).toBe(1);
    const queriesAfterInit = db.clientQueries.length;

    client.invalidate();
    await waitFor(() => {
      expect(db.clientQueries.length).toBe(queriesAfterInit + 1);
      expect(client.store.state.status).toBe('success');
    });
    await settle();
    expect(countCalls()).toBe(1);

    // A recompiled query whose count differs re-counts on its own.
    client.setQuery(({ where }) =>
      Query.from('athletes')
        .select('id')
        .where(eq('sport', literal('swim')), where),
    );
    client.invalidate();
    await waitFor(() => {
      expect(client.store.state.totalRows).toBe(4);
    });
    expect(countCalls()).toBe(2);

    // refetch() is the data-changed escape hatch: it re-counts regardless.
    await client.refetch();
    await waitFor(() => {
      expect(countCalls()).toBe(3);
    });

    querySpy.mockRestore();
    client.destroy();
  });

  test('defers while disabled and runs once the client is enabled', async () => {
    const db = await createAthletesDb();
    const client = createRowsClient<{ id: number }>({
      coordinator: db.coordinator,
      query: ({ where }) => Query.from('athletes').select('id').where(where),
    });
    await waitFor(() => {
      expect(client.store.state.rows).toHaveLength(6);
    });
    client.setEnabled(false);
    const queriesWhileEnabled = db.clientQueries.length;

    client.setQuery(({ where }) =>
      Query.from('athletes')
        .select('id')
        .where(eq('sport', literal('swim')), where),
    );
    client.invalidate();
    await settle();
    expect(db.clientQueries.length).toBe(queriesWhileEnabled);
    // A disabled client is never marked pending (upstream defers the request).
    expect(client.store.state.status).toBe('success');

    client.setEnabled(true);
    await waitFor(() => {
      expect(client.store.state.rows).toHaveLength(4);
    });
    expect(db.clientQueries.length).toBe(queriesWhileEnabled + 1);

    client.destroy();
  });

  test('is a no-op on a destroyed client', async () => {
    const db = await createAthletesDb();
    const client = createRowsClient<{ id: number }>({
      coordinator: db.coordinator,
      query: ({ where }) => Query.from('athletes').select('id').where(where),
    });
    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
    });
    const queries = db.clientQueries.length;
    client.destroy();

    client.invalidate();
    await settle();
    expect(db.clientQueries.length).toBe(queries);
    expect(client.store.state.status).toBe('success');
  });
});
