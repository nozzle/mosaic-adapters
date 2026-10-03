import { createAthletesDb, settle, waitFor } from '@nozzleio/test-support/duckdb';
import type { TestDb } from '@nozzleio/test-support/duckdb';
/**
 * Teardown against a live coordinator: destroying a topology while clients are
 * still connected to its owned contexts / FilterSet targets must not make those
 * clients re-query. (React runs effect cleanups parent-first, so a
 * `useTopology` parent is destroyed while its children's clients are still
 * connected.) The opt-out `clearOnDestroy: true` restores the clearing
 * teardown, which re-queries once per connected client.
 */
import { Query, count } from '@uwdata/mosaic-sql';
import { beforeEach, describe, expect, test } from 'vitest';

import { createTopology, createValuesClient } from '../src/index';
import type { Topology, TopologyOptions } from '../src/index';

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

/**
 * A topology whose FilterSet target feeds a compose and a cascading context,
 * with one values client connected to each owned Selection, and an active
 * FilterSet spec so every context carries a clause.
 */
async function connectedTopology(options: TopologyOptions = {}) {
  const topology: Topology = createTopology(
    {
      filters: { type: 'filter-set', targets: { where: 'crossfilter' } },
      page: { type: 'compose', include: ['filters.where'] },
      a: { type: 'crossfilter' },
      b: { type: 'crossfilter' },
      cascade: { type: 'cascading', keys: ['a', 'b'], externals: ['filters.where'] },
    },
    options,
  );
  topology.getFilterSet('filters')?.set({
    id: 'sport',
    column: 'sport',
    kind: 'point',
    value: 'run',
  });

  const clients = ['filters.where', 'page', 'cascade.a'].map((ref) =>
    createValuesClient<{ athletes: number }>({
      coordinator: db.coordinator,
      query: ({ where }) => Query.from('athletes').select({ athletes: count() }).where(where),
      filterBy: topology.resolve(ref),
    }),
  );

  await waitFor(() => {
    for (const client of clients) {
      expect(client.store.state.values?.athletes).toBe(2);
    }
  });
  await settle();
  // Drop the cache so any teardown query would reach the connector.
  db.coordinator.clear({ clients: false, cache: true });

  return { topology, clients };
}

describe('createTopology — teardown with connected clients', () => {
  test('destroy issues no client query and no connector request', async () => {
    const { topology, clients } = await connectedTopology();
    const clientQueriesBefore = db.clientQueries.length;
    const connectorQueriesBefore = db.connectorQueries.length;

    topology.destroy();
    await settle();

    expect(db.clientQueries.length).toBe(clientQueriesBefore);
    expect(db.connectorQueries.length).toBe(connectorQueriesBefore);
    // The clients keep their last (filtered) result; they die next.
    for (const client of clients) {
      expect(client.store.state.values?.athletes).toBe(2);
      client.destroy();
    }
  });

  test('clearOnDestroy: true re-queries every connected client unfiltered', async () => {
    const { topology, clients } = await connectedTopology({ clearOnDestroy: true });
    const connectorQueriesBefore = db.connectorQueries.length;

    topology.destroy();

    await waitFor(() => {
      for (const client of clients) {
        expect(client.store.state.values?.athletes).toBe(6);
      }
    });
    expect(db.connectorQueries.length).toBeGreaterThan(connectorQueriesBefore);
    for (const client of clients) {
      client.destroy();
    }
  });
});
