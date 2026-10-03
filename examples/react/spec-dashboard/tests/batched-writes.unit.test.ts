/**
 * The two dashboard flows that make several FilterSet / Selection writes for
 * one action and wrap them in the opt-in `topology.batch()`:
 *
 * - **Clear All** (`clearAllFilters`): `topology.reset()` clears every spec on
 *   every target plus the volume brush. Batched, a client filtered by the
 *   crossfilter `page` context re-queries once instead of once per cleared
 *   clause.
 * - **URL hydration** (`hydrateFilterSet`): a shared link replays several specs
 *   in URL order. Batched, a metric threshold replayed before its siblings
 *   ships its membership subquery with their clauses straight away instead of
 *   being rebuilt a microtask later.
 *
 * Both run against the shipped questions spec's topology and a real DuckDB.
 * The coordinator's pre-aggregation is disabled so every round is one query
 * per client, and rounds are counted at `coordinator.updateClient`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createTopology } from '@nozzleio/react-mosaic';
import type { FilterSet, FilterSpec, Topology } from '@nozzleio/react-mosaic';
import { createTestDb, settle, waitFor } from '@nozzleio/test-support/duckdb';
import type { TestDb } from '@nozzleio/test-support/duckdb';
import { clauseInterval, makeClient } from '@uwdata/mosaic-core';
import type { MosaicClient, Selection } from '@uwdata/mosaic-core';
import { Query, column, count } from '@uwdata/mosaic-sql';
import type { FilterExpr } from '@uwdata/mosaic-sql';
import { beforeEach, describe, expect, test } from 'vitest';

import { clearAllFilters } from '../src/chrome/clear-all';
import { compileSpec } from '../src/spec/compile';
import type { CompiledSpec } from '../src/spec/compile';
import { buildFilterUrlPatch, createUrlPersister } from '../src/spec/filter-url';
import { hydrateFilterSet } from '../src/spec/url-state/use-persisted-topology';

function readSpec(): CompiledSpec {
  const path = fileURLToPath(new URL('../public/spec/questions.yaml', import.meta.url));
  const result = compileSpec(readFileSync(path, 'utf8'));
  if (!result.ok) {
    throw new Error(`questions spec failed to compile: ${result.errors.join('; ')}`);
  }
  return result.compiled;
}

const compiled = readSpec();

const phraseSpec: FilterSpec = {
  id: 'text:phrase',
  column: 'phrase',
  kind: 'condition',
  operator: 'contains',
  value: 'stove',
  label: 'Phrase',
};
const domainSpec: FilterSpec = {
  id: 'facet:domain',
  column: 'domain',
  kind: 'condition',
  operator: 'in',
  value: ['reddit.com', 'google.com'],
  label: 'Domain',
};
/** Keywords whose max search volume is above 500 (the `metric_threshold` kind). */
const metricSpec: FilterSpec = {
  id: 'metric:phrase',
  column: 'phrase',
  kind: 'metric_threshold',
  operator: 'gt',
  value: 500,
  label: 'Search Vol',
};

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  db.coordinator.preaggregator.enabled = false;
  await db.exec(`
    CREATE TABLE questions_enriched(phrase TEXT, domain TEXT, search_volume INTEGER);
    INSERT INTO questions_enriched VALUES
      ('gas stove', 'reddit.com', 900),
      ('gas stove', 'google.com', 100),
      ('stove top', 'reddit.com', 300),
      ('oven', 'google.com', 2000),
      ('oven', 'amazon.com', 50),
      ('kettle', 'youtube.com', 700);
  `);
});

interface CountClient {
  totals: Array<number>;
  /** Queries the coordinator issued for this client so far. */
  rounds: () => number;
}

/** Connects a `count(*)` client filtered by `selection`. */
function connectCount(selection: Selection): CountClient {
  const totals: Array<number> = [];
  const issued: Array<string> = [];
  const client: MosaicClient = makeClient({
    coordinator: db.coordinator,
    selection,
    query: (filter: FilterExpr) =>
      Query.from('questions_enriched').select({ total: count() }).where(filter),
    queryResult: (data) => {
      const rows = (data as { toArray: () => Array<{ total: unknown }> }).toArray();
      totals.push(Number(rows[0]?.total));
    },
  });
  const updateClient = db.coordinator.updateClient.bind(db.coordinator);
  db.coordinator.updateClient = (target, query, priority) => {
    if (target === client) {
      issued.push(String(query));
    }
    return updateClient(target, query, priority);
  };
  return { totals, rounds: () => issued.length };
}

function lastTotal(client: CountClient): number | undefined {
  return client.totals[client.totals.length - 1];
}

function buildTopology(): { topology: Topology; filters: FilterSet } {
  const topology = createTopology(compiled.topologyConfig, compiled.topologyOptions);
  const filters = topology.getFilterSet('filters');
  if (filters === undefined) {
    throw new Error("questions spec is missing its 'filters' FilterSet");
  }
  return { topology, filters };
}

/** SQL of every predicate currently on `selection`. */
function predicates(selection: Selection): Array<string> {
  return selection._resolved.map((clause) => String(clause.predicate));
}

