import { Selection } from '@uwdata/mosaic-core';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  createAthletesDb,
  settle,
  waitFor,
} from '@nozzleio/test-support/duckdb';
import {
  createFacetClient,
  createFilterSet,
  createHistogramClient,
  createRowsClient,
} from '../src/index';
import type { FilterSpec, Persister } from '../src/index';
import type { TestDb } from '@nozzleio/test-support/duckdb';

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

describe('facet publish.into', () => {
  test('setSelected publishes a spec + clause; self-exclusion under crossfilter', async () => {
    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'sport',
      filterBy: $page,
      publish: { into: set, id: 'sport' },
    });
    // A sibling consumer of the same page Selection IS filtered by the clause.
    const rows = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      filterBy: $page,
      inputs: { orderBy: [{ column: 'id' }] },
    });

    await waitFor(() => {
      expect(facet.store.state.options).toEqual([
        { value: 'swim', count: 4 },
        { value: 'run', count: 2 },
      ]);
      expect(rows.store.state.rows).toHaveLength(6);
    });

    facet.setSelected(['swim']);

    // Spec landed in the set store; clause landed on the target Selection.
    expect(set.store.state.specs).toHaveLength(1);
    expect(set.store.state.specs[0]).toMatchObject({
      id: 'sport',
      column: 'sport',
      kind: 'point',
      value: 'swim',
    });
    expect($page.clauses).toHaveLength(1);
    expect(facet.store.state.selected).toEqual(['swim']);

    // Self-exclusion: the facet's own counts stay full-domain (its own clause
    // carries its mosaicClient), while the sibling rows client is filtered.
    await settle();
    expect(facet.store.state.options).toEqual([
      { value: 'swim', count: 4 },
      { value: 'run', count: 2 },
    ]);
    await waitFor(() => {
      expect(rows.store.state.rows).toHaveLength(4);
    });

    facet.destroy();
    rows.destroy();
    set.destroy();
  });

  test('external spec removal (set.remove) clears the facet without a republish loop', async () => {
    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'sport',
      publish: { into: set, id: 'sport' },
    });

    await waitFor(() => {
      expect(facet.store.state.status).toBe('success');
    });

    facet.setSelected(['swim']);
    expect(facet.store.state.selected).toEqual(['swim']);

    set.remove('sport');
    await waitFor(() => {
      expect(facet.store.state.selected).toEqual([]);
    });
    // No republish loop: the spec stays gone and its clause is cleared. Read
    // the synchronous `_resolved` view (`.clauses` is one tick stale once the
    // Selection has listeners).
    expect(set.store.state.specs).toHaveLength(0);
    expect($page._resolved).toHaveLength(0);

    facet.destroy();
    set.destroy();
  });

  test('a chip-bar $sel.reset() clears the facet', async () => {
    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'sport',
      publish: { into: set, id: 'sport' },
    });

    await waitFor(() => {
      expect(facet.store.state.status).toBe('success');
    });
    facet.setSelected(['run']);
    expect(set.store.state.specs).toHaveLength(1);

    // Global reset via the raw Selection; the set mirrors the drop into
    // spec removal, which the facet mirrors into cleared local state.
    $page.reset();
    await waitFor(() => {
      expect(facet.store.state.selected).toEqual([]);
      expect(set.store.state.specs).toHaveLength(0);
    });

    facet.destroy();
    set.destroy();
  });

  test('chip narrowing (removeChip) narrows a multi-select facet', async () => {
    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'name',
      select: 'multi',
      publish: { into: set, id: 'names' },
    });

    await waitFor(() => {
      expect(facet.store.state.status).toBe('success');
    });

    facet.setSelected(['Ada', 'Ed']);
    expect(facet.store.state.selected).toEqual(['Ada', 'Ed']);
    // points kind explodes into one chip per value.
    const chips = set.store.state.chips;
    expect(chips).toHaveLength(2);
    const adaChip = chips.find((c) => c.value === 'Ada');
    expect(adaChip?.exploded).toBe(true);

    set.removeChip(adaChip!);
    await waitFor(() => {
      expect(facet.store.state.selected).toEqual(['Ed']);
    });

    facet.destroy();
    set.destroy();
  });

  test('array column publishes a condition/list_has_any spec', async () => {
    await db.exec(`
      CREATE TABLE phrases(id INTEGER, phrase TEXT, keyword_groups VARCHAR[]);
      INSERT INTO phrases VALUES
        (1, 'alpha', ['brand', 'core']),
        (2, 'beta', ['brand']),
        (3, 'gamma', ['longtail']);
    `);
    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'phrases',
      column: 'keyword_groups',
      arrayColumn: true,
      select: 'multi',
      sort: 'alpha',
      publish: { into: set, id: 'kw' },
    });
    const rows = createRowsClient<{ id: number; phrase: string }>({
      coordinator: db.coordinator,
      query: 'phrases',
      filterBy: $page,
      inputs: { orderBy: [{ column: 'id' }] },
    });

    await waitFor(() => {
      expect(facet.store.state.status).toBe('success');
      expect(rows.store.state.rows).toHaveLength(3);
    });

    facet.setSelected(['brand']);
    expect(set.store.state.specs[0]).toMatchObject({
      id: 'kw',
      kind: 'condition',
      operator: 'list_has_any',
      value: ['brand'],
    });
    // list_has_any predicate carries no optimizer meta.
    expect($page.clauses[0]!.meta).toBeUndefined();
    await waitFor(() => {
      expect(rows.store.state.rows.map((r) => r.phrase)).toEqual([
        'alpha',
        'beta',
      ]);
    });

    facet.destroy();
    rows.destroy();
    set.destroy();
  });

  test('initial adopt: a pre-existing spec populates the facet and attaches its client', async () => {
    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });
    // Pre-populate the set (e.g. from set-level persistence) before the facet.
    set.set({ id: 'sport', column: 'sport', kind: 'point', value: 'run' });
    expect($page.clauses[0]!.clients).toBeUndefined();

    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'sport',
      filterBy: $page,
      publish: { into: set, id: 'sport' },
    });

    // The facet adopts the spec value on prepare, before/at first success.
    await waitFor(() => {
      expect(facet.store.state.selected).toEqual(['run']);
    });
    // The published clause now carries the facet's mosaicClient (self-exclusion).
    expect($page._resolved[0]!.clients?.has(facet.mosaicClient)).toBe(true);

    facet.destroy();
    set.destroy();
  });

  test('persist + publish.into warns and never calls the client persister', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const read = vi.fn(() => null);
    const write = vi.fn();
    const persister: Persister<Array<unknown>> = { read, write };

    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'sport',
      publish: { into: set, id: 'sport' },
      persist: persister,
    });

    await waitFor(() => {
      expect(facet.store.state.status).toBe('success');
    });
    facet.setSelected(['swim']);
    await settle();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('the set owns persistence'),
    );
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();

    warn.mockRestore();
    facet.destroy();
    set.destroy();
  });
});

