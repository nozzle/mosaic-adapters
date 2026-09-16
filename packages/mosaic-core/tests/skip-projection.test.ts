/**
 * `skipSources` in front of the coordinator (#229): a skipped-only clause
 * change must produce no query and no `'pending'` transition, while every
 * relevant trigger still refreshes. Runs through a real `Coordinator` with
 * caching off so a cache hit cannot hide a redundant request.
 */
import { Coordinator, Selection, clausePoint } from '@uwdata/mosaic-core';
import { Query, count } from '@uwdata/mosaic-sql';
import { describe, expect, test } from 'vitest';

import { settle } from '@nozzleio/test-support/duckdb';
import { createSkipProjectedSelection, createValuesClient } from '../src/index';
import type {
  ArrowQueryRequest,
  Connector,
  ExecQueryRequest,
  JSONQueryRequest,
  MosaicClient,
} from '@uwdata/mosaic-core';
import type { DataClientStatus, ValuesClient } from '../src/index';

interface CountingDb {
  coordinator: Coordinator;
  queries: Array<string>;
}

function createCountingDb(): CountingDb {
  const queries: Array<string> = [];
  const connector = {
    query(request: ArrowQueryRequest | ExecQueryRequest | JSONQueryRequest) {
      queries.push(request.sql);
      return Promise.resolve([{ total: 1 }]);
    },
  } as unknown as Connector;
  const coordinator = new Coordinator(connector, {
    logger: null,
    consolidate: false,
    cache: false,
    preagg: { enabled: false },
  });
  return { coordinator, queries };
}

interface Totals extends Record<string, unknown> {
  total: number;
}

function recordStatuses(client: ValuesClient<Totals>): Array<DataClientStatus> {
  const store = client.store;
  const log: Array<DataClientStatus> = [store.state.status];
  store.subscribe(() => {
    if (log[log.length - 1] !== store.state.status) {
      log.push(store.state.status);
    }
  });
  return log;
}

const device = (value: string, clients?: Set<MosaicClient>) =>
  clausePoint('device', value, { source: { id: 'device' } as object, clients });
const sport = (value: string) =>
  clausePoint('sport', value, { source: { id: 'sport' } as object });

function totals(where: unknown) {
  return Query.from('t')
    .select({ total: count() })
    .where(where as never);
}

