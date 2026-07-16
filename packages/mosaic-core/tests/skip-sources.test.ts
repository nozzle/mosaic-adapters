import { Selection } from '@uwdata/mosaic-core';
import { Query, count, eq, gte, literal, lte } from '@uwdata/mosaic-sql';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  createAthletesDb,
  settle,
  waitFor,
} from '@nozzleio/test-support/duckdb';
import { createRowsClient } from '../src/index';
import type { ClauseSource } from '@uwdata/mosaic-core';
import type { FilterExpr } from '@uwdata/mosaic-sql';
import type { TestDb } from '@nozzleio/test-support/duckdb';

/**
 * A clause source carrying a string `id` (what `skipSources` matches on).
 * `ClauseSource` is upstream-typed as bare `object`, so the id rides through a
 * cast rather than an object literal (which the excess-property check rejects).
 */
function sourceId(id: string): ClauseSource {
  return { id } as ClauseSource;
}

interface AthleteRow {
  id: number;
  name: string;
  sport: string;
  weight: number;
}

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

function athleteQuery() {
  return Query.from('athletes').select('id', 'name', 'sport', 'weight');
}

/** Grouped query exposing a `total` aggregate usable in WHERE and HAVING. */
function sportTotalsQuery({
  where,
  having,
}: {
  where: FilterExpr;
  having: FilterExpr;
}) {
  return Query.from('athletes')
    .select('sport', { total: count() })
    .groupby('sport')
    .where(where)
    .having(having);
}

