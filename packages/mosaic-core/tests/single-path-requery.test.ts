/**
 * A `filterBy` change and a Param change made in the same tick issue one
 * query for clients that cannot pre-aggregate (`filterStable: false` or a
 * non-empty `skipSources`): `filterBy` re-queries through the client's own
 * coalesced batch instead of upstream `Coordinator.updateSelection`, which
 * queries at once and leaves the Param to a second query a beat later.
 * Clients that can pre-aggregate, and clients that opt out with
 * `coalesceFilterBy: false`, keep the upstream path unchanged.
 *
 * A controllable connector counts every request that reaches it; caching
 * and consolidation are off (unless a case opts the cache back in) so
 * identical SQL is not merged away.
 */
import { rowsToIPC, settle } from '@nozzleio/test-support/duckdb';
import { Coordinator, Param, Selection, clausePoint } from '@uwdata/mosaic-core';
import type {
  ArrowQueryRequest,
  ClauseSource,
  Connector,
  ExecQueryRequest,
  SelectionClause,
} from '@uwdata/mosaic-core';
import { Query, count, gte, sql } from '@uwdata/mosaic-sql';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { createValuesClient } from '../src/index';
import type { ValuesClient, ValuesClientOptions } from '../src/index';

interface Deferred {
  sql: string;
  resolve: () => void;
}

interface CountingDb {
  coordinator: Coordinator;
  /** SQL of every request that reached the connector, in submission order. */
  requests: Array<string>;
  /** Requests held open (only when `hold` is set). */
  held: Array<Deferred>;
  /** Hold every later request open until resolved through `held`. */
  hold: () => void;
}

function createCountingDb({
  preagg = false,
  cache = false,
}: { preagg?: boolean; cache?: boolean } = {}): CountingDb {
  const requests: Array<string> = [];
  const held: Array<Deferred> = [];
  let holding = false;
  const connector = {
    query(request: ArrowQueryRequest | ExecQueryRequest) {
      requests.push(request.sql);
      const bytes = rowsToIPC([{ n: 1 }]);
      if (!holding) {
        return Promise.resolve(bytes);
      }
      return new Promise<Uint8Array>((resolve) => {
        held.push({ sql: request.sql, resolve: () => resolve(bytes) });
      });
    },
  } as Connector;
  const coordinator = new Coordinator(connector, {
    logger: null,
    consolidate: false,
    cache,
    preagg: { enabled: preagg },
  });
  return {
    coordinator,
    requests,
    held,
    hold: () => {
      holding = true;
    },
  };
}

function source(id: string): ClauseSource {
  return { id } as ClauseSource;
}

const brush = source('brush');

/** A `weight >= $min` threshold from the brush source. */
function weightClause(min: number): SelectionClause {
  return {
    source: brush,
    value: min,
    fields: [],
    predicate: gte('weight', min),
  };
}

interface Harness {
  db: CountingDb;
  filterBy: Selection;
  $from: Param<string>;
  client: ValuesClient<{ n: number }>;
}

/**
 * A values client counting rows of `t` filtered by `filterBy`, with a
 * `$from` Param interpolated into the query (the "range filter + `$from`"
 * shape from a single dashboard action).
 */
