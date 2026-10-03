/**
 * Query-level behaviour of the opt-in `filterSet.batch()` / `topology.batch()`
 * against a real Coordinator + DuckDB:
 *
 * - request rounds for crossfilter and intersect targets, batched vs not;
 * - the stale pre-aggregation hazard: a combined emission must never answer
 *   from a materialized view built on the old values of the other clauses.
 */
import { createAthletesDb, settle, waitFor } from '@nozzleio/test-support/duckdb';
import type { TestDb } from '@nozzleio/test-support/duckdb';
import { Param, Selection, clausePoint, makeClient } from '@uwdata/mosaic-core';
import type { ClauseSource, MosaicClient } from '@uwdata/mosaic-core';
import { Query, column, count, eq, literal } from '@uwdata/mosaic-sql';
import type { FilterExpr } from '@uwdata/mosaic-sql';
import { beforeEach, describe, expect, test } from 'vitest';

import { createFilterSet, createTopology, createValuesClient } from '../src/index';
import type { FilterKind, FilterKindEmission, FilterSpec } from '../src/index';
import { SelectionBatch } from '../src/selection-batch';

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

interface TotalsClient {
  client: MosaicClient;
  totals: Array<number>;
  /** SQL of every query the coordinator issued for this client. */
  queries: () => Array<string>;
}

/**
 * A pre-aggregatable client (`SELECT count(*) ... WHERE filter`) recording
 * every total it receives.
 */
