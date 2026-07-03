import { Selection } from '@uwdata/mosaic-core';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  createFacetClient,
  createHistogramClient,
  createRowsClient,
} from '../src/index';
import { createAthletesDb, settle, waitFor } from './test-utils';
import type { Persister } from '../src/index';
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

/** A simple in-memory persister with spies, standing in for consumer storage. */
function memoryPersister<TState>(
  initial: TState | null | Promise<TState | null | undefined> = null,
): {
  persister: Persister<TState>;
  read: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  writes: Array<{ state: TState | null; reason: string }>;
} {
  const writes: Array<{ state: TState | null; reason: string }> = [];
  const read = vi.fn(() => initial);
  const write = vi.fn((state: TState | null, context: { reason: string }) => {
    writes.push({ state, reason: context.reason });
  });
  return { persister: { read, write }, read, write, writes };
}

describe('facet persistence', () => {
  test('sync hydrate applies before the first query — no unfiltered→refiltered pair', async () => {
    const $page = Selection.crossfilter();
    const { persister } = memoryPersister<Array<unknown>>(['run']);
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'sport',
      filterBy: $page,
      publish: { as: $page },
      persist: persister,
    });

    await waitFor(() => {
      expect(facet.store.state.status).toBe('success');
    });
    // Hydration applied before the query settled: the clause is published…
    expect(facet.store.state.selected).toEqual(['run']);
    expect($page.clauses).toHaveLength(1);
    // …and the facet issued exactly one query (its own clause self-excludes,
    // so its options query is unfiltered — but no unfiltered→refiltered pair).
    const facetQueries = db.clientQueries.filter((sql) =>
      /group by/i.test(sql),
    );
    expect(facetQueries).toHaveLength(1);

    facet.destroy();
  });

  test('a hydrated facet filters a downstream rows client on its first query', async () => {
    const $page = Selection.crossfilter();
    const { persister } = memoryPersister<Array<unknown>>(['run']);
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'sport',
      filterBy: $page,
      publish: { as: $page },
      persist: persister,
    });
    const rows = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      filterBy: $page,
      inputs: { orderBy: [{ column: 'id' }] },
    });

    await waitFor(() => {
      expect(rows.store.state.rows.map((r) => r.name)).toEqual(['Ed', 'Fi']);
    });
    // The rows client never fetched the full six rows first.
    expect(rows.store.state.rows).toHaveLength(2);

    facet.destroy();
    rows.destroy();
  });

  test('async hydrate applies on resolve: first query unfiltered, then re-query', async () => {
    const $page = Selection.crossfilter();
    let resolveRead!: (v: Array<unknown> | null) => void;
    const pending = new Promise<Array<unknown> | null>((resolve) => {
      resolveRead = resolve;
    });
    const write = vi.fn();
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'sport',
      filterBy: $page,
      publish: { as: $page },
      persist: { read: () => pending, write },
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

    resolveRead(['run']);
    await waitFor(() => {
      expect(rows.store.state.rows.map((r) => r.name)).toEqual(['Ed', 'Fi']);
    });
    expect(facet.store.state.selected).toEqual(['run']);
    // Hydration is never written back.
    expect(write).not.toHaveBeenCalled();

    facet.destroy();
    rows.destroy();
  });

  test('async hydrate is discarded after a user interaction (dirty guard)', async () => {
    const $page = Selection.crossfilter();
    let resolveRead!: (v: Array<unknown> | null) => void;
    const pending = new Promise<Array<unknown> | null>((resolve) => {
      resolveRead = resolve;
    });
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'sport',
      filterBy: $page,
      publish: { as: $page },
      persist: { read: () => pending, write: vi.fn() },
    });

    await waitFor(() => {
      expect(facet.store.state.status).toBe('success');
    });

    facet.toggle('swim');
    expect(facet.store.state.selected).toEqual(['swim']);

    resolveRead(['run']);
    await settle();
    // User interaction wins over stale hydration.
    expect(facet.store.state.selected).toEqual(['swim']);

    facet.destroy();
  });

  test('async hydrate after destroy is a no-op', async () => {
    const $page = Selection.crossfilter();
    let resolveRead!: (v: Array<unknown> | null) => void;
    const pending = new Promise<Array<unknown> | null>((resolve) => {
      resolveRead = resolve;
    });
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'sport',
      filterBy: $page,
      publish: { as: $page },
      persist: { read: () => pending, write: vi.fn() },
    });

    await waitFor(() => {
      expect(facet.store.state.status).toBe('success');
    });
    facet.destroy();
    resolveRead(['run']);
    await settle();
    expect(facet.store.state.selected).toEqual([]);
    expect($page.clauses).toHaveLength(0);
  });

  test('echo suppression: write not called on sync hydrate', async () => {
    const $page = Selection.crossfilter();
    const { persister, write } = memoryPersister<Array<unknown>>(['run']);
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'sport',
      filterBy: $page,
      publish: { as: $page },
      persist: persister,
    });

    await waitFor(() => {
      expect(facet.store.state.selected).toEqual(['run']);
    });
    expect(write).not.toHaveBeenCalled();

    facet.destroy();
  });

  test('write reasons: toggle → update, clear → clear, external → external', async () => {
    const $page = Selection.crossfilter();
    const { persister, writes } = memoryPersister<Array<unknown>>(null);
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'sport',
      select: 'multi',
      filterBy: $page,
      publish: { as: $page },
      persist: persister,
    });

    await waitFor(() => {
      expect(facet.store.state.status).toBe('success');
    });

    facet.toggle('run');
    expect(writes.at(-1)).toEqual({ state: ['run'], reason: 'update' });

    facet.clear();
    expect(writes.at(-1)).toEqual({ state: null, reason: 'clear' });

    facet.toggle('swim');
    expect(writes.at(-1)).toEqual({ state: ['swim'], reason: 'update' });

    $page.reset();
    await waitFor(() => {
      expect(writes.at(-1)).toEqual({ state: null, reason: 'external' });
    });

    facet.destroy();
  });

  test('destroy produces zero writes', async () => {
    const $page = Selection.crossfilter();
    const { persister, writes } = memoryPersister<Array<unknown>>(null);
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'sport',
      filterBy: $page,
      publish: { as: $page },
      persist: persister,
    });

    await waitFor(() => {
      expect(facet.store.state.status).toBe('success');
    });
    facet.toggle('swim');
    const writesBefore = writes.length;

    facet.destroy();
    await settle();
    expect(writes.length).toBe(writesBefore);

    facet.destroy();
  });

  test('round-trip: persisted intent rebuilds an identical clause predicate', async () => {
    const $one = Selection.crossfilter();
    const { persister, writes } = memoryPersister<Array<unknown>>(null);
    const source = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'sport',
      select: 'multi',
      publish: { as: $one },
      persist: persister,
    });

    await waitFor(() => {
      expect(source.store.state.status).toBe('success');
    });
    source.toggle('run');
    source.toggle('swim');
    const stored = writes.at(-1)!.state;
    expect(stored).toEqual(['run', 'swim']);
    // `.clauses` is the last *emitted* state (one tick stale once listeners are
    // attached); `_resolved` is synchronous.
    const predicateOne = String($one._resolved[0]!.predicate);
    expect(predicateOne).toMatch(/run.*swim/);

    const $two = Selection.crossfilter();
    const restored = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'sport',
      select: 'multi',
      publish: { as: $two },
      persist: { read: () => stored, write: vi.fn() },
    });

    await waitFor(() => {
      expect($two._resolved).toHaveLength(1);
    });
    expect(String($two._resolved[0]!.predicate)).toBe(predicateOne);

    source.destroy();
    restored.destroy();
  });

  test('an empty persisted state is a hydration no-op', async () => {
    const $page = Selection.crossfilter();
    const { persister, write } = memoryPersister<Array<unknown>>([]);
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'sport',
      filterBy: $page,
      publish: { as: $page },
      persist: persister,
    });

    await waitFor(() => {
      expect(facet.store.state.status).toBe('success');
    });
    // The default state is already empty: nothing published, nothing written.
    expect($page._resolved).toHaveLength(0);
    expect(write).not.toHaveBeenCalled();

    facet.destroy();
  });

  test('persist without publish target warns and is ignored', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { persister, read } = memoryPersister<Array<unknown>>(['run']);
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'sport',
      persist: persister,
    });

    await waitFor(() => {
      expect(facet.store.state.status).toBe('success');
    });
    expect(read).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('persist'));

    warn.mockRestore();
    facet.destroy();
  });
});