describe('histogram publish.into', () => {
  test('setRange publishes an interval spec; external removal clears the range', async () => {
    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });
    const hist = createHistogramClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'weight',
      extent: [50, 100],
      publish: { into: set, id: 'weight' },
    });

    await waitFor(() => {
      expect(hist.store.state.status).toBe('success');
    });

    hist.setRange([60, 80]);
    expect(set.store.state.specs[0]).toMatchObject({
      id: 'weight',
      column: 'weight',
      kind: 'interval',
      value: [60, 80],
    });
    expect(hist.store.state.range).toEqual([60, 80]);
    expect($page.clauses[0]!.meta).toEqual({ type: 'interval' });

    set.remove('weight');
    await waitFor(() => {
      expect(hist.store.state.range).toBeNull();
    });

    hist.destroy();
    set.destroy();
  });
});

describe('rows publish.into', () => {
  test('single-field selection publishes a flat points spec; external removal clears', async () => {
    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });
    const rows = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      inputs: { orderBy: [{ column: 'id' }] },
      publish: { select: { into: set, id: 'picked', columns: ['id'] } },
    });

    await waitFor(() => {
      expect(rows.store.state.rows).toHaveLength(6);
    });

    rows.selectRows([rows.store.state.rows[0]!, rows.store.state.rows[1]!]);
    expect(set.store.state.specs[0]).toMatchObject({
      id: 'picked',
      column: 'id',
      kind: 'points',
      value: [1, 2],
    });
    expect($page.clauses).toHaveLength(1);

    set.remove('picked');
    await settle();
    expect(set.store.state.specs).toHaveLength(0);
    expect($page.clauses).toHaveLength(0);

    rows.destroy();
    set.destroy();
  });

  test('multi-field selection publishes a tuple envelope spec', async () => {
    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });
    const rows = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      inputs: { orderBy: [{ column: 'id' }] },
      publish: {
        select: { into: set, id: 'picked', columns: ['name', 'sport'] },
      },
    });

    await waitFor(() => {
      expect(rows.store.state.rows).toHaveLength(6);
    });

    rows.selectRows([rows.store.state.rows[0]!]);
    expect(set.store.state.specs[0]).toMatchObject({
      id: 'picked',
      column: 'name',
      kind: 'points',
      value: { columns: ['name', 'sport'], tuples: [['Ada', 'swim']] },
    });

    rows.destroy();
    set.destroy();
  });
});