describe('skipSources', () => {
  test('absent vs empty set produce byte-identical WHERE and HAVING SQL', async () => {
    const $where = Selection.intersect();
    const $having = Selection.intersect();
    $where.update({
      source: sourceId('w'),
      value: 'swim',
      fields: [],
      predicate: eq('sport', literal('swim')),
    });
    $having.update({
      source: sourceId('h'),
      value: 3,
      fields: [],
      predicate: gte('total', literal(3)),
    });

    const makeClient = (skipSources?: ReadonlySet<string>) =>
      createRowsClient<{ sport: string; total: number }>({
        coordinator: db.coordinator,
        query: ({ where, having }) => sportTotalsQuery({ where, having }),
        filterBy: $where,
        havingBy: $having,
        skipSources,
      });

    const baseline = makeClient(undefined);
    await waitFor(() => {
      expect(baseline.store.state.status).toBe('success');
    });
    const baselineSql = baseline.store.state.lastQuery;

    const empty = makeClient(new Set());
    await waitFor(() => {
      expect(empty.store.state.status).toBe('success');
    });

    expect(empty.store.state.lastQuery).toBe(baselineSql);
    expect(baselineSql).toMatch(/WHERE/i);
    expect(baselineSql).toMatch(/HAVING/i);

    baseline.destroy();
    empty.destroy();
  });

  test('intersect: skipping one of two sources leaves only the other in WHERE', async () => {
    const $sel = Selection.intersect();
    $sel.update({
      source: sourceId('a'),
      value: 'swim',
      fields: [],
      predicate: eq('sport', literal('swim')),
    });
    $sel.update({
      source: sourceId('b'),
      value: 60,
      fields: [],
      predicate: gte('weight', literal(60)),
    });

    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      filterBy: $sel,
      skipSources: new Set(['a']),
    });

    // Only weight >= 60 survives (5 rows); the skipped sport clause (which
    // would drop the count to 4 swimmers) is gone from the WHERE.
    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.rows).toHaveLength(5);
    });
    expect(client.store.state.lastQuery).toMatch(/"weight" >= 60/);
    expect(client.store.state.lastQuery).not.toMatch(/swim/);

    client.destroy();
  });

  test('union: remaining clauses stay OR-composed, the skipped one drops out', async () => {
    const $sel = Selection.union();
    $sel.update({
      source: sourceId('a'),
      value: 'run',
      fields: [],
      predicate: eq('sport', literal('run')),
    });
    $sel.update({
      source: sourceId('b'),
      value: 80,
      fields: [],
      predicate: gte('weight', literal(80)),
    });
    $sel.update({
      source: sourceId('c'),
      value: 'Ada',
      fields: [],
      predicate: eq('name', literal('Ada')),
    });

    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      filterBy: $sel,
      skipSources: new Set(['c']),
    });

    // run (Ed, Fi) OR weight >= 80 (Cy, Di) = 4; the skipped name clause is gone.
    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.rows).toHaveLength(4);
    });
    expect(client.store.state.lastQuery).toMatch(/OR/i);
    expect(client.store.state.lastQuery).not.toMatch(/Ada/);

    client.destroy();
  });

  test('empty:true selection with every clause skipped resolves to FALSE (no rows)', async () => {
    const $sel = Selection.intersect({ empty: true });
    $sel.update({
      source: sourceId('a'),
      value: 'swim',
      fields: [],
      predicate: eq('sport', literal('swim')),
    });

    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      filterBy: $sel,
      skipSources: new Set(['a']),
    });

    // Delegation to the empty:true resolver yields a FALSE literal for the
    // now-empty clause list — no rows, NOT an unfiltered all-rows result.
    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.rows).toHaveLength(0);
    });
    expect(client.store.state.lastQuery).toMatch(/FALSE/i);

    client.destroy();
  });

  test('crossfilter: own-clause self-exclusion composes with skipSources', async () => {
    const $xf = Selection.crossfilter();

    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      filterBy: $xf,
      skipSources: new Set(['skip']),
    });

    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
    });

    // This client's own clause (self-excluded under crossfilter) and the
    // skipped clause must BOTH drop out; only the "keep" clause applies.
    $xf.update({
      source: sourceId('own'),
      value: 'swim',
      fields: [],
      predicate: eq('sport', literal('swim')),
      clients: new Set([client.mosaicClient]),
    });
    $xf.update({
      source: sourceId('keep'),
      value: 60,
      fields: [],
      predicate: gte('weight', literal(60)),
    });
    $xf.update({
      source: sourceId('skip'),
      value: 'run',
      fields: [],
      predicate: eq('sport', literal('run')),
    });

    await client.refetch();

    // weight >= 60 only → Ada, Bo, Cy, Di, Fi (5); neither sport clause applies
    // (`sport` still appears as a selected column, so assert on the literals).
    expect(client.store.state.rows).toHaveLength(5);
    expect(client.store.state.lastQuery).toMatch(/"weight" >= 60/);
    expect(client.store.state.lastQuery).not.toMatch(/'swim'/);
    expect(client.store.state.lastQuery).not.toMatch(/'run'/);

    client.destroy();
  });

  test('havingBy: skipped aggregate predicate is absent from HAVING', async () => {
    const $having = Selection.intersect();
    $having.update({
      source: sourceId('keep'),
      value: 3,
      fields: [],
      predicate: gte('total', literal(3)),
    });
    $having.update({
      source: sourceId('skip'),
      value: 2,
      fields: [],
      predicate: lte('total', literal(2)),
    });

    const client = createRowsClient<{ sport: string; total: number }>({
      coordinator: db.coordinator,
      query: ({ where, having }) => sportTotalsQuery({ where, having }),
      havingBy: $having,
      skipSources: new Set(['skip']),
    });

    // Without the skip, total>=3 AND total<=2 is unsatisfiable (0 rows). With
    // "skip" dropped only total>=3 remains → the swim group (4 members).
    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.rows.map((r) => r.sport)).toEqual(['swim']);
    });
    expect(client.store.state.lastQuery).toMatch(/HAVING/i);
    expect(client.store.state.lastQuery).not.toMatch(/"total" <= 2/);

    client.destroy();
  });

  test('shared filterBy+havingBy Selection: skipped source appears in neither clause', async () => {
    const $sel = Selection.intersect();
    // A grouped-column predicate is legal in both WHERE and HAVING.
    $sel.update({
      source: sourceId('x'),
      value: 'swim',
      fields: [],
      predicate: eq('sport', literal('swim')),
    });

    const client = createRowsClient<{ sport: string; total: number }>({
      coordinator: db.coordinator,
      query: ({ where, having }) => sportTotalsQuery({ where, having }),
      filterBy: $sel,
      havingBy: $sel,
      skipSources: new Set(['x']),
    });

    // The skipped clause is dropped from WHERE and HAVING alike → both groups.
    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.rows.map((r) => r.sport).sort()).toEqual([
        'run',
        'swim',
      ]);
    });
    expect(client.store.state.lastQuery).not.toMatch(/swim/);

    client.destroy();
  });

  test('selection-driven update path re-resolves with the skip (edge case A)', async () => {
    const $sel = Selection.intersect();
    $sel.update({
      source: sourceId('keep'),
      value: 70,
      fields: [],
      predicate: gte('weight', literal(70)),
    });

    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      filterBy: $sel,
      skipSources: new Set(['skip']),
    });

    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.rows).toHaveLength(3);
    });

    // Publishing the skipped clause drives an updateSelection: the coordinator
    // hands the client a predicate WITH the skip clause baked in. The client
    // must ignore that filter and re-resolve — weight >= 70 (3 rows) stays; had
    // the passed predicate been used, sport='run' AND weight>=70 → 0 rows.
    $sel.update({
      source: sourceId('skip'),
      value: 'run',
      fields: [],
      predicate: eq('sport', literal('run')),
    });

    await settle();
    await waitFor(() => {
      expect(client.store.state.rows).toHaveLength(3);
    });
    expect(client.store.state.lastQuery).toMatch(/"weight" >= 70/);
    expect(client.store.state.lastQuery).not.toMatch(/run/);

    client.destroy();
  });

  test('a clause whose source has no id is never skipped', async () => {
    const $sel = Selection.intersect();
    // No `id` on the source: immune to skipSources regardless of its contents.
    $sel.update({
      source: {},
      value: 'swim',
      fields: [],
      predicate: eq('sport', literal('swim')),
    });

    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      filterBy: $sel,
      skipSources: new Set(['swim', 'anything']),
    });

    // The id-less clause still filters → the 4 swimmers.
    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.rows).toHaveLength(4);
    });
    expect(client.store.state.lastQuery).toMatch(/swim/);

    client.destroy();
  });
});