describe('facet setSelected', () => {
  test('multi-select replaces the selection wholesale', async () => {
    const $page = Selection.crossfilter();
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'sport',
      select: 'multi',
      publish: { as: $page },
    });

    await waitFor(() => {
      expect(facet.store.state.status).toBe('success');
    });

    facet.setSelected(['run', 'swim']);
    expect(facet.store.state.selected).toEqual(['run', 'swim']);
    facet.setSelected(['run']);
    expect(facet.store.state.selected).toEqual(['run']);
    facet.setSelected([]);
    expect(facet.store.state.selected).toEqual([]);
    await waitFor(() => {
      expect($page._resolved).toHaveLength(0);
    });

    facet.destroy();
  });

  test('single-select keeps at most the first value', async () => {
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

    facet.setSelected(['run', 'swim']);
    expect(facet.store.state.selected).toEqual(['run']);

    facet.destroy();
  });
});

describe('histogram persistence', () => {
  test('sync hydrate applies the range before the first main query', async () => {
    const $page = Selection.crossfilter();
    const { persister, write } = memoryPersister<[number, number]>([60, 70]);
    const hist = createHistogramClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'weight',
      extent: [0, 100],
      inputs: { step: 10 },
      filterBy: $page,
      publish: { as: $page },
      persist: persister,
    });

    await waitFor(() => {
      expect(hist.store.state.status).toBe('success');
    });
    expect(hist.store.state.range).toEqual([60, 70]);
    expect($page.clauses).toHaveLength(1);
    // The first histogram main query already saw the range clause published;
    // self-exclusion keeps its own bins unaffected, but the clause exists.
    expect(write).not.toHaveBeenCalled();

    hist.destroy();
  });

  test('setRange(null) → clear; external reset → external', async () => {
    const $page = Selection.crossfilter();
    const { persister, writes } = memoryPersister<[number, number]>(null);
    const hist = createHistogramClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'weight',
      extent: [0, 100],
      filterBy: $page,
      publish: { as: $page },
      persist: persister,
    });

    await waitFor(() => {
      expect(hist.store.state.status).toBe('success');
    });

    hist.setRange([60, 70]);
    expect(writes.at(-1)).toEqual({ state: [60, 70], reason: 'update' });

    hist.setRange(null);
    expect(writes.at(-1)).toEqual({ state: null, reason: 'clear' });

    hist.setRange([50, 80]);
    $page.reset();
    await waitFor(() => {
      expect(writes.at(-1)).toEqual({ state: null, reason: 'external' });
    });

    hist.destroy();
  });

  test('round-trip: persisted range rebuilds an identical interval predicate', async () => {
    const $one = Selection.crossfilter();
    const { persister, writes } = memoryPersister<[number, number]>(null);
    const source = createHistogramClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'weight',
      extent: [0, 100],
      publish: { as: $one },
      persist: persister,
    });

    await waitFor(() => {
      expect(source.store.state.status).toBe('success');
    });
    source.setRange([60, 70]);
    const stored = writes.at(-1)!.state;
    const predicateOne = String($one._resolved[0]!.predicate);

    const $two = Selection.crossfilter();
    const restored = createHistogramClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'weight',
      extent: [0, 100],
      publish: { as: $two },
      persist: { read: () => stored, write: vi.fn() },
    });

    await waitFor(() => {
      expect($two._resolved).toHaveLength(1);
    });
    expect(String($two._resolved[0]!.predicate)).toBe(predicateOne);

    source.destroy();
    restored.destroy();
  });
});

