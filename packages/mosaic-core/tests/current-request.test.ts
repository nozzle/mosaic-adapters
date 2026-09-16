/**
 * The current-request guarantee: only the response to the most recent
 * main-query request writes to the store. A controllable connector holds
 * each query open so response order and supersession can be driven exactly.
 */
import {
  Coordinator,
  Param,
  QueryError,
  Selection,
  clausePoint,
} from '@uwdata/mosaic-core';
import { Query, eq, literal } from '@uwdata/mosaic-sql';
import { describe, expect, test } from 'vitest';

import { settle } from '@nozzleio/test-support/duckdb';
import { createSparklineClient, createValuesClient } from '../src/index';
import type {
  ArrowQueryRequest,
  Connector,
  ExecQueryRequest,
  JSONQueryRequest,
} from '@uwdata/mosaic-core';
import type { FilterExpr } from '@uwdata/mosaic-sql';
import type { DataClientStatus, ValuesClient } from '../src/index';

interface Deferred {
  sql: string;
  resolve: (rows: Array<Record<string, unknown>>) => void;
  reject: (error: Error) => void;
}

interface ControlledDb {
  coordinator: Coordinator;
  /** Every request that reached the connector, in submission order. */
  requests: Array<Deferred>;
  /** Most recent request whose SQL contains `needle`. */
  find: (needle: string) => Deferred;
}

function createControlledDb(): ControlledDb {
  const requests: Array<Deferred> = [];
  const connector = {
    query(request: ArrowQueryRequest | ExecQueryRequest | JSONQueryRequest) {
      return new Promise((resolve, reject) => {
        requests.push({ sql: request.sql, resolve, reject });
      });
    },
  } as Connector;
  const coordinator = new Coordinator(connector, {
    logger: null,
    consolidate: false,
    cache: false,
    preagg: { enabled: false },
  });
  return {
    coordinator,
    requests,
    find: (needle) => {
      const match = [...requests].reverse().find((r) => r.sql.includes(needle));
      if (!match) {
        throw new Error(`no request matching ${needle}`);
      }
      return match;
    },
  };
}

interface Totals extends Record<string, unknown> {
  total: number;
}

interface Snapshot {
  status: DataClientStatus;
  total: number | undefined;
}

/** Record every distinct store transition for order-sensitive assertions. */
function recordTransitions(client: ValuesClient<Totals>): Array<Snapshot> {
  const log: Array<Snapshot> = [];
  const push = () => {
    const { status, values } = client.store.state;
    const total = values?.total;
    const last = log[log.length - 1];
    if (last && last.status === status && last.total === total) {
      return;
    }
    log.push({ status, total });
  };
  push();
  client.store.subscribe(push);
  return log;
}

function totalsQuery(where: FilterExpr) {
  return Query.from('t')
    .select({ total: literal(1) })
    .where(where);
}

const swimClause = () => clausePoint('sport', 'swim', { source: {} });