async function createReady(
  options: Partial<ValuesClientOptions> = {},
  db: CountingDb = createCountingDb(),
  filterBy: Selection = Selection.crossfilter(),
): Promise<Harness> {
  const $from = Param.value('2024-01-01');
  const client = createValuesClient<{ n: number }>({
    coordinator: db.coordinator,
    filterBy,
    params: { from: $from },
    query: ({ where }) =>
      Query.from('t')
        .select({ n: count() })
        .where(where, sql`"day" >= ${$from}`),
    ...options,
  });
  await settle(0);
  expect(client.store.state.status).toBe('success');
  return { db, filterBy, $from, client };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('filterBy + Param in one tick, pre-aggregation off', () => {
  test('Params first, then the clause: one request carrying both', async () => {
    const { db, filterBy, $from, client } = await createReady({ filterStable: false });
    const before = db.requests.length;

    $from.update('2024-02-01');
    filterBy.update(weightClause(70));
    await settle(0);

    expect(db.requests.length).toBe(before + 1);
    const issued = db.requests.at(-1)!;
    expect(issued).toContain('2024-02-01');
    expect(issued).toContain('70');
    expect(client.store.state.status).toBe('success');
    expect(client.store.state.settled?.query).toBe(issued);

    client.destroy();
  });

  test('the clause first, then the Params: still one request carrying both', async () => {
    const { db, filterBy, $from, client } = await createReady({ filterStable: false });
    const before = db.requests.length;

    filterBy.update(weightClause(70));
    $from.update('2024-02-01');
    await settle(0);

    expect(db.requests.length).toBe(before + 1);
    const issued = db.requests.at(-1)!;
    expect(issued).toContain('2024-02-01');
    expect(issued).toContain('70');
    expect(client.store.state.settled?.query).toBe(issued);

    client.destroy();
  });

  test('flips the store to pending synchronously on the clause change', async () => {
    const { db, filterBy, client } = await createReady({ filterStable: false });
    const before = db.requests.length;

    filterBy.update(weightClause(70));
    expect(client.store.state.status).toBe('pending');
    await settle(0);

    expect(db.requests.length).toBe(before + 1);
    expect(client.store.state.status).toBe('success');

    client.destroy();
  });

  test('a non-empty skipSources (pre-aggregation forced off) coalesces too', async () => {
    const { db, filterBy, $from, client } = await createReady({
      skipSources: new Set(['other']),
    });
    const before = db.requests.length;

    filterBy.update(weightClause(70));
    $from.update('2024-02-01');
    await settle(0);

    expect(db.requests.length).toBe(before + 1);
    expect(db.requests.at(-1)).toContain('70');
    expect(db.requests.at(-1)).toContain('2024-02-01');

    client.destroy();
  });

  test('the client stays out of the coordinator filter groups but reports its filterBy', async () => {
    const { db, filterBy, client } = await createReady({ filterStable: false });

    expect(db.coordinator.filterGroups.has(filterBy)).toBe(false);
    expect(client.mosaicClient.filterBy).toBe(filterBy);

    client.destroy();
  });

  test('a change to its own cross-filtered clause does not re-query it', async () => {
    const { db, filterBy, client } = await createReady({ filterStable: false });
    const before = db.requests.length;

    filterBy.update({
      ...weightClause(70),
      clients: new Set([client.mosaicClient]),
    });
    await settle(0);

    expect(db.requests.length).toBe(before);
    expect(client.store.state.status).toBe('success');

    // A foreign clause still re-queries, and keeps excluding the own clause.
    filterBy.update(clausePoint('sport', 'swim', { source: source('sport') }));
    await settle(0);
    expect(db.requests.length).toBe(before + 1);
    expect(db.requests.at(-1)).toContain('swim');
    expect(db.requests.at(-1)).not.toContain('70');

    client.destroy();
  });

  test('a clause change while disabled runs once on re-enable', async () => {
    const { db, filterBy, client } = await createReady({ filterStable: false });
    client.setEnabled(false);
    const before = db.requests.length;

    filterBy.update(weightClause(70));
    await settle(0);
    expect(db.requests.length).toBe(before);

    client.setEnabled(true);
    await settle(0);
    expect(db.requests.length).toBe(before + 1);
    expect(db.requests.at(-1)).toContain('70');
    expect(client.store.state.status).toBe('success');

    client.destroy();
  });

  test('a clause change while initializing is answered by the initial query alone', async () => {
    const db = createCountingDb();
    const filterBy = Selection.crossfilter();
    const client = createValuesClient<{ n: number }>({
      coordinator: db.coordinator,
      filterBy,
      filterStable: false,
      query: ({ where }) => Query.from('t').select({ n: count() }).where(where),
    });

    // Before `prepare` resolves: upstream would await the initial query and
    // then issue a second one with the same predicate.
    filterBy.update(weightClause(70));
    await settle(0);

    expect(db.requests).toHaveLength(1);
    expect(db.requests[0]).toContain('70');
    expect(client.store.state.status).toBe('success');

    client.destroy();
  });

  test('builds from the resolved clause list while a newer update is queued', async () => {
    const db = createCountingDb();
    const filterBy = Selection.crossfilter();
    // An upstream-path sibling on the same Selection: its `updateSelection`
    // listener keeps the Selection's dispatch pending until its query
    // answers, so a second update in the meantime is queued and `.clauses`
    // lags behind `_resolved`.
    const sibling = createValuesClient<{ n: number }>({
      coordinator: db.coordinator,
      filterBy,
      query: ({ where }) => Query.from('sibling').select({ n: count() }).where(where),
    });
    const { client } = await createReady({ filterStable: false }, db, filterBy);
    db.hold();
    const before = db.requests.length;

    filterBy.update(weightClause(70));
    filterBy.update(weightClause(80));
    await settle(0);

    const issued = db.requests.slice(before).filter((query) => query.includes('"t"'));
    expect(issued).toHaveLength(1);
    expect(issued[0]).toContain('80');

    for (const request of db.held.splice(0)) {
      request.resolve();
    }
    await settle(0);
    for (const request of db.held.splice(0)) {
      request.resolve();
    }
    await settle(0);
    // Once the queued value dispatches, the client re-queries once more with
    // the same SQL (`cache: false`, so it reaches the connector).
    const after = db.requests.slice(before).filter((query) => query.includes('"t"'));
    expect(after).toEqual([issued[0], issued[0]]);
    expect(client.store.state.settled?.query).toBe(issued[0]);

    sibling.destroy();
    client.destroy();
  });

  test('the same Selection as filterBy and havingBy re-queries once per change', async () => {
    const db = createCountingDb();
    const shared = Selection.crossfilter();
    const client = createValuesClient<{ n: number }>({
      coordinator: db.coordinator,
      filterBy: shared,
      havingBy: shared,
      filterStable: false,
      query: ({ where, having }) =>
        Query.from('t').select({ n: count() }).groupby('weight').where(where).having(having),
    });
    await settle(0);
    expect(client.store.state.status).toBe('success');
    const before = db.requests.length;

    shared.update(weightClause(70));
    await settle(0);

    expect(db.requests.length).toBe(before + 1);
    expect(db.requests.at(-1)).toMatch(/WHERE[\s\S]*70[\s\S]*HAVING[\s\S]*70/);
    expect(client.store.state.status).toBe('success');

    client.destroy();
  });

  test('the same Selection as filterBy and havingBy reads the resolved clause list for both while a newer update is queued', async () => {
    const db = createCountingDb();
    const shared = Selection.crossfilter();
    // A held upstream-path sibling keeps the shared Selection's dispatch
    // pending, so `.clauses` lags behind `_resolved` (see the WHERE-only
    // case above).
    const sibling = createValuesClient<{ n: number }>({
      coordinator: db.coordinator,
      filterBy: shared,
      query: ({ where }) => Query.from('sibling').select({ n: count() }).where(where),
    });
    const client = createValuesClient<{ n: number }>({
      coordinator: db.coordinator,
      filterBy: shared,
      havingBy: shared,
      filterStable: false,
      query: ({ where, having }) =>
        Query.from('t').select({ n: count() }).groupby('weight').where(where).having(having),
    });
    await settle(0);
    expect(client.store.state.status).toBe('success');
    db.hold();
    const before = db.requests.length;

    shared.update(weightClause(70));
    shared.update(weightClause(80));
    await settle(0);

    const issued = db.requests.slice(before).filter((query) => query.includes('"t"'));
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatch(/WHERE[\s\S]*80[\s\S]*HAVING[\s\S]*80/);
    expect(issued[0]).not.toContain('70');

    for (const request of db.held.splice(0)) {
      request.resolve();
    }
    await settle(0);
    for (const request of db.held.splice(0)) {
      request.resolve();
    }
    await settle(0);
    // The queued dispatch re-queries with the same SQL; every query this
    // client issued pairs WHERE and HAVING from one snapshot.
    const after = db.requests.slice(before).filter((query) => query.includes('"t"'));
    expect(after).toEqual([issued[0], issued[0]]);
    expect(client.store.state.settled?.query).toBe(issued[0]);

    sibling.destroy();
    client.destroy();
  });

  test('a visible tab coalesces the clause and the Param into one frame', async () => {
    const { db, filterBy, $from, client } = await createReady({ filterStable: false });
    const frames: Array<FrameRequestCallback> = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('document', { visibilityState: 'visible' });
    const before = db.requests.length;

    filterBy.update(weightClause(70));
    $from.update('2024-02-01');
    await settle(0);
    expect(db.requests.length).toBe(before);
    expect(frames).toHaveLength(1);

    for (const callback of frames.splice(0)) {
      callback(0);
    }
    await settle(0);
    expect(db.requests.length).toBe(before + 1);
    expect(db.requests.at(-1)).toContain('70');
    expect(db.requests.at(-1)).toContain('2024-02-01');

    client.destroy();
  });
});

describe('upstream path unchanged', () => {
  test('filterStable: true keeps updateSelection: the clause first, then the Params, is two requests', async () => {
    const { db, filterBy, $from, client } = await createReady();
    const before = db.requests.length;
    expect(db.coordinator.filterGroups.get(filterBy)?.clients.has(client.mosaicClient)).toBe(true);

    filterBy.update(weightClause(70));
    // `updateSelection` already issued the clause's query synchronously.
    expect(db.requests.length).toBe(before + 1);
    expect(db.requests.at(-1)).toContain('2024-01-01');
    $from.update('2024-02-01');
    await settle(0);

    expect(db.requests.length).toBe(before + 2);
    expect(db.requests.at(-1)).toContain('70');
    expect(db.requests.at(-1)).toContain('2024-02-01');

    client.destroy();
  });

  test('filterStable: true, Params first: the clause query already reads them', async () => {
    const { db, filterBy, $from, client } = await createReady();
    const before = db.requests.length;

    $from.update('2024-02-01');
    filterBy.update(weightClause(70));
    expect(db.requests.length).toBe(before + 1);
    expect(db.requests.at(-1)).toContain('2024-02-01');
    expect(db.requests.at(-1)).toContain('70');
    await settle(0);

    // The Param's coalesced re-query repeats the same SQL (with the default
    // `cache: true`, upstream answers it from the cache).
    expect(db.requests.slice(before)).toEqual([db.requests.at(-1), db.requests.at(-1)]);

    client.destroy();
  });

  test('coalesceFilterBy: false opts a filterStable: false client back into updateSelection', async () => {
    const { db, filterBy, $from, client } = await createReady({
      filterStable: false,
      coalesceFilterBy: false,
    });
    const before = db.requests.length;
    expect(db.coordinator.filterGroups.get(filterBy)?.clients.has(client.mosaicClient)).toBe(true);

    filterBy.update(weightClause(70));
    expect(db.requests.length).toBe(before + 1);
    $from.update('2024-02-01');
    await settle(0);

    expect(db.requests.length).toBe(before + 2);

    client.destroy();
  });

  test('coalesceFilterBy: true has no effect while pre-aggregation can apply', async () => {
    const { db, filterBy, client } = await createReady({ coalesceFilterBy: true });

    expect(db.coordinator.filterGroups.get(filterBy)?.clients.has(client.mosaicClient)).toBe(true);
    const before = db.requests.length;
    filterBy.update(weightClause(70));
    expect(db.requests.length).toBe(before + 1);
    await settle(0);

    client.destroy();
  });
});

describe('pre-aggregation enabled', () => {
  test('an eligible client keeps the optimizer path; an ineligible one coalesces', async () => {
    const db = createCountingDb({ preagg: true });
    const filterBy = Selection.crossfilter();
    const { client: eligible } = await createReady({}, db, filterBy);
    const { client: ineligible } = await createReady({ filterStable: false }, db, filterBy);

    const group = db.coordinator.filterGroups.get(filterBy);
    expect(group?.clients.has(eligible.mosaicClient)).toBe(true);
    expect(group?.clients.has(ineligible.mosaicClient)).toBe(false);

    // A foreign point clause (with the fields and metadata the optimizer
    // indexes on): the eligible client is answered from a pre-aggregated
    // table in the `mosaic` schema; the ineligible one re-queries the base
    // table once, from its coalesced batch.
    const before = db.requests.length;
    filterBy.update(clausePoint('sport', 'swim', { source: source('sport') }));
    await settle(0);

    const issued = db.requests.slice(before);
    expect(issued.some((query) => query.includes('CREATE TABLE IF NOT EXISTS "mosaic".'))).toBe(
      true,
    );
    expect(issued.some((query) => /SELECT[\s\S]*FROM "mosaic"\./.test(query))).toBe(true);
    const base = issued.filter((query) => /FROM "t"/.test(query) && query.includes('swim'));
    expect(base).toHaveLength(1);
    expect(ineligible.store.state.settled?.query).toBe(base[0]);

    eligible.destroy();
    ineligible.destroy();
  });

  test("repeated brush moves keep an eligible sibling's pre-aggregated table", async () => {
    const db = createCountingDb({ preagg: true });
    const filterBy = Selection.crossfilter();
    const { client: eligible } = await createReady({}, db, filterBy);
    const { client: coalesced } = await createReady({ filterStable: false }, db, filterBy);
    const sport = source('sport');
    const before = db.requests.length;

    // Three moves of the same brush: the eligible client builds its
    // materialized table once and answers every move from it. The coalesced
    // sibling's selection-driven re-queries must not clear the coordinator's
    // optimizer state (upstream `Coordinator.requestQuery` would).
    for (const value of ['swim', 'run', 'bike']) {
      filterBy.update(clausePoint('sport', value, { source: sport }));
      await settle(0);
      const entry = db.coordinator.preaggregator.entries.get(eligible.mosaicClient);
      expect(entry && 'result' in entry ? entry.result : null).not.toBeNull();
    }

    const issued = db.requests.slice(before);
    const created = issued.filter((query) =>
      query.includes('CREATE TABLE IF NOT EXISTS "mosaic".'),
    );
    expect(created).toHaveLength(1);
    const materialized = issued.filter((query) => /SELECT[\s\S]*FROM "mosaic"\./.test(query));
    expect(materialized).toHaveLength(3);
    const base = issued.filter((query) => /FROM "t"/.test(query) && !query.includes('CREATE'));
    expect(base).toHaveLength(3);
    expect(base[2]).toContain('bike');
    expect(coalesced.store.state.settled?.query).toBe(base[2]);
    expect(coalesced.store.state.status).toBe('success');

    eligible.destroy();
    coalesced.destroy();
  });

  test("repeated brush moves keep an eligible sibling's pre-aggregated table in a visible tab", async () => {
    const db = createCountingDb({ preagg: true });
    const filterBy = Selection.crossfilter();
    const { client: eligible } = await createReady({}, db, filterBy);
    const { client: coalesced } = await createReady({ filterStable: false }, db, filterBy);
    const frames: Array<FrameRequestCallback> = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('document', { visibilityState: 'visible' });
    const sport = source('sport');
    const before = db.requests.length;

    for (const value of ['swim', 'run', 'bike']) {
      filterBy.update(clausePoint('sport', value, { source: sport }));
      await settle(0);
      expect(frames).toHaveLength(1);
      for (const callback of frames.splice(0)) {
        callback(0);
      }
      await settle(0);
    }

    const issued = db.requests.slice(before);
    const created = issued.filter((query) =>
      query.includes('CREATE TABLE IF NOT EXISTS "mosaic".'),
    );
    expect(created).toHaveLength(1);
    const entry = db.coordinator.preaggregator.entries.get(eligible.mosaicClient);
    expect(entry && 'result' in entry ? entry.result : null).not.toBeNull();
    const base = issued.filter((query) => /FROM "t"/.test(query) && !query.includes('CREATE'));
    expect(base).toHaveLength(3);
    expect(coalesced.store.state.settled?.query).toBe(base[2]);

    eligible.destroy();
    coalesced.destroy();
  });

  test('a batch that also carries a Param change still clears pre-aggregation, as upstream does', async () => {
    const db = createCountingDb({ preagg: true });
    const filterBy = Selection.crossfilter();
    const { client: eligible } = await createReady({}, db, filterBy);
    const { $from, client: coalesced } = await createReady({ filterStable: false }, db, filterBy);
    const sport = source('sport');

    filterBy.update(clausePoint('sport', 'swim', { source: sport }));
    await settle(0);
    expect(db.coordinator.preaggregator.entries.has(eligible.mosaicClient)).toBe(true);

    // A Param re-query goes through upstream `Coordinator.requestQuery`
    // (which clears the optimizer's state) whether or not a clause change
    // shares its batch.
    filterBy.update(clausePoint('sport', 'run', { source: sport }));
    $from.update('2024-02-01');
    await settle(0);

    expect(db.coordinator.preaggregator.entries.size).toBe(0);
    const issued = db.requests.at(-1)!;
    expect(issued).toContain('run');
    expect(issued).toContain('2024-02-01');
    expect(coalesced.store.state.settled?.query).toBe(issued);

    eligible.destroy();
    coalesced.destroy();
  });

  test('Params first on an eligible client: the cache cannot merge the two requests', async () => {
    // The query cache is on (the coordinator default) to show what it can and
    // cannot deduplicate on the pre-aggregation path.
    const db = createCountingDb({ preagg: true, cache: true });
    const filterBy = Selection.crossfilter();
    const { $from, client } = await createReady({}, db, filterBy);
    const before = db.requests.length;

    $from.update('2024-02-01');
    filterBy.update(clausePoint('sport', 'swim', { source: source('sport') }));
    await settle(0);

    // The clause is answered from a materialized table (built with the new
    // Param value); the Param's batched re-query clears pre-aggregation
    // (upstream `Coordinator.requestQuery`) and queries the base table. The
    // two SQL statements differ, so both reach the database.
    const issued = db.requests.slice(before);
    const materialized = issued.filter((query) => /SELECT[\s\S]*FROM "mosaic"\./.test(query));
    const base = issued.filter((query) => /FROM "t"/.test(query) && !query.includes('CREATE'));
    const created = issued.filter((query) =>
      query.includes('CREATE TABLE IF NOT EXISTS "mosaic".'),
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toContain('2024-02-01');
    expect(materialized).toHaveLength(1);
    expect(base).toHaveLength(1);
    expect(base[0]).toContain('2024-02-01');
    expect(base[0]).toContain('swim');
    expect(client.store.state.settled?.query).toBe(base[0]);

    client.destroy();
  });
});