describe('rows publish.into — remount / adopt self-exclusion', () => {
  /** The `select:<id>` clause currently on `$page`, if any. */
  function pickedClause(page: Selection, id: string) {
    return page._resolved.find(
      (clause) => (clause.source as { id?: unknown }).id === id,
    );
  }

  test('a destroyed client never re-keys the surviving clause to itself', async () => {
    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });
    // A pre-existing selection spec (e.g. survived an enlarge/return move).
    set.set({ id: 'picked', column: 'id', kind: 'points', value: [1] });
    expect(pickedClause($page, 'picked')?.clients).toBeUndefined();

    const rows = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      filterBy: $page,
      inputs: { orderBy: [{ column: 'id' }] },
      publish: { select: { into: set, id: 'picked', columns: ['id'] } },
    });
    const deadClient = rows.mosaicClient;
    // Unmount before the deferred prepare/adopt microtask runs.
    rows.destroy();
    await settle();

    // The guard held: the surviving clause was NOT re-keyed to the dead client,
    // so a live sibling's self-exclusion is not poisoned.
    const clause = pickedClause($page, 'picked');
    expect(clause).toBeDefined();
    expect(clause!.clients?.has(deadClient) ?? false).toBe(false);
    // The spec itself survives (the set owns it).
    expect(set.store.state.specs.map((s) => s.id)).toEqual(['picked']);

    set.destroy();
  });

  test('a remounted client adopts the surviving spec, self-excludes, and re-queries to the full domain', async () => {
    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });

    // First mount: publish a one-row selection, then unmount. The set keeps the
    // spec across the move; its clause stays keyed to the now-dead client.
    const first = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      filterBy: $page,
      inputs: { orderBy: [{ column: 'id' }] },
      publish: { select: { into: set, id: 'picked', columns: ['id'] } },
    });
    await waitFor(() => {
      expect(first.store.state.rows).toHaveLength(6);
    });
    first.selectRows([{ id: 1, name: 'Ada', sport: 'swim', weight: 50 }]);
    await settle();
    const firstClient = first.mosaicClient;
    first.destroy();
    // The surviving clause is still keyed to the destroyed first client — the
    // stale-clause ordering the remounted client must recover from.
    expect(pickedClause($page, 'picked')?.clients?.has(firstClient)).toBe(true);

    // Reproduce the async ordering that makes the fix necessary. A Selection's
    // synchronous `update()` refreshes `_resolved` immediately, but `predicate`
    // (and `.clauses`) reads the last *emitted* value, which lags behind while
    // a prior 'value' emit is still in flight. Occupy that dispatch queue with a
    // promise-returning listener so the remount's re-key is enqueued, not
    // applied synchronously — exactly the composed-context timing in the app.
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const hold = (): Promise<void> => gate;
    $page.addEventListener('value', hold);
    // Kick a 'value' emit so the queue has a pending (unresolved) dispatch. The
    // emitted value is the current one, so no clause state changes here.
    $page.emit('value', $page.clauses);

    // Second mount: same spec id + filterBy. Its adopt re-keys the clause to
    // itself, but that re-key is now queued behind the held emit, so the fresh
    // client's first query still reads the stale (first-client-keyed) clause and
    // filters itself down to just its own selected row.
    const second = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      filterBy: $page,
      inputs: { orderBy: [{ column: 'id' }] },
      publish: { select: { into: set, id: 'picked', columns: ['id'] } },
    });
    await waitFor(() => {
      expect(second.store.state.rows).toEqual([
        expect.objectContaining({ id: 1 }),
      ]);
    });

    // Release the held emit: the queued re-key now lands on the published value,
    // self-excluding the clause for the live client. The library re-queries on
    // that event, so the card recovers to the FULL domain (all 6 rows) rather
    // than staying filtered by its own selection.
    releaseGate();
    await waitFor(() => {
      const clause = pickedClause($page, 'picked');
      expect(clause?.clients?.has(second.mosaicClient)).toBe(true);
      expect(second.store.state.rows).toHaveLength(6);
    });

    $page.removeEventListener('value', hold);
    second.destroy();
    set.destroy();
  });
});

describe('filter-set hydration resilience', () => {
  test('one unknown-kind persisted spec is skipped; a valid sibling still applies', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stored: Array<FilterSpec> = [
      { id: 'bad', column: 'sport', kind: 'no_such_kind', value: 'x' },
      { id: 'ok', column: 'sport', kind: 'point', value: 'swim' },
    ];
    const persister: Persister<Array<FilterSpec>> = {
      read: () => stored,
      write: () => {},
    };

    const $where = Selection.crossfilter();
    const set = createFilterSet({
      targets: { where: $where },
      persist: persister,
    });

    // The valid spec applied despite the unknown-kind spec throwing.
    expect(set.store.state.specs.map((s) => s.id)).toEqual(['ok']);
    expect($where._resolved).toHaveLength(1);
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
    set.destroy();
  });
});