describe('current-request guarantee', () => {
  test('an older selection response arriving first is dropped; the store stays pending until the newest answers', async () => {
    const db = createControlledDb();
    const filterBy = Selection.intersect();
    const client = createValuesClient<Totals>({
      coordinator: db.coordinator,
      filterBy,
      query: ({ where }) => totalsQuery(where),
    });
    const log = recordTransitions(client);
    await settle(0);
    expect(db.requests).toHaveLength(1);

    filterBy.update(swimClause());
    await settle(0);
    expect(db.requests).toHaveLength(2);
    expect(client.store.state.status).toBe('pending');

    // Old response (FIFO: request 0 is the unfiltered one) lands first.
    db.requests[0]!.resolve([{ total: 6 }]);
    await settle(0);
    expect(client.store.state.status).toBe('pending');
    expect(client.store.state.values).toBeUndefined();

    db.requests[1]!.resolve([{ total: 4 }]);
    await settle(0);
    expect(client.store.state.status).toBe('success');
    expect(client.store.state.values).toEqual({ total: 4 });
    // The stale total never reached the store.
    expect(log.some((s) => s.total === 6)).toBe(false);

    client.destroy();
  });

  test('a newer response that the connector answers first still wins; the older one never shows', async () => {
    const db = createControlledDb();
    const filterBy = Selection.intersect();
    const client = createValuesClient<Totals>({
      coordinator: db.coordinator,
      filterBy,
      query: ({ where }) => totalsQuery(where),
    });
    const log = recordTransitions(client);
    await settle(0);

    filterBy.update(swimClause());
    await settle(0);
    expect(db.requests).toHaveLength(2);

    // The coordinator holds the newer result until the older settles, so the
    // client sees old then new — and must still only publish new.
    db.requests[1]!.resolve([{ total: 4 }]);
    await settle(0);
    expect(client.store.state.status).toBe('pending');

    db.requests[0]!.resolve([{ total: 6 }]);
    await settle(0);
    expect(client.store.state.status).toBe('success');
    expect(client.store.state.values).toEqual({ total: 4 });
    expect(log.some((s) => s.total === 6)).toBe(false);

    client.destroy();
  });

  test('a superseded request that fails does not surface its error', async () => {
    const db = createControlledDb();
    const filterBy = Selection.intersect();
    const client = createValuesClient<Totals>({
      coordinator: db.coordinator,
      filterBy,
      query: ({ where }) => totalsQuery(where),
    });
    await settle(0);

    filterBy.update(swimClause());
    await settle(0);
    expect(db.requests).toHaveLength(2);

    db.requests[0]!.reject(new Error('boom'));
    await settle(0);
    expect(client.store.state.status).toBe('pending');
    expect(client.store.state.error).toBeNull();

    db.requests[1]!.resolve([{ total: 4 }]);
    await settle(0);
    expect(client.store.state.status).toBe('success');
    expect(client.store.state.values).toEqual({ total: 4 });

    client.destroy();
  });

  test('the newest request failing surfaces immediately, and the older late success is dropped', async () => {
    const db = createControlledDb();
    const filterBy = Selection.intersect();
    const client = createValuesClient<Totals>({
      coordinator: db.coordinator,
      filterBy,
      query: ({ where }) => totalsQuery(where),
    });
    await settle(0);

    filterBy.update(swimClause());
    await settle(0);
    expect(db.requests).toHaveLength(2);

    // Errors reject out of order: the newer request fails while the older is
    // still open. It is matched by SQL, not FIFO position.
    db.find('swim').reject(new Error('boom'));
    await settle(0);
    expect(client.store.state.status).toBe('error');
    expect(client.store.state.error).toBeInstanceOf(QueryError);

    db.requests[0]!.resolve([{ total: 6 }]);
    await settle(0);
    expect(client.store.state.status).toBe('error');
    expect(client.store.state.values).toBeUndefined();

    client.destroy();
  });

  test('a Param change supersedes an in-flight request before its coalesced query is issued', async () => {
    const db = createControlledDb();
    const limit = new Param(1);
    const client = createValuesClient<Totals>({
      coordinator: db.coordinator,
      params: { limit },
      query: () =>
        Query.from('t')
          .select({ total: literal(1) })
          .where(eq('n', literal(limit.value))),
    });
    const log = recordTransitions(client);
    await settle(0);
    expect(db.requests).toHaveLength(1);

    // Synchronously after the Param change the flush has not fired yet, but
    // the store already waits on the coming request: the old response, which
    // lands (microtasks) before the flush (macrotask), must not show.
    limit.update(2);
    expect(client.store.state.status).toBe('pending');
    db.requests[0]!.resolve([{ total: 1 }]);
    await settle(0);
    expect(db.requests).toHaveLength(2);
    expect(client.store.state.status).toBe('pending');
    expect(log.some((s) => s.status === 'success')).toBe(false);

    db.requests[1]!.resolve([{ total: 2 }]);
    await settle(0);
    expect(client.store.state.status).toBe('success');
    expect(client.store.state.values).toEqual({ total: 2 });

    client.destroy();
  });

  test('refetch() supersedes the in-flight request', async () => {
    const db = createControlledDb();
    const client = createValuesClient<Totals>({
      coordinator: db.coordinator,
      query: () => Query.from('t').select({ total: literal(1) }),
    });
    await settle(0);
    expect(db.requests).toHaveLength(1);

    const refetch = client.refetch();
    await settle(0);
    expect(db.requests).toHaveLength(2);

    db.requests[0]!.resolve([{ total: 1 }]);
    await settle(0);
    expect(client.store.state.status).toBe('pending');

    db.requests[1]!.resolve([{ total: 2 }]);
    await refetch;
    expect(client.store.state.status).toBe('success');
    expect(client.store.state.values).toEqual({ total: 2 });

    client.destroy();
  });

  test('an empty round (buildQuery → null) is final; a late result for the prior request is dropped', async () => {
    const db = createControlledDb();
    const client = createSparklineClient({
      coordinator: db.coordinator,
      from: 't',
      key: 'k',
      x: { column: 'x' },
      y: { agg: 'count' },
      inputs: { keys: [1] },
    });
    await settle(0);
    expect(db.requests).toHaveLength(1);

    client.setInputs({ keys: [] });
    await settle(0);
    expect(db.requests).toHaveLength(1);
    expect(client.store.state.status).toBe('success');
    expect(client.store.state.series.size).toBe(0);

    db.requests[0]!.resolve([{ __key__: 1, __x__: 1, __y__: 3 }]);
    await settle(0);
    expect(client.store.state.series.size).toBe(0);
    expect(client.store.state.lastQuery).toBeNull();

    client.destroy();
  });

  test('a lone unsuperseded request still lands', async () => {
    const db = createControlledDb();
    const client = createValuesClient<Totals>({
      coordinator: db.coordinator,
      query: () => Query.from('t').select({ total: literal(1) }),
    });
    await settle(0);
    db.requests[0]!.resolve([{ total: 1 }]);
    await settle(0);
    expect(client.store.state.status).toBe('success');
    expect(client.store.state.values).toEqual({ total: 1 });
    client.destroy();
  });
});
