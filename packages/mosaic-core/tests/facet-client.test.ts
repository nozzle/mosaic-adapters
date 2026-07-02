import { Selection, clausePoint } from '@uwdata/mosaic-core';
import { beforeEach, describe, expect, test } from 'vitest';

import { createFacetClient, createRowsClient } from '../src/index';
import { createAthletesDb, settle, waitFor } from './test-utils';
import type { TestDb } from './test-utils';

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

describe('facet options', () => {
  test('distinct values with counts, count-sorted by default', async () => {
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'sport',
    });

    await waitFor(() => {
      expect(facet.store.state.status).toBe('success');
    });
    expect(facet.store.state.options).toEqual([
      { value: 'swim', count: 4 },
      { value: 'run', count: 2 },
    ]);

    facet.destroy();
  });

  test('alpha sort and counts: false', async () => {
    const alpha = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'sport',
      sort: 'alpha',
    });
    const bare = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'sport',
      counts: false,
    });

    await waitFor(() => {
      expect(alpha.store.state.status).toBe('success');
      expect(bare.store.state.status).toBe('success');
    });
    expect(alpha.store.state.options.map((o) => o.value)).toEqual([
      'run',
      'swim',
    ]);
    // Without counts the sort falls back to alpha and options carry no count.
    expect(bare.store.state.options).toEqual([
      { value: 'run' },
      { value: 'swim' },
    ]);

    alpha.destroy();
    bare.destroy();
  });

  test('search and limit are serializable inputs; each change is one query', async () => {
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'name',
      sort: 'alpha',
    });

    await waitFor(() => {
      expect(facet.store.state.options).toHaveLength(6);
    });
    const queriesAfterInit = db.clientQueries.length;

    facet.setInputs({ search: 'a' });
    await waitFor(() => {
      expect(facet.store.state.options.map((o) => o.value)).toEqual(['Ada']);
    });
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);

    facet.setInputs({ search: undefined, limit: 2 });
    await waitFor(() => {
      expect(facet.store.state.options.map((o) => o.value)).toEqual([
        'Ada',
        'Bo',
      ]);
    });
    expect(db.clientQueries.length).toBe(queriesAfterInit + 2);

    facet.destroy();
  });
});