describe('rows persistence', () => {
  test('sync hydrate filters the first query', async () => {
    const $picked = Selection.crossfilter();
    const { persister, write } = memoryPersister<Array<Array<unknown>>>([[5]]);
    // A second rows client consumes the selection as a filter.
    const consumer = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      filterBy: $picked,
      inputs: { orderBy: [{ column: 'id' }] },
    });
    const picker = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      inputs: { orderBy: [{ column: 'id' }] },
      publish: { select: { as: $picked, columns: ['id'] } },
      persist: persister,
    });

    await waitFor(() => {
      expect(consumer.store.state.rows.map((r) => r.id)).toEqual([5]);
    });
    expect($picked.clauses).toHaveLength(1);
    expect(write).not.toHaveBeenCalled();

    picker.destroy();
    consumer.destroy();
  });

  test('reasons: setSelectedValues → update, [] → clear, external → external', async () => {
    const $picked = Selection.crossfilter();
    const { persister, writes } = memoryPersister<Array<Array<unknown>>>(null);
    const picker = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      publish: { select: { as: $picked, columns: ['id'] } },
      persist: persister,
    });

    await waitFor(() => {
      expect(picker.store.state.status).toBe('success');
    });

    picker.setSelectedValues([[3], [4]]);
    expect(writes.at(-1)).toEqual({ state: [[3], [4]], reason: 'update' });

    picker.setSelectedValues([]);
    expect(writes.at(-1)).toEqual({ state: null, reason: 'clear' });

    picker.setSelectedValues([[3]]);
    $picked.reset();
    await waitFor(() => {
      expect(writes.at(-1)).toEqual({ state: null, reason: 'external' });
    });

    picker.destroy();
  });

  test('destroy produces zero writes', async () => {
    const $picked = Selection.crossfilter();
    const { persister, writes } = memoryPersister<Array<Array<unknown>>>(null);
    const picker = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      publish: { select: { as: $picked, columns: ['id'] } },
      persist: persister,
    });

    await waitFor(() => {
      expect(picker.store.state.status).toBe('success');
    });
    picker.setSelectedValues([[3]]);
    const writesBefore = writes.length;

    picker.destroy();
    await settle();
    expect(writes.length).toBe(writesBefore);
  });

  test('round-trip: setSelectedValues matches selectRows predicate', async () => {
    const $one = Selection.crossfilter();
    const viaRows = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      publish: { select: { as: $one, columns: ['id'] } },
    });
    await waitFor(() => {
      expect(viaRows.store.state.status).toBe('success');
    });
    viaRows.selectRows([{ id: 3, name: 'Cy', sport: 'swim', weight: 80 }]);
    const predicateRows = String($one._resolved[0]!.predicate);

    const $two = Selection.crossfilter();
    const viaTuples = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      publish: { select: { as: $two, columns: ['id'] } },
    });
    await waitFor(() => {
      expect(viaTuples.store.state.status).toBe('success');
    });
    viaTuples.setSelectedValues([[3]]);
    expect(String($two._resolved[0]!.predicate)).toBe(predicateRows);

    viaRows.destroy();
    viaTuples.destroy();
  });

  test('setSelectedValues rejects tuples of the wrong arity', async () => {
    const $picked = Selection.crossfilter();
    const picker = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      publish: { select: { as: $picked, columns: ['id', 'sport'] } },
    });

    await waitFor(() => {
      expect(picker.store.state.status).toBe('success');
    });
    expect(() => picker.setSelectedValues([[3]])).toThrowError(
      /align with publish\.select\.columns/,
    );

    picker.destroy();
  });

  test('external clear resets tracking independent of persistence', async () => {
    const $picked = Selection.crossfilter();
    const picker = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      publish: { select: { as: $picked, columns: ['id'] } },
    });

    await waitFor(() => {
      expect(picker.store.state.status).toBe('success');
    });
    picker.setSelectedValues([[3]]);
    expect($picked.clauses).toHaveLength(1);

    $picked.reset();
    await settle();
    // Tracking cleared: a subsequent [] publish is a no-op clause removal, and
    // re-selecting works from a clean slate.
    picker.setSelectedValues([[4]]);
    expect($picked.clauses).toHaveLength(1);

    picker.destroy();
  });

  test('stale persisted tuples of the wrong arity warn instead of killing the client', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const $picked = Selection.crossfilter();
    // Persisted before the dashboard's select columns changed: one value per
    // tuple, but the client now publishes two columns.
    const { persister, write } = memoryPersister<Array<Array<unknown>>>([[3]]);
    const picker = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      inputs: { orderBy: [{ column: 'id' }] },
      publish: { select: { as: $picked, columns: ['id', 'sport'] } },
      persist: persister,
    });

    // Hydration is rejected (arity mismatch), but the client still queries.
    await waitFor(() => {
      expect(picker.store.state.status).toBe('success');
    });
    expect(picker.store.state.rows).toHaveLength(6);
    expect($picked._resolved).toHaveLength(0);
    expect(write).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('could not be hydrated'),
      expect.any(Error),
    );

    warn.mockRestore();
    picker.destroy();
  });

  test('persist without publish.select warns and is ignored', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { persister, read } = memoryPersister<Array<Array<unknown>>>([[3]]);
    const picker = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      persist: persister,
    });

    await waitFor(() => {
      expect(picker.store.state.status).toBe('success');
    });
    expect(read).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('persist'));

    warn.mockRestore();
    picker.destroy();
  });
});