function connectTotals(selection: Selection): TotalsClient {
  const totals: Array<number> = [];
  const issued: Array<string> = [];
  const client = makeClient({
    coordinator: db.coordinator,
    selection,
    query: (filter: FilterExpr) => Query.from('athletes').select({ total: count() }).where(filter),
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
  return { client, totals, queries: () => [...issued] };
}

function lastTotal(totals: TotalsClient): number | undefined {
  return totals.totals[totals.totals.length - 1];
}

function pointSpec(id: string, column_: string, value: string): FilterSpec {
  return { id, column: column_, kind: 'point', value };
}

/** Waits for the initial (unfiltered) query and returns the issued count. */
async function ready(totals: TotalsClient): Promise<number> {
  await waitFor(() => {
    expect(lastTotal(totals)).toBe(6);
  });
  await settle();
  return totals.queries().length;
}

describe('request rounds', () => {
  // Three writes that each change the result. Without a batch, a crossfilter
  // target runs one round per write (its dispatch queue keeps one entry per
  // clause source); an intersect target collapses to two (the first write
  // runs immediately, the queue keeps only the latest value). Batched, both
  // run exactly one.
  const writes = (tx: { set: (spec: FilterSpec) => void }): void => {
    tx.set(pointSpec('sport', 'sport', 'swim'));
    tx.set(pointSpec('name', 'name', 'Ada'));
    tx.set(pointSpec('id', 'id', '1'));
  };

  test.each([
    { type: 'crossfilter' as const, unbatched: 3 },
    { type: 'intersect' as const, unbatched: 2 },
  ])('$type target: unbatched writes cost $unbatched rounds', async ({ type, unbatched }) => {
    db.coordinator.preaggregator.enabled = false;
    const $where = type === 'crossfilter' ? Selection.crossfilter() : Selection.intersect();
    const set = createFilterSet({ targets: { where: $where } });
    const totals = connectTotals($where);
    const before = await ready(totals);
    const connectorBefore = db.connectorQueries.length;

    writes(set);

    await waitFor(() => {
      expect(lastTotal(totals)).toBe(1);
    });
    await settle();
    expect(totals.queries().length - before).toBe(unbatched);
    expect(db.connectorQueries.length - connectorBefore).toBe(unbatched);
    set.destroy();
  });

  test.each(['crossfilter', 'intersect'] as const)(
    '%s target: a batch costs one round',
    async (type) => {
      db.coordinator.preaggregator.enabled = false;
      const $where = type === 'crossfilter' ? Selection.crossfilter() : Selection.intersect();
      const set = createFilterSet({ targets: { where: $where } });
      const totals = connectTotals($where);
      const before = await ready(totals);
      const connectorBefore = db.connectorQueries.length;

      set.batch(writes);

      await waitFor(() => {
        expect(lastTotal(totals)).toBe(1);
      });
      await settle();
      expect(totals.queries().length - before).toBe(1);
      expect(db.connectorQueries.length - connectorBefore).toBe(1);
      set.destroy();
    },
  );

  test('topology.batch across two filter sets and a compose costs one round', async () => {
    db.coordinator.preaggregator.enabled = false;
    const topology = createTopology({
      left: { type: 'filter-set', targets: { where: 'crossfilter' } },
      right: { type: 'filter-set', targets: { where: 'crossfilter' } },
      page: { type: 'compose', include: ['left.where', 'right.where'] },
    });
    const totals = connectTotals(topology.resolve('page'));
    const before = await ready(totals);
    const connectorBefore = db.connectorQueries.length;

    topology.batch(() => {
      topology.getFilterSet('left')!.set(pointSpec('sport', 'sport', 'swim'));
      topology.getFilterSet('right')!.set(pointSpec('name', 'name', 'Ada'));
    });

    await waitFor(() => {
      expect(lastTotal(totals)).toBe(1);
    });
    await settle();
    expect(totals.queries().length - before).toBe(1);
    expect(db.connectorQueries.length - connectorBefore).toBe(1);
    topology.destroy();
  });

  test.each(['members-first', 'where-first'] as const)(
    'a spec dropped by a single target clears its sibling clause in the same round (%s)',
    async (order) => {
      db.coordinator.preaggregator.enabled = false;
      // Publishes each spec to `members` (crossfilter) and `where` (single).
      const paired: FilterKind = {
        emit: (args) => {
          const predicate = eq(args.column, literal(String(args.spec.value)));
          const members: FilterKindEmission = { target: 'members', clause: { predicate } };
          const where: FilterKindEmission = { target: 'where', clause: { predicate } };
          return order === 'members-first' ? [members, where] : [where, members];
        },
      };
      const $members = Selection.crossfilter();
      const set = createFilterSet({
        targets: { where: Selection.single(), members: $members },
        kinds: { paired },
      });
      const totals = connectTotals($members);
      const before = await ready(totals);

      set.batch((tx) => {
        // `where` keeps only the second clause, so the first spec is dropped
        // and its `members` clause cleared before anything emits.
        tx.set({ id: 'sport', column: 'sport', kind: 'paired', value: 'run' });
        tx.set({ id: 'name', column: 'name', kind: 'paired', value: 'Ada' });
      });

      await waitFor(() => {
        expect(lastTotal(totals)).toBe(1);
      });
      await settle();
      // One round, straight to the final state (never sport = run AND name = Ada).
      expect(totals.queries().length - before).toBe(1);
      expect(totals.totals).toEqual([6, 1]);
      set.destroy();
    },
  );

  test('an idle Param written inside topology.batch emits before the batched Selections', () => {
    const topology = createTopology({
      filters: { type: 'filter-set', targets: { where: 'intersect' } },
      minWeight: { type: 'param', default: 0 },
    });
    const $where = topology.resolve('filters.where');
    const $minWeight = topology.resolveParam<number>('minWeight');
    const order: Array<string> = [];
    $where.addEventListener('value', () => {
      order.push('selection');
    });
    $minWeight.addEventListener('value', () => {
      order.push('param');
    });

    topology.batch(() => {
      topology.getFilterSet('filters')!.set(pointSpec('sport', 'sport', 'swim'));
      $minWeight.update(60);
    });

    expect(order).toEqual(['param', 'selection']);
    topology.destroy();
  });
});

describe('a coalesced data client (filterStable: false)', () => {
  test('the publishing widget re-queries once, its own clause still excluded', async () => {
    const $where = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $where } });
    const widget = createValuesClient<{ total: unknown }>({
      coordinator: db.coordinator,
      filterBy: $where,
      // Pre-aggregation off: `filterBy` changes take the coalesced path.
      filterStable: false,
      query: ({ where }) =>
        Query.from('athletes')
          .select({ total: count() })
          .where(where as FilterExpr),
    });
    const issued: Array<string> = [];
    const updateClient = db.coordinator.updateClient.bind(db.coordinator);
    db.coordinator.updateClient = (target, query, priority) => {
      if (target === widget.mosaicClient) {
        issued.push(String(query));
      }
      return updateClient(target, query, priority);
    };
    await waitFor(() => {
      expect(Number(widget.store.state.values?.total)).toBe(6);
    });
    await settle();
    const before = issued.length;

    set.batch((tx) => {
      // The widget published `sport`; crossfilter excludes it from its query.
      tx.set(pointSpec('sport', 'sport', 'swim'), { clients: new Set([widget.mosaicClient]) });
      tx.set(pointSpec('name', 'name', 'Ada'));
    });

    await waitFor(() => {
      expect(issued.length - before).toBe(1);
      expect(widget.store.state.status).toBe('success');
    });
    await settle();
    expect(issued.length - before).toBe(1);
    const sql = issued.at(-1)!;
    expect(sql).toContain('Ada');
    expect(sql).not.toContain('swim');
    widget.destroy();
    set.destroy();
  });
});