describe('skipSources projection', () => {
  test('a skipped-only add, change and remove issue no query and never go pending', async () => {
    const db = createCountingDb();
    const filterBy = Selection.intersect();
    const client = createValuesClient<Totals>({
      coordinator: db.coordinator,
      filterBy,
      skipSources: new Set(['device']),
      query: ({ where }) => totals(where),
    });
    await settle();
    expect(db.queries).toHaveLength(1);
    const statuses = recordStatuses(client);

    filterBy.update(device('desktop'));
    await filterBy.pending('value');
    await settle();
    filterBy.update(device('mobile'));
    await filterBy.pending('value');
    await settle();
    filterBy.update(
      clausePoint('device', null, { source: { id: 'device' } as object }),
    );
    await filterBy.pending('value');
    await settle();

    expect(db.queries).toHaveLength(1);
    expect(statuses).toEqual(['success']);
    expect(client.store.state.status).toBe('success');

    client.destroy();
  });

  test('a kept clause still re-queries with the skipped clause absent from SQL', async () => {
    const db = createCountingDb();
    const filterBy = Selection.intersect();
    const client = createValuesClient<Totals>({
      coordinator: db.coordinator,
      filterBy,
      skipSources: new Set(['device']),
      query: ({ where }) => totals(where),
    });
    await settle();
    filterBy.update(device('desktop'));
    await filterBy.pending('value');
    await settle();
    expect(db.queries).toHaveLength(1);

    filterBy.update(sport('swim'));
    await filterBy.pending('value');
    await settle();
    expect(db.queries).toHaveLength(2);
    const sql = db.queries[1]!;
    expect(sql).toContain('swim');
    expect(sql).not.toContain('desktop');
    expect(client.store.state.lastQuery).toBe(sql);

    client.destroy();
  });

  test('refetch() bypasses the projection and queries with current state', async () => {
    const db = createCountingDb();
    const filterBy = Selection.intersect();
    const client = createValuesClient<Totals>({
      coordinator: db.coordinator,
      filterBy,
      skipSources: new Set(['device']),
      query: ({ where }) => totals(where),
    });
    await settle();
    filterBy.update(device('desktop'));
    await filterBy.pending('value');
    await settle();
    expect(db.queries).toHaveLength(1);

    await client.refetch();
    expect(db.queries).toHaveLength(2);
    expect(db.queries[1]).not.toContain('desktop');

    client.destroy();
  });

  test('a skipped-only havingBy change issues no query', async () => {
    const db = createCountingDb();
    const filterBy = Selection.intersect();
    const havingBy = Selection.intersect();
    const client = createValuesClient<Totals>({
      coordinator: db.coordinator,
      filterBy,
      havingBy,
      skipSources: new Set(['device']),
      query: ({ where, having }) =>
        Query.from('t')
          .select({ total: count() })
          .where(where)
          .groupby('sport')
          .having(having),
    });
    await settle();
    expect(db.queries).toHaveLength(1);

    havingBy.update(device('desktop'));
    await havingBy.pending('value');
    await settle();
    expect(db.queries).toHaveLength(1);

    havingBy.update(sport('swim'));
    await havingBy.pending('value');
    await settle();
    expect(db.queries).toHaveLength(2);
    expect(db.queries[1]).toContain('swim');

    client.destroy();
  });

  test('crossfilter self-exclusion survives the projection', async () => {
    const db = createCountingDb();
    const filterBy = Selection.crossfilter();
    const client = createValuesClient<Totals>({
      coordinator: db.coordinator,
      filterBy,
      skipSources: new Set(['device']),
      query: ({ where }) => totals(where),
    });
    await settle();
    expect(db.queries).toHaveLength(1);

    // A kept clause keyed to this client: the active-clause short-circuit
    // must still elide the update, exactly as on the parent.
    filterBy.update(
      clausePoint('sport', 'swim', {
        source: { id: 'sport' } as object,
        clients: new Set([client.mosaicClient]),
      }),
    );
    await filterBy.pending('value');
    await settle();
    expect(db.queries).toHaveLength(1);

    // Another publisher's kept clause queries, still excluding our own.
    filterBy.update(
      clausePoint('weight', 70, { source: { id: 'weight' } as object }),
    );
    await filterBy.pending('value');
    await settle();
    expect(db.queries).toHaveLength(2);
    expect(db.queries[1]).toContain('weight');
    expect(db.queries[1]).not.toContain('swim');

    client.destroy();
  });

  test('a client created after clauses exist seeds only the kept ones', async () => {
    const db = createCountingDb();
    const filterBy = Selection.intersect();
    filterBy.update(device('desktop'));
    filterBy.update(sport('swim'));
    await filterBy.pending('value');

    const client = createValuesClient<Totals>({
      coordinator: db.coordinator,
      filterBy,
      skipSources: new Set(['device']),
      query: ({ where }) => totals(where),
    });
    await settle();
    expect(db.queries).toHaveLength(1);
    expect(db.queries[0]).toContain('swim');
    expect(db.queries[0]).not.toContain('desktop');

    client.destroy();
  });

  test('destroy() detaches the projection from the parent relay', () => {
    const parent = Selection.intersect();
    const handle = createSkipProjectedSelection(parent, new Set(['device']));
    expect(parent._relay.has(handle.selection)).toBe(true);

    parent.update(sport('swim'));
    expect(handle.selection.clauses).toHaveLength(1);

    handle.destroy();
    handle.destroy();
    expect(parent._relay.has(handle.selection)).toBe(false);
    parent.update(sport('run'));
    expect(handle.selection.clauses[0]?.value).toBe('swim');
  });

  test('reset() on the parent relays only kept clauses', () => {
    const parent = Selection.intersect();
    const handle = createSkipProjectedSelection(parent, new Set(['device']));
    parent.update(device('desktop'));
    parent.update(sport('swim'));
    expect(handle.selection.clauses).toHaveLength(1);

    parent.reset();
    expect(parent.clauses).toHaveLength(0);
    expect(handle.selection.clauses).toHaveLength(0);
    handle.destroy();
  });
});