describe('Clear All', () => {
  /**
   * Applies three specs over three targets plus a volume brush, waits for the
   * page client to settle on the filtered total, then clears with `clear` and
   * returns how many rounds the clear cost and how often `activeClauses`
   * refreshed.
   */
  async function clearWith(
    clear: (topology: Topology) => void,
  ): Promise<{ rounds: number; refreshes: number }> {
    const { topology, filters } = buildTopology();
    const page = connectCount(topology.resolve('page'));
    await waitFor(() => {
      expect(lastTotal(page)).toBe(6);
    });

    filters.set(phraseSpec);
    filters.set(domainSpec);
    filters.set(metricSpec);
    topology
      .resolve('volume_brush')
      .update(clauseInterval(column('search_volume'), [500, 1000], { source: {} }));
    // gas stove (reddit.com, 900) is the only row left.
    await waitFor(() => {
      expect(lastTotal(page)).toBe(1);
    });
    await settle();

    let refreshes = 0;
    const subscription = topology.activeClauses.subscribe(() => {
      refreshes += 1;
    });
    const before = page.rounds();

    clear(topology);

    await waitFor(() => {
      expect(lastTotal(page)).toBe(6);
    });
    await settle();
    expect(filters.store.state.specs).toEqual([]);
    expect(topology.resolve('volume_brush')._resolved).toHaveLength(0);
    const result = { rounds: page.rounds() - before, refreshes };
    subscription.unsubscribe();
    topology.destroy();
    return result;
  }

  test('unbatched, the page client re-queries once per cleared clause', async () => {
    const result = await clearWith((topology) => {
      topology.reset();
    });

    // The brush, the two `where` specs and the threshold's membership clause:
    // each cleared clause is its own round on the crossfilter page context.
    expect(result.rounds).toBe(4);
    expect(result.refreshes).toBeGreaterThan(1);
  });

  test('clearAllFilters re-queries the page client once and refreshes activeClauses once', async () => {
    const result = await clearWith(clearAllFilters);

    expect(result.rounds).toBe(1);
    expect(result.refreshes).toBe(1);
  });
});

describe('URL hydration', () => {
  /**
   * A shared link with the threshold param BEFORE the phrase param, so the
   * threshold's membership subquery is built before the phrase clause exists.
   */
  function linkSearch(): Record<string, string> {
    const { registry } = compiled.urlState.filterSet;
    const patch = buildFilterUrlPatch(registry, 'f', [metricSpec, phraseSpec]);
    const metric = patch['f.metric:phrase'];
    const phrase = patch['f.text:phrase'];
    if (typeof metric !== 'string' || typeof phrase !== 'string') {
      throw new Error('expected both specs to encode');
    }
    return { 'f.metric:phrase': metric, 'f.text:phrase': phrase };
  }

  function hydrate(mode: 'batched' | 'unbatched'): {
    topology: Topology;
    filters: FilterSet;
    members: Selection;
  } {
    const { topology, filters } = buildTopology();
    const { registry, defaults } = compiled.urlState.filterSet;
    const persister = createUrlPersister(registry, 'f', defaults, {
      search: linkSearch(),
      navigateSearch: () => {},
    });
    if (mode === 'batched') {
      hydrateFilterSet(topology, { filterSet: filters, persister });
    } else {
      // The pre-batch replay: one `set` per URL param, in URL order.
      const specs = persister.read(undefined);
      if (!Array.isArray(specs)) {
        throw new Error('expected a synchronous spec array');
      }
      for (const spec of specs) {
        filters.set(spec);
      }
    }
    return { topology, filters, members: topology.resolve('filters.members:phrase') };
  }

  test('the replayed specs are the link order (threshold first)', () => {
    const { topology, filters } = hydrate('batched');
    expect(filters.store.state.specs.map((spec) => spec.id)).toEqual([
      'metric:phrase',
      'text:phrase',
    ]);
    topology.destroy();
  });

  test('unbatched, the threshold first ships a subquery without the phrase clause', async () => {
    const { topology, members } = hydrate('unbatched');
    // Synchronously after hydration: built before the phrase clause existed.
    expect(predicates(members)[0]).not.toContain('stove');
    // A client connecting now queries that stale subquery, then re-queries
    // as the queued page update and the context rebuild land.
    const page = connectCount(topology.resolve('page'));
    await settle();
    expect(predicates(members)[0]).toContain('stove');
    // Both 'gas stove' rows (its max volume, 900, passes the threshold).
    await waitFor(() => {
      expect(lastTotal(page)).toBe(2);
    });
    await settle();
    // The initial (stale) query, the queued phrase update, the rebuild.
    expect(page.rounds()).toBe(3);
    topology.destroy();
  });

  test('hydrateFilterSet ships the final subquery at once: one query for a client connecting next', async () => {
    const { topology, members } = hydrate('batched');
    expect(predicates(members)[0]).toContain('stove');
    const page = connectCount(topology.resolve('page'));
    await waitFor(() => {
      expect(lastTotal(page)).toBe(2);
    });
    await settle();
    expect(page.rounds()).toBe(1);
    topology.destroy();
  });

  test('a single spec is set directly, outside a batch', () => {
    const { topology, filters } = buildTopology();
    const { registry, defaults } = compiled.urlState.filterSet;
    const persister = createUrlPersister(registry, 'f', defaults, {
      search: { 'f.text:phrase': 'stove' },
      navigateSearch: () => {},
    });
    hydrateFilterSet(topology, { filterSet: filters, persister });
    // An ordinary publish keeps its own clause active (a batched emission
    // would carry a synthetic one).
    const where = topology.resolve('filters.where');
    expect(where.active).toBe(where._resolved[0]);
    topology.destroy();
  });
});
