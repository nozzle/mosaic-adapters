/**
 * Debugging aids: client `meta` (and its mirror on the MosaicClient),
 * `previewQuery()`, and the development-only warning for a query factory that
 * ignores an active filter. A controllable connector holds each query open so
 * "nothing was issued" is observable exactly.
 */
import { rowsToIPC, settle } from '@nozzleio/test-support/duckdb';
import { Coordinator, Selection, clausePoint, makeClient } from '@uwdata/mosaic-core';
import type { ArrowQueryRequest, Connector, ExecQueryRequest } from '@uwdata/mosaic-core';
import { Query, column, count, gt, literal } from '@uwdata/mosaic-sql';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  MOSAIC_CLIENT_META,
  createHistogramClient,
  createRowsClient,
  createSparklineClient,
  createValuesClient,
  getClientMeta,
} from '../src/index';
import type { DataClientMeta, QuerySource, RowsInputs, ValuesInputs } from '../src/index';

interface Deferred {
  sql: string;
  resolve: (rows: Array<Record<string, unknown>>) => void;
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
      return new Promise<Uint8Array>((resolve) => {
        requests.push({
          sql: request.sql,
          resolve: (rows) => resolve(rowsToIPC(rows)),
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

/** A Selection already carrying an active clause from a foreign source. */
function activeSelection(): Selection {
  const selection = Selection.intersect();
  selection.update(clausePoint('sport', 'swimming', { source: {} }));
  return selection;
}

const ignoresFilters: QuerySource<ValuesInputs> = () => Query.from('t').select({ n: count() });
const appliesWhere: QuerySource<ValuesInputs> = (ctx) =>
  Query.from('t').select({ n: count() }).where(ctx.where);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('meta', () => {
  test('is exposed as client.meta and replaced by setMeta without re-querying', async () => {
    const db = createControlledDb();
    const meta: DataClientMeta = { widget: 'kpi-total' };
    const client = createValuesClient({
      coordinator: db.coordinator,
      query: appliesWhere,
      meta,
    });
    await settle(0);
    expect(db.requests).toHaveLength(1);
    expect(client.meta).toBe(meta);

    const next: DataClientMeta = { widget: 'kpi-total', route: '/overview' };
    client.setMeta(next);
    await settle(0);
    expect(client.meta).toBe(next);
    expect(db.requests).toHaveLength(1);

    client.setMeta(undefined);
    expect(client.meta).toBeUndefined();
    client.destroy();
  });

  test('is mirrored onto the MosaicClient under a registered symbol, always latest', () => {
    const db = createControlledDb();
    const client = createValuesClient({
      coordinator: db.coordinator,
      query: appliesWhere,
      meta: { widget: 'a' },
      enabled: false,
    });
    expect(MOSAIC_CLIENT_META).toBe(Symbol.for('@nozzleio/mosaic-core/client-meta'));
    expect(getClientMeta(client.mosaicClient)).toEqual({ widget: 'a' });
    client.setMeta({ widget: 'b' });
    expect(getClientMeta(client.mosaicClient)).toEqual({ widget: 'b' });
    expect((client.mosaicClient as unknown as Record<symbol, unknown>)[MOSAIC_CLIENT_META]).toEqual(
      { widget: 'b' },
    );
    // Non-enumerable: invisible to spreads and key listings of the client.
    expect(Object.keys(client.mosaicClient)).not.toContain(MOSAIC_CLIENT_META);
    client.destroy();
  });

  test('getClientMeta is undefined for foreign, meta-less and missing clients', () => {
    const db = createControlledDb();
    const foreign = makeClient({
      coordinator: db.coordinator,
      query: () => null,
      enabled: false,
    });
    expect(getClientMeta(foreign)).toBeUndefined();
    expect(getClientMeta(null)).toBeUndefined();
    expect(getClientMeta(undefined)).toBeUndefined();

    const client = createValuesClient({
      coordinator: db.coordinator,
      query: appliesWhere,
      enabled: false,
    });
    expect(client.meta).toBeUndefined();
    expect(getClientMeta(client.mosaicClient)).toBeUndefined();
    client.destroy();
    foreign.destroy();
  });

  test('lets a coordinator-level observer attribute each query to its client', async () => {
    const db = createControlledDb();
    const attributed: Array<unknown> = [];
    const updateClient = db.coordinator.updateClient.bind(db.coordinator);
    db.coordinator.updateClient = (mosaicClient, query, priority) => {
      attributed.push(getClientMeta(mosaicClient)?.widget);
      return updateClient(mosaicClient, query, priority);
    };
    const a = createValuesClient({
      coordinator: db.coordinator,
      query: appliesWhere,
      meta: { widget: 'a' },
    });
    const b = createValuesClient({
      coordinator: db.coordinator,
      query: appliesWhere,
      meta: { widget: 'b' },
    });
    await settle(0);
    expect(attributed).toEqual(['a', 'b']);

    b.setMeta({ widget: 'b2' });
    void b.refetch();
    await settle(0);
    expect(attributed).toEqual(['a', 'b', 'b2']);
    a.destroy();
    b.destroy();
  });
});

describe('previewQuery', () => {
  const rowsFrom: QuerySource<RowsInputs> = ({ where }) =>
    Query.from('t').select('id', 'sport').where(where);

  test('returns the main and COUNT SQL the rows client issues, without issuing anything', async () => {
    const db = createControlledDb();
    const client = createRowsClient<{ id: number }>({
      coordinator: db.coordinator,
      query: rowsFrom,
      filterBy: activeSelection(),
      rowCount: 'query',
      inputs: { limit: 10 },
    });
    await settle(0);
    // Main query plus its COUNT side channel.
    expect(db.requests).toHaveLength(2);
    const before = client.store.state;

    const preview = client.previewQuery();
    await settle(0);
    expect(preview.main).toBe(before.lastQuery);
    // `afterQueryBuilt` issues the COUNT before the coordinator submits the main query.
    expect(db.requests.map((request) => request.sql)).toEqual([preview.count, preview.main]);
    expect(preview.count).toContain('count(*)');
    expect(preview.count).toContain('swimming');
    // Nothing issued, nothing written.
    expect(db.requests).toHaveLength(2);
    expect(client.store.state).toBe(before);
    client.destroy();
  });

  test('applies where/having/inputs overrides without changing the client', async () => {
    const db = createControlledDb();
    const client = createRowsClient<{ id: number }>({
      coordinator: db.coordinator,
      query: ({ where, having }) =>
        Query.from('t').select('sport').groupby('sport').where(where).having(having),
      filterBy: activeSelection(),
      filterStable: false,
      inputs: { limit: 10 },
    });
    await settle(0);
    expect(db.requests).toHaveLength(1);

    const preview = client.previewQuery({
      where: [gt(column('id'), literal(5))],
      having: [gt(count(), literal(1))],
      inputs: { offset: 20 },
    });
    expect(preview.main).not.toContain('swimming');
    expect(preview.main).toContain('"id" > 5');
    expect(preview.main).toContain('HAVING');
    expect(preview.main).toContain('LIMIT 10');
    expect(preview.main).toContain('OFFSET 20');
    expect(preview.count).toBeNull();

    // Unfiltered preview, no inputs patch.
    expect(client.previewQuery({ where: [] }).main).not.toContain('WHERE');

    expect(client.store.state.inputs).toEqual({ limit: 10 });
    expect(db.requests).toHaveLength(1);
    client.destroy();
  });

  test('has no COUNT query outside rowCount: query', () => {
    const db = createControlledDb();
    const window = createRowsClient({
      coordinator: db.coordinator,
      query: rowsFrom,
      rowCount: 'window',
      enabled: false,
    });
    const preview = window.previewQuery();
    expect(preview.main).toContain('count(*) OVER ()');
    expect(preview.count).toBeNull();
    window.destroy();
  });

  test('reports a null main query for an empty round', () => {
    const db = createControlledDb();
    const client = createSparklineClient({
      coordinator: db.coordinator,
      from: 't',
      key: 'sport',
      x: { column: 'year' },
      y: { agg: 'count' },
      enabled: false,
    });
    expect(client.previewQuery()).toEqual({ main: null, count: null });
    expect(client.previewQuery({ inputs: { keys: ['swimming'] } }).main).toContain('swimming');
    expect(client.store.state.inputs).toEqual({});
    client.destroy();
  });

  test('does not replace the histogram bin spec used to read the pending result', async () => {
    const db = createControlledDb();
    const client = createHistogramClient({
      coordinator: db.coordinator,
      from: 't',
      column: 'height',
      extent: [0, 10],
      inputs: { bins: 10 },
    });
    await settle(0);
    expect(db.requests).toHaveLength(1);

    const preview = client.previewQuery({ inputs: { bins: 2 } });
    expect(preview.main).not.toBe(db.requests[0]!.sql);

    db.requests[0]!.resolve([{ x0: 0, count: 3 }]);
    await settle(0);
    expect(client.store.state.status).toBe('success');
    expect(client.store.state.bins).toHaveLength(10);
    client.destroy();
  });

  test('never emits build-time diagnostics', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = createControlledDb();
    const grouped = createRowsClient({
      coordinator: db.coordinator,
      // GROUP BY with filterStable left at its default, and filters ignored.
      query: () => Query.from('t').select('sport').groupby('sport'),
      filterBy: activeSelection(),
      enabled: false,
    });
    grouped.previewQuery();
    expect(warn).not.toHaveBeenCalled();
    grouped.destroy();
  });
});

describe('ignored-filter warning (development only)', () => {
  function warnings(warn: { mock: { calls: Array<Array<unknown>> } }): Array<string> {
    return warn.mock.calls
      .map((call) => String(call[0]))
      .filter((message) => message.includes('never read'));
  }

  test('warns once per client when the factory never reads an active WHERE', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = createControlledDb();
    const client = createValuesClient({
      coordinator: db.coordinator,
      query: ignoresFilters,
      filterBy: activeSelection(),
    });
    await settle(0);
    for (let round = 0; round < 2; round += 1) {
      db.requests.at(-1)!.resolve([{ n: 1 }]);
      await settle(0);
      void client.refetch();
      await settle(0);
    }
    expect(db.requests).toHaveLength(3);
    const messages = warnings(warn);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('`ctx.where`');
    expect(messages[0]).not.toContain('`ctx.having`');
    client.destroy();
  });

  test('warns for an ignored active HAVING', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = createControlledDb();
    const havingBy = Selection.intersect();
    havingBy.update({
      source: {},
      value: 1,
      fields: [],
      predicate: gt(count(), literal(1)),
    });
    const client = createValuesClient({
      coordinator: db.coordinator,
      query: appliesWhere,
      havingBy,
    });
    await settle(0);
    const messages = warnings(warn);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('`ctx.having`');
    expect(messages[0]).not.toContain('`ctx.where`');
    client.destroy();
  });

  test('passes meta along to identify the client', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = createControlledDb();
    const client = createValuesClient({
      coordinator: db.coordinator,
      query: ignoresFilters,
      filterBy: activeSelection(),
      meta: { widget: 'kpi' },
    });
    await settle(0);
    const call = warn.mock.calls.find((args) => String(args[0]).includes('never read'));
    expect(call?.[1]).toEqual({ meta: { widget: 'kpi' } });
    client.destroy();
  });

  test('stays silent when the predicates are read, empty, self-excluded or from a table source', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = createControlledDb();

    // Read: applied, or acknowledged with `void ctx.where`.
    const applied = createValuesClient({
      coordinator: db.coordinator,
      query: appliesWhere,
      filterBy: activeSelection(),
    });
    const acknowledged = createValuesClient({
      coordinator: db.coordinator,
      query: (ctx) => {
        void ctx.where;
        return Query.from('t').select({ n: count() });
      },
      filterBy: activeSelection(),
    });
    // Destructuring reads both sides.
    const destructured = createValuesClient({
      coordinator: db.coordinator,
      query: ({ where: _where, having: _having }) => Query.from('t').select({ n: count() }),
      filterBy: activeSelection(),
    });
    // Empty: no clause, so nothing is ignored.
    const unfiltered = createValuesClient({
      coordinator: db.coordinator,
      query: ignoresFilters,
      filterBy: Selection.intersect(),
    });
    // Self-excluded: the only clause is this client's own.
    const crossfilter = Selection.crossfilter();
    const own = createValuesClient({
      coordinator: db.coordinator,
      query: ignoresFilters,
      filterBy: crossfilter,
    });
    crossfilter.update(
      clausePoint('sport', 'swimming', { source: {}, clients: new Set([own.mosaicClient]) }),
    );
    // Table source: the client applies both predicates itself.
    const table = createValuesClient({
      coordinator: db.coordinator,
      query: 't',
      filterBy: activeSelection(),
    });
    await settle(0);
    void own.refetch();
    await settle(0);
    expect(warnings(warn)).toEqual([]);
    for (const client of [applied, acknowledged, destructured, unfiltered, own, table]) {
      client.destroy();
    }
  });

  test('checks the main build only, not the rows COUNT query', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = createControlledDb();
    const client = createRowsClient({
      coordinator: db.coordinator,
      // The COUNT path spreads the context; the main build must still warn.
      query: () => Query.from('t').select('id'),
      filterBy: activeSelection(),
      filterStable: false,
      rowCount: 'query',
    });
    await settle(0);
    expect(warnings(warn)).toHaveLength(1);
    client.destroy();
  });

  test.each([
    ['production', 'production'],
    ['unset', undefined],
  ])('never runs outside development (NODE_ENV %s)', async (_label, env) => {
    vi.stubEnv('NODE_ENV', env);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = createControlledDb();
    const client = createValuesClient({
      coordinator: db.coordinator,
      query: ignoresFilters,
      filterBy: activeSelection(),
    });
    await settle(0);
    expect(db.requests).toHaveLength(1);
    expect(warnings(warn)).toEqual([]);
    client.destroy();
  });
});
