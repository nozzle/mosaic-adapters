import { createAthletesDb, rowsToIPC, settle, waitFor } from '@nozzleio/test-support/duckdb';
/**
 * The client hands the coordinator a per-build copy of its main query whose
 * SQL is frozen at build time (so a live Param interpolated into it cannot
 * re-render a queued or in-flight request's SQL). These tests pin that the
 * copy stays a fully working query for the coordinator's optimizers —
 * pre-aggregation reads and deep-clones it, consolidation clones it — that
 * everything derived from it keeps the build-time Param values, and that the
 * consumer's own query object is never touched.
 */
import { Coordinator, Param, Selection, clausePoint } from '@uwdata/mosaic-core';
import type { ArrowQueryRequest, Connector, ExecQueryRequest } from '@uwdata/mosaic-core';
import { Query, column, count, deepClone, max, sql } from '@uwdata/mosaic-sql';
import type { Query as MosaicQuery } from '@uwdata/mosaic-sql';
import { describe, expect, test } from 'vitest';

import { createValuesClient } from '../src/index';

interface Totals extends Record<string, unknown> {
  athletes: number;
}

interface Deferred {
  sql: string;
  resolve: (rows: Array<Record<string, unknown>>) => void;
}

/** A connector that holds every request open until the test resolves it. */
function createControlledCoordinator(options: { consolidate: boolean }) {
  const requests: Array<Deferred> = [];
  const connector = {
    query(request: ArrowQueryRequest | ExecQueryRequest) {
      return new Promise<Uint8Array>((resolve) => {
        requests.push({ sql: request.sql, resolve: (rows) => resolve(rowsToIPC(rows)) });
      });
    },
  } as Connector;
  const coordinator = new Coordinator(connector, {
    logger: null,
    consolidate: options.consolidate,
    preagg: { enabled: false },
  });
  return { coordinator, requests };
}