describe('stale pre-aggregation views', () => {
  // Scenario: the pre-aggregator caches a view for the `sport` clause source
  // (built while no `name` clause existed). A combined update then changes
  // BOTH `name` and `sport`. Emitting it with the `sport` clause active would
  // reuse that cached view and ignore the new `name` clause.
  const sport: ClauseSource = {};
  const name: ClauseSource = {};
  const sportClause = (value: string) => clausePoint(column('sport'), value, { source: sport });
  const nameClause = (value: string) => clausePoint(column('name'), value, { source: name });

  /** Builds and exercises a pre-aggregated view keyed on the `sport` source. */
  async function primeSportView($where: Selection, totals: TotalsClient): Promise<void> {
    await ready(totals);
    $where.update(sportClause('swim'));
    await waitFor(() => {
      expect(lastTotal(totals)).toBe(4);
    });
    $where.update(sportClause('run'));
    await waitFor(() => {
      expect(lastTotal(totals)).toBe(2);
    });
    await settle();
    // The second update answered from the materialized view.
    expect(totals.queries().at(-1)).toContain('preagg_');
  }

  test('control: emitting a combined update with a real active clause is stale', async () => {
    const $where = Selection.intersect();
    const totals = connectTotals($where);
    await primeSportView($where, totals);

    // Naive deferral: resolve both clauses, emit once with `sport` active.
    let resolved = $where._resolver.resolve($where._resolved, nameClause('Ada'), true);
    const swim = sportClause('swim');
    resolved = $where._resolver.resolve(resolved, swim, true);
    const emitted: Selection['clauses'] = resolved;
    emitted.active = swim;
    $where._resolved = emitted;
    Param.prototype.update.call($where, emitted);

    await settle(150);
    // Correct answer is 1 (Ada swims); the reused view ignores `name`.
    expect(lastTotal(totals)).toBe(4);
  });

  test('a SelectionBatch emission takes the standard query path', async () => {
    const $where = Selection.intersect();
    const totals = connectTotals($where);
    await primeSportView($where, totals);

    const batch = new SelectionBatch();
    batch.update($where, nameClause('Ada'));
    batch.update($where, sportClause('swim'));
    batch.flush();

    await waitFor(() => {
      expect(lastTotal(totals)).toBe(1);
    });
    expect(totals.queries().at(-1)).not.toContain('preagg_');

    // The next plain update rebuilds a fresh view that includes `name`.
    $where.update(sportClause('run'));
    await waitFor(() => {
      expect(lastTotal(totals)).toBe(0);
    });
  });

  test.each(['crossfilter', 'intersect'] as const)(
    'filterSet.batch on a %s target answers correctly after a cached view',
    async (type) => {
      const $where = type === 'crossfilter' ? Selection.crossfilter() : Selection.intersect();
      const set = createFilterSet({ targets: { where: $where } });
      const totals = connectTotals($where);
      await ready(totals);

      // Two plain writes on the same spec: the second reuses a view keyed on
      // the spec's clause source.
      set.set(pointSpec('sport', 'sport', 'swim'));
      await waitFor(() => {
        expect(lastTotal(totals)).toBe(4);
      });
      set.set(pointSpec('sport', 'sport', 'run'));
      await waitFor(() => {
        expect(lastTotal(totals)).toBe(2);
      });
      await settle();
      expect(totals.queries().at(-1)).toContain('preagg_');

      // The batch's last write targets the cached source again.
      set.batch((tx) => {
        tx.set(pointSpec('name', 'name', 'Ada'));
        tx.set(pointSpec('sport', 'sport', 'swim'));
      });

      await waitFor(() => {
        expect(lastTotal(totals)).toBe(1);
      });
      await settle();
      expect(lastTotal(totals)).toBe(1);
      set.destroy();
    },
  );
});