describe('facet publishing', () => {
  test('single-select toggle publishes a point clause; re-toggle clears', async () => {
    const $page = Selection.crossfilter();
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'sport',
      filterBy: $page,
      publish: { as: $page },
    });
    const rows = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      filterBy: $page,
      inputs: { orderBy: [{ column: 'id' }] },
    });

    await waitFor(() => {
      expect(facet.store.state.status).toBe('success');
      expect(rows.store.state.rows).toHaveLength(6);
    });

    facet.toggle('run');
    expect(facet.store.state.selected).toEqual(['run']);
    expect($page.clauses).toHaveLength(1);
    expect($page.clauses[0]!.meta).toEqual({ type: 'point' });
    expect($page.clauses[0]!.clients?.has(facet.mosaicClient)).toBe(true);
    await waitFor(() => {
      expect(rows.store.state.rows.map((r) => r.name)).toEqual(['Ed', 'Fi']);
    });

    // Toggling another value replaces the clause (single-select).
    facet.toggle('swim');
    expect(facet.store.state.selected).toEqual(['swim']);
    expect($page.clauses).toHaveLength(1);
    await waitFor(() => {
      expect(rows.store.state.rows).toHaveLength(4);
    });

    // Toggling the active value clears.
    facet.toggle('swim');
    expect(facet.store.state.selected).toEqual([]);
    expect($page.clauses).toHaveLength(0);
    await waitFor(() => {
      expect(rows.store.state.rows).toHaveLength(6);
    });

    facet.destroy();
    rows.destroy();
  });

  test('multi-select accumulates values into one IN clause', async () => {
    const $page = Selection.crossfilter();
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'name',
      select: 'multi',
      publish: { as: $page },
    });
    const rows = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      filterBy: $page,
      inputs: { orderBy: [{ column: 'id' }] },
    });

    await waitFor(() => {
      expect(rows.store.state.rows).toHaveLength(6);
    });

    facet.toggle('Ada');
    facet.toggle('Ed');
    expect(facet.store.state.selected).toEqual(['Ada', 'Ed']);
    expect($page.clauses).toHaveLength(1);
    await waitFor(() => {
      expect(rows.store.state.rows.map((r) => r.name)).toEqual(['Ada', 'Ed']);
    });

    // Toggling a member out shrinks the clause; clear() removes it.
    facet.toggle('Ada');
    await waitFor(() => {
      expect(rows.store.state.rows.map((r) => r.name)).toEqual(['Ed']);
    });
    facet.clear();
    expect($page.clauses).toHaveLength(0);
    await waitFor(() => {
      expect(rows.store.state.rows).toHaveLength(6);
    });

    facet.destroy();
    rows.destroy();
  });

  test('facet cascade under crossfilter: peers filter the options, its own clause never does', async () => {
    const $page = Selection.crossfilter();
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'sport',
      filterBy: $page,
      publish: { as: $page },
    });

    await waitFor(() => {
      expect(facet.store.state.options).toEqual([
        { value: 'swim', count: 4 },
        { value: 'run', count: 2 },
      ]);
    });

    // Its own clause: options must not change (self-exclusion).
    facet.toggle('run');
    await settle();
    expect(facet.store.state.options).toEqual([
      { value: 'swim', count: 4 },
      { value: 'run', count: 2 },
    ]);

    // A peer clause (different source, no clients overlap) cascades the counts.
    $page.update(
      clausePoint('name', 'Ada', { source: { peer: true } as object }),
    );
    await waitFor(() => {
      expect(facet.store.state.options).toEqual([{ value: 'swim', count: 1 }]);
    });

    facet.destroy();
  });

  test('array columns explode options and publish list_has_any', async () => {
    await db.exec(`
      CREATE TABLE phrases(id INTEGER, phrase TEXT, keyword_groups VARCHAR[]);
      INSERT INTO phrases VALUES
        (1, 'alpha', ['brand', 'core']),
        (2, 'beta', ['brand']),
        (3, 'gamma', ['longtail']),
        (4, 'delta', NULL);
    `);

    const $page = Selection.crossfilter();
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'phrases',
      column: 'keyword_groups',
      arrayColumn: true,
      select: 'multi',
      sort: 'alpha',
      publish: { as: $page },
    });
    const rows = createRowsClient<{ id: number; phrase: string }>({
      coordinator: db.coordinator,
      query: 'phrases',
      filterBy: $page,
      inputs: { orderBy: [{ column: 'id' }] },
    });

    await waitFor(() => {
      expect(facet.store.state.options).toEqual([
        { value: 'brand', count: 2 },
        { value: 'core', count: 1 },
        { value: 'longtail', count: 1 },
      ]);
      expect(rows.store.state.rows).toHaveLength(4);
    });

    facet.toggle('core');
    facet.toggle('longtail');
    expect($page.clauses).toHaveLength(1);
    // Subquery-free list predicate; no optimizer meta on list matches.
    expect($page.clauses[0]!.meta).toBeUndefined();
    await waitFor(() => {
      expect(rows.store.state.rows.map((r) => r.phrase)).toEqual([
        'alpha',
        'gamma',
      ]);
    });

    facet.clear();
    await waitFor(() => {
      expect(rows.store.state.rows).toHaveLength(4);
    });

    facet.destroy();
    rows.destroy();
  });

  test('an external Selection reset clears the tracked selection', async () => {
    const $page = Selection.crossfilter();
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'sport',
      publish: { as: $page },
    });

    await waitFor(() => {
      expect(facet.store.state.status).toBe('success');
    });

    facet.toggle('swim');
    expect(facet.store.state.selected).toEqual(['swim']);

    // Chip-bar/global-reset path: the clause is removed by someone else.
    $page.reset();
    await waitFor(() => {
      expect(facet.store.state.selected).toEqual([]);
    });

    facet.destroy();
  });

  test('destroy() clears the published clause', async () => {
    const $page = Selection.crossfilter();
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'sport',
      publish: { as: $page },
    });

    await waitFor(() => {
      expect(facet.store.state.status).toBe('success');
    });
    facet.toggle('swim');
    expect($page.clauses).toHaveLength(1);

    facet.destroy();
    // Selection events dispatch async once the Selection has listeners; the
    // destroy-time clear lands on the next tick.
    await waitFor(() => {
      expect($page.clauses).toHaveLength(0);
    });
  });
});
