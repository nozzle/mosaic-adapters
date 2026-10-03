/**
 * Both metric-threshold cards active at once: the `metric:phrase` and
 * `metric:domain` specs each publish a membership subquery into the `page`
 * context, which is also the FilterSet's own context. Each subquery is built
 * against the context without the other threshold, so the two settle instead
 * of embedding each other one level deeper on every rebuild; the page still
 * applies both.
 *
 * Runs against the shipped questions spec's topology and a real DuckDB, with
 * pre-aggregation disabled so every round is one query per client.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createTopology } from '@nozzleio/react-mosaic';
import type { FilterSet, FilterSpec, Topology } from '@nozzleio/react-mosaic';
import { createTestDb, settle, waitFor } from '@nozzleio/test-support/duckdb';
import type { TestDb } from '@nozzleio/test-support/duckdb';
import { makeClient } from '@uwdata/mosaic-core';
import type { MosaicClient, Selection } from '@uwdata/mosaic-core';
import { Query, count } from '@uwdata/mosaic-sql';
import type { FilterExpr } from '@uwdata/mosaic-sql';
import { beforeEach, describe, expect, test } from 'vitest';

import { compileSpec } from '../src/spec/compile';
import type { CompiledSpec } from '../src/spec/compile';

function readSpec(): CompiledSpec {
  const path = fileURLToPath(new URL('../public/spec/questions.yaml', import.meta.url));
  const result = compileSpec(readFileSync(path, 'utf8'));
  if (!result.ok) {
    throw new Error(`questions spec failed to compile: ${result.errors.join('; ')}`);
  }
  return result.compiled;
}

const compiled = readSpec();

/** Keywords whose max search volume is above 500. */
const phraseThreshold: FilterSpec = {
  id: 'metric:phrase',
  column: 'phrase',
  kind: 'metric_threshold',
  operator: 'gt',
  value: 500,
  label: 'Search Vol',
};
/** Domains with more than one row. */
const domainThreshold: FilterSpec = {
  id: 'metric:domain',
  column: 'domain',
  kind: 'metric_threshold_domain',
  operator: 'gt',
  value: 1,
  label: 'Rows',
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
  let issued = 0;
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
      issued += 1;
    }
    return updateClient(target, query, priority);
  };
  return { totals, rounds: () => issued };
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

/** The one membership predicate on a `members:*` target. */
function membership(topology: Topology, name: string): string {
  const predicates = topology.resolve(name)._resolved.map((clause) => String(clause.predicate));
  expect(predicates).toHaveLength(1);
  return predicates[0] ?? '';
}

describe('two metric thresholds', () => {
  test.each(['unbatched', 'batched'] as const)(
    'settle with neither membership subquery embedding the other (%s)',
    async (mode) => {
      const { topology, filters } = buildTopology();
      const page = connectCount(topology.resolve('page'));
      await waitFor(() => {
        expect(lastTotal(page)).toBe(6);
      });
      await settle();
      const before = page.rounds();

      if (mode === 'batched') {
        topology.batch(() => {
          filters.set(phraseThreshold);
          filters.set(domainThreshold);
        });
      } else {
        filters.set(phraseThreshold);
        filters.set(domainThreshold);
      }

      // gas stove / oven / kettle pass the volume threshold; reddit.com and
      // google.com the row-count one: gas stove × 2 and oven × google.com.
      await waitFor(() => {
        expect(lastTotal(page)).toBe(3);
      });
      await settle();
      const rounds = page.rounds() - before;
      await settle();
      // Settled: no further rounds once both thresholds have published.
      expect(page.rounds() - before).toBe(rounds);
      expect(rounds).toBe(mode === 'batched' ? 1 : 2);

      const phrase = membership(topology, 'filters.members:phrase');
      const domain = membership(topology, 'filters.members:domain');
      expect(phrase).toContain('max(search_volume) > 500');
      expect(phrase).not.toContain('count(*)');
      expect(domain).toContain('count(*) > 1');
      expect(domain).not.toContain('max(search_volume)');
      // The page context still applies both memberships.
      const pageSql = topology.resolve('page')._resolved.map((clause) => String(clause.predicate));
      expect(pageSql).toEqual([phrase, domain]);
      topology.destroy();
    },
  );
});