describe('build-time SQL pinning', () => {
  test('pre-aggregation still answers selection updates for a query interpolating a live Param', async () => {
    const db = await createAthletesDb();
    const $page = Selection.crossfilter();
    const minWeight = new Param(0);
    const source = { id: 'sport' };
    const client = createValuesClient<Totals>({
      coordinator: db.coordinator,
      filterBy: $page,
      params: { minWeight },
      query: ({ where }) =>
        Query.from('athletes')
          .select({ athletes: count() })
          .where(where, sql`weight >= ${minWeight}`),
    });
    await waitFor(() => {
      expect(client.store.state.values?.athletes).toBe(6);
    });

    $page.update(clausePoint('sport', 'swim', { source }));
    await waitFor(() => {
      expect(client.store.state.values?.athletes).toBe(4);
    });
    // The optimizer built its materialized view from the pinned query and
    // answered from it.
    expect(db.connectorQueries.some((q) => q.includes('preagg_'))).toBe(true);

    $page.update(clausePoint('sport', 'run', { source }));
    await waitFor(() => {
      expect(client.store.state.values?.athletes).toBe(2);
    });

    // A Param change rebuilds the query; the next view reflects the new value.
    minWeight.update(65);
    await waitFor(() => {
      expect(client.store.state.values?.athletes).toBe(1);
    });
    $page.update(clausePoint('sport', 'swim', { source }));
    await waitFor(() => {
      expect(client.store.state.values?.athletes).toBe(3);
    });
    expect(client.store.state.status).toBe('success');

    client.destroy();
  });

  test('query consolidation still combines pinned queries into one valid request', async () => {
    const requests: Array<{
      sql: string;
      resolve: (rows: Array<Record<string, unknown>>) => void;
    }> = [];
    const connector = {
      query(request: ArrowQueryRequest | ExecQueryRequest) {
        return new Promise<Uint8Array>((resolve) => {
          requests.push({ sql: request.sql, resolve: (rows) => resolve(rowsToIPC(rows)) });
        });
      },
    } as Connector;
    const coordinator = new Coordinator(connector, {
      logger: null,
      consolidate: true,
      cache: false,
      preagg: { enabled: false },
    });
    const limit = new Param(5);
    const athletes = createValuesClient<Totals>({
      coordinator,
      params: { limit },
      query: () => Query.from('athletes').select({ athletes: sql`count(*) + ${limit}` }),
    });
    const heaviest = createValuesClient<{ heaviest: number }>({
      coordinator,
      query: () => Query.from('athletes').select({ heaviest: max('weight') }),
    });
    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    await settle(10);
    expect(requests).toHaveLength(1);

    // One consolidated request over the shared FROM — not an empty clone.
    const [request] = requests;
    expect(request!.sql).toContain('FROM "athletes"');
    expect(request!.sql).toContain('count(*) + 5');
    expect(request!.sql).toContain('max("weight")');

    request!.resolve([{ col0: 11, col1: 90 }]);
    await waitFor(() => {
      expect(athletes.store.state.values).toEqual({ athletes: 11 });
      expect(heaviest.store.state.values).toEqual({ heaviest: 90 });
    });

    athletes.destroy();
    heaviest.destroy();
  });

  test('a consolidated request queued behind other work keeps the build-time Param value, and so does its cached result', async () => {
    // Consolidation and the client-side cache are on, as by default.
    const { coordinator, requests } = createControlledCoordinator({ consolidate: true });
    // An open exec blocks the query manager's queue, so the consolidated
    // request is only rendered for sending after the Param changed.
    void coordinator.exec('SELECT 1');
    expect(requests).toHaveLength(1);
    const limit = new Param(5);
    const athletes = createValuesClient<Totals>({
      coordinator,
      params: { limit },
      query: () => Query.from('athletes').select({ athletes: sql`count(*) + ${limit}` }),
    });
    const heaviest = createValuesClient<{ heaviest: number }>({
      coordinator,
      query: () => Query.from('athletes').select({ heaviest: max('weight') }),
    });
    // Let the consolidator merge both builds and queue the merged request.
    await settle(10);
    expect(requests).toHaveLength(1);

    limit.update(10);
    await settle(10);
    expect(requests).toHaveLength(1);

    requests[0]!.resolve([]);
    await waitFor(() => {
      expect(requests).toHaveLength(2);
    });
    const merged = requests[1]!;
    expect(merged.sql).toContain('FROM "athletes"');
    expect(merged.sql).toContain('count(*) + 5');
    expect(merged.sql).not.toContain('count(*) + 10');
    expect(merged.sql).toContain('max("weight")');

    merged.resolve([{ col0: 11, col1: 90 }]);
    await waitFor(() => {
      expect(requests).toHaveLength(3);
    });
    expect(requests[2]!.sql).toContain('count(*) + 10');
    requests[2]!.resolve([{ athletes: 16 }]);
    await waitFor(() => {
      expect(athletes.store.state.values).toEqual({ athletes: 16 });
      expect(heaviest.store.state.values).toEqual({ heaviest: 90 });
    });
    expect(athletes.store.state.status).toBe('success');

    // Back to the first value: the merged result was cached under the
    // build-time `+ 5` SQL it was computed from, so the cache answers with
    // the matching value rather than one computed for `+ 10`.
    limit.update(5);
    await waitFor(() => {
      expect(athletes.store.state.values).toEqual({ athletes: 11 });
    });
    expect(requests).toHaveLength(3);
    expect(athletes.store.state.lastQuery).toContain('count(*) + 5');

    athletes.destroy();
    heaviest.destroy();
  });

  test('queries derived from the handed-over query keep the build-time Param values', async () => {
    const { coordinator, requests } = createControlledCoordinator({ consolidate: false });
    const handed: Array<MosaicQuery | string> = [];
    const query = coordinator.query.bind(coordinator);
    coordinator.query = (q, options) => {
      handed.push(q as MosaicQuery | string);
      return query(q, options);
    };
    const offset = new Param(1);
    const pageSize = new Param(10);
    const field = new Param('weight');
    const client = createValuesClient<Totals>({
      coordinator,
      params: { offset, pageSize, field },
      query: () =>
        Query.from('athletes')
          .select({ athletes: sql`count(*) + ${offset}`, heaviest: max(column(field)) })
          // `.limit()` is typed for numbers and nodes; a fragment carries
          // the Param into `_limit`, a field upstream's AST walk skips.
          .limit(sql`${pageSize}`),
    });
    await settle(0);
    expect(requests).toHaveLength(1);
    expect(handed).toHaveLength(1);
    const first = handed[0]!;
    expect(typeof first).not.toBe('string');
    const built = String(first);
    expect(built).toContain('count(*) + 1');
    expect(built).toContain('max("weight")');
    expect(built).toContain('LIMIT 10');

    offset.update(2);
    pageSize.update(20);
    field.update('height');
    await settle(0);

    // The handed-over query, its clone and a deep clone — what the
    // consolidator and the pre-aggregator start from — all still render the
    // build-time values, even for a Param under `_limit` (which upstream's
    // AST traversal tables skip) and a dynamic column name.
    const pinned = first as MosaicQuery;
    expect(String(pinned)).toBe(built);
    expect(String(pinned.clone())).toBe(built);
    expect(String(deepClone(pinned))).toBe(built);
    expect(pinned).toBeInstanceOf(Query);

    // The rebuilt query carries the new values.
    const latest = String(handed.at(-1));
    expect(latest).toContain('count(*) + 2');
    expect(latest).toContain('max("height")');
    expect(latest).toContain('LIMIT 20');

    client.destroy();
  });

  test("the consumer's query object is not mutated and keeps rendering live", async () => {
    const db = await createAthletesDb();
    const minWeight = new Param(0);
    // A factory may hand back the same (cached) query object every build.
    const shared = Query.from('athletes')
      .select({ athletes: count() })
      .where(sql`weight >= ${minWeight}`);
    const client = createValuesClient<Totals>({
      coordinator: db.coordinator,
      params: { minWeight },
      query: () => shared,
    });
    await waitFor(() => {
      expect(client.store.state.values?.athletes).toBe(6);
    });
    expect(Object.prototype.hasOwnProperty.call(shared, 'toString')).toBe(false);

    minWeight.update(80);
    await waitFor(() => {
      expect(client.store.state.values?.athletes).toBe(2);
    });
    expect(String(shared)).toContain('weight >= 80');
    expect(client.store.state.lastQuery).toBe(String(shared));
    // Every query reached the coordinator with the SQL recorded at build time.
    expect(db.clientQueries.at(-1)).toBe(client.store.state.lastQuery);

    client.destroy();
  });
});
