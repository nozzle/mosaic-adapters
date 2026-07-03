import { Selection } from '@uwdata/mosaic-core';
import { Query } from '@uwdata/mosaic-sql';
import { createFilterSet, createRowsClient } from '@nozzleio/mosaic-core';
import { beforeEach, describe, expect, test } from 'vitest';

import { createFilterBridge } from '../src/index';
import {
  createAthletesDb,
  settle,
  waitFor,
} from '../../mosaic-core/tests/test-utils';
import type { FilterSet } from '@nozzleio/mosaic-core';
import type { SelectionClause } from '@uwdata/mosaic-core';
import type { ColumnFiltersState } from '@tanstack/table-core';
import type { FilterBridgeColumns } from '../src/index';
import type { TestDb } from '../../mosaic-core/tests/test-utils';

function predicateSql(clause: SelectionClause | undefined): string {
  return String(clause?.predicate);
}

/**
 * The set attaches a `value` listener to every target, after which
 * `resolved(selection)` lags one emitted event behind; `_resolved` is upstream's
 * always-current resolution state, so tests read that.
 */
function resolved(selection: Selection): Array<SelectionClause> {
  return selection._resolved;
}

function countValueEvents(selection: Selection): () => number {
  let events = 0;
  selection.addEventListener('value', () => {
    events += 1;
  });
  return () => events;
}

function makeSet(target: Selection): FilterSet {
  return createFilterSet({ targets: { where: target } });
}

describe('clause kinds', () => {
  /** Publish one column-filter through the bridge and read the set's clause. */
  function publish(
    columns: FilterBridgeColumns,
    id: string,
    value: unknown,
  ): SelectionClause | undefined {
    const selection = Selection.intersect();
    const bridge = createFilterBridge({ set: makeSet(selection), columns });
    bridge.setFilters([{ id, value }]);
    return resolved(selection)[0];
  }

  test('equals maps to a point spec without self-exclusion', () => {
    const clause = publish({ sport: { clause: 'equals' } }, 'sport', 'swim');
    expect(clause?.meta).toEqual({ type: 'point' });
    expect(clause?.clients).toBeUndefined();
    expect(predicateSql(clause)).toContain(`'swim'`);
  });

  test('equals with an explicit null matches SQL NULLs', () => {
    const clause = publish({ sport: { clause: 'equals' } }, 'sport', null);
    expect(predicateSql(clause)).toContain('IS NULL');
  });

  test('ilike maps to a case-insensitive contains match', () => {
    const clause = publish({ name: { clause: 'ilike' } }, 'name', 'AdA');
    expect(clause?.meta).toEqual({ type: 'match', method: 'contains' });
    // Case folding happens in SQL: contains(lower("name"), lower('AdA')).
    const sql = predicateSql(clause);
    expect(sql).toContain('lower');
    expect(sql).toContain(`'AdA'`);
  });

  test('prefix maps to a prefix match', () => {
    const clause = publish({ name: { clause: 'prefix' } }, 'name', 'Ad');
    expect(clause?.meta).toEqual({ type: 'match', method: 'prefix' });
  });

  test('range with both bounds maps to a BETWEEN interval', () => {
    const clause = publish({ weight: { clause: 'range' } }, 'weight', [60, 80]);
    expect(clause?.meta).toMatchObject({ type: 'interval' });
    expect(predicateSql(clause)).toContain('BETWEEN');
  });

  test('half-open ranges use plain comparisons and carry no optimizer meta', () => {
    const from = publish({ weight: { clause: 'range' } }, 'weight', [
      70,
      undefined,
    ]);
    expect(from?.meta).toBeUndefined();
    expect(predicateSql(from)).toContain('>=');

    const upTo = publish({ weight: { clause: 'range' } }, 'weight', [null, 70]);
    expect(upTo?.meta).toBeUndefined();
    expect(predicateSql(upTo)).toContain('<=');
  });

  test('range coerces numeric strings and treats junk bounds as open', () => {
    const clause = publish({ weight: { clause: 'range' } }, 'weight', [
      '60',
      'not-a-number',
    ]);
    expect(clause?.value).toEqual([60, null]);
    expect(predicateSql(clause)).toContain('>=');
  });

  test('date-range coerces bounds to Date literals', () => {
    const clause = publish({ joined: { clause: 'date-range' } }, 'joined', [
      '2024-01-01',
      new Date(Date.UTC(2024, 5, 30)),
    ]);
    expect(clause?.meta).toMatchObject({ type: 'interval' });
    const sql = predicateSql(clause);
    expect(sql).toContain(`DATE '2024-1-1'`);
    expect(sql).toContain(`DATE '2024-6-30'`);
  });

  test('in maps to a multi-point clause; scalars become single-element lists', () => {
    const list = publish({ sport: { clause: 'in' } }, 'sport', ['swim', 'run']);
    expect(list?.meta).toEqual({ type: 'point' });
    expect(predicateSql(list)).toContain('IN');

    const scalar = publish({ sport: { clause: 'in' } }, 'sport', 'swim');
    // The bridge writes a plain-array spec value; the points kind explodes it.
    expect(scalar?.value).toEqual(['swim']);
  });

  test('columns map TanStack ids onto different SQL columns', () => {
    const clause = publish(
      { fullName: { column: 'full_name', clause: 'ilike' } },
      'fullName',
      'ada',
    );
    expect(predicateSql(clause)).toContain('full_name');
  });

  test('dotted columns become struct access, not one quoted identifier', () => {
    const clause = publish(
      { paa_question: { column: 'related_phrase.phrase', clause: 'ilike' } },
      'paa_question',
      'how to',
    );
    const sql = predicateSql(clause);
    expect(sql).toContain('"related_phrase"."phrase"');
    expect(sql).not.toContain('"related_phrase.phrase"');
  });

  test('clause sources carry {id, column} descriptors for downstream labeling', () => {
    const clause = publish(
      { paa_question: { column: 'related_phrase.phrase', clause: 'ilike' } },
      'paa_question',
      'how to',
    );
    expect(clause?.source).toMatchObject({
      id: 'paa_question',
      column: 'related_phrase.phrase',
    });
  });

  test('label and target from the column config carry onto the spec', () => {
    const $where = Selection.intersect();
    const $other = Selection.intersect();
    const set = createFilterSet({ targets: { where: $where, other: $other } });
    const bridge = createFilterBridge({
      set,
      columns: {
        domain: { clause: 'ilike', label: 'Domain', target: 'other' },
      },
    });
    bridge.setFilters([{ id: 'domain', value: 'reddit' }]);

    const spec = set.store.state.specs.find((s) => s.id === 'domain');
    expect(spec?.label).toBe('Domain');
    expect(spec?.target).toBe('other');
    // The clause landed on the named target, not the default `where`.
    expect(resolved($other)).toHaveLength(1);
    expect(resolved($where)).toHaveLength(0);
  });

  test('idPrefix namespaces the managed spec ids', () => {
    const selection = Selection.intersect();
    const set = makeSet(selection);
    const bridge = createFilterBridge({
      set,
      idPrefix: 'detail:',
      columns: { domain: { clause: 'ilike' } },
    });
    bridge.setFilters([{ id: 'domain', value: 'reddit' }]);
    expect(set.store.state.specs.map((s) => s.id)).toEqual(['detail:domain']);
  });

  const emptyCases: Array<{
    name: string;
    columns: FilterBridgeColumns;
    id: string;
    value: unknown;
  }> = [
    {
      name: 'equals with undefined',
      columns: { sport: { clause: 'equals' } },
      id: 'sport',
      value: undefined,
    },
    {
      name: 'ilike with an empty string',
      columns: { name: { clause: 'ilike' } },
      id: 'name',
      value: '',
    },
    {
      name: 'prefix with null',
      columns: { name: { clause: 'prefix' } },
      id: 'name',
      value: null,
    },
    {
      name: 'range with both bounds open',
      columns: { weight: { clause: 'range' } },
      id: 'weight',
      value: [null, ''],
    },
    {
      name: 'range with a non-array value',
      columns: { weight: { clause: 'range' } },
      id: 'weight',
      value: 60,
    },
    {
      name: 'date-range with unparseable bounds',
      columns: { joined: { clause: 'date-range' } },
      id: 'joined',
      value: ['nope', undefined],
    },
    {
      name: 'in with an empty array',
      columns: { sport: { clause: 'in' } },
      id: 'sport',
      value: [],
    },
  ];

  test.each(emptyCases)(
    '$name writes no spec and publishes nothing',
    async ({ columns, id, value }) => {
      const selection = Selection.intersect();
      const set = makeSet(selection);
      const events = countValueEvents(selection);
      const bridge = createFilterBridge({ set, columns });
      bridge.setFilters([{ id, value }]);
      await settle();
      expect(set.store.state.specs).toHaveLength(0);
      expect(resolved(selection)).toHaveLength(0);
      expect(events()).toBe(0);
    },
  );
});

describe('spec lifecycle', () => {
  const columns: FilterBridgeColumns = {
    name: { clause: 'ilike' },
    sport: { clause: 'equals' },
  };

  test('filter changes replace the spec (stable id), never accumulate', () => {
    const selection = Selection.intersect();
    const set = makeSet(selection);
    const bridge = createFilterBridge({ set, columns });

    bridge.setFilters([{ id: 'name', value: 'ada' }]);
    expect(set.store.state.specs).toHaveLength(1);
    expect(resolved(selection)).toHaveLength(1);
    const firstSource = resolved(selection)[0]?.source;

    bridge.setFilters([{ id: 'name', value: 'bo' }]);
    expect(set.store.state.specs).toHaveLength(1);
    expect(resolved(selection)).toHaveLength(1);
    expect(resolved(selection)[0]?.source).toBe(firstSource);
    expect(predicateSql(resolved(selection)[0])).toContain(`'bo'`);
  });

  test('value-equal filter state writes nothing to the set (echo suppression)', async () => {
    const selection = Selection.intersect();
    const set = makeSet(selection);
    const events = countValueEvents(selection);
    const bridge = createFilterBridge({ set, columns });

    bridge.setFilters([
      { id: 'name', value: 'ada' },
      { id: 'sport', value: 'swim' },
    ]);
    await settle();
    const eventsAfterPublish = events();
    expect(eventsAfterPublish).toBeGreaterThan(0);
    expect(resolved(selection)).toHaveLength(2);

    // Fresh identities, equal content — the render-loop echo shape.
    bridge.setFilters([
      { id: 'name', value: 'ada' },
      { id: 'sport', value: 'swim' },
    ]);
    bridge.setColumns({ ...columns });
    await settle();
    expect(events()).toBe(eventsAfterPublish);
    expect(resolved(selection)).toHaveLength(2);
  });

  test('clearing one column removes exactly its spec and clause', () => {
    const selection = Selection.intersect();
    const set = makeSet(selection);
    const bridge = createFilterBridge({ set, columns });

    bridge.setFilters([
      { id: 'name', value: 'ada' },
      { id: 'sport', value: 'swim' },
    ]);
    expect(resolved(selection)).toHaveLength(2);

    bridge.setFilters([{ id: 'sport', value: 'swim' }]);
    expect(set.store.state.specs.map((s) => s.id)).toEqual(['sport']);
    expect(resolved(selection)).toHaveLength(1);
    expect(predicateSql(resolved(selection)[0])).toContain(`'swim'`);
  });

  test('unconfigured columns are ignored', async () => {
    const selection = Selection.intersect();
    const set = makeSet(selection);
    const events = countValueEvents(selection);
    const bridge = createFilterBridge({ set, columns });

    bridge.setFilters([{ id: 'mystery', value: 'x' }]);
    await settle();
    expect(set.store.state.specs).toHaveLength(0);
    expect(resolved(selection)).toHaveLength(0);
    expect(events()).toBe(0);
  });

  test('destroy removes every managed spec and disables the bridge', () => {
    const selection = Selection.intersect();
    const set = makeSet(selection);
    const bridge = createFilterBridge({ set, columns });

    bridge.setFilters([
      { id: 'name', value: 'ada' },
      { id: 'sport', value: 'swim' },
    ]);
    expect(resolved(selection)).toHaveLength(2);

    bridge.destroy();
    expect(bridge.destroyed).toBe(true);
    expect(set.store.state.specs).toHaveLength(0);
    expect(resolved(selection)).toHaveLength(0);

    bridge.setFilters([{ id: 'name', value: 'ada' }]);
    expect(resolved(selection)).toHaveLength(0);
  });

  test('setColumns rewrites an active filter under its new clause kind', () => {
    const selection = Selection.intersect();
    const set = makeSet(selection);
    const bridge = createFilterBridge({
      set,
      columns: { sport: { clause: 'equals' } },
    });

    bridge.setFilters([{ id: 'sport', value: 'swim' }]);
    expect(resolved(selection)[0]?.meta).toEqual({ type: 'point' });
    const source = resolved(selection)[0]?.source;

    bridge.setColumns({ sport: { clause: 'ilike' } });
    expect(resolved(selection)).toHaveLength(1);
    expect(resolved(selection)[0]?.source).toBe(source);
    expect(resolved(selection)[0]?.meta).toEqual({
      type: 'match',
      method: 'contains',
    });
  });

  test('removing a column config clears its spec', () => {
    const selection = Selection.intersect();
    const set = makeSet(selection);
    const bridge = createFilterBridge({ set, columns });

    bridge.setFilters([{ id: 'name', value: 'ada' }]);
    expect(resolved(selection)).toHaveLength(1);

    bridge.setColumns({ sport: { clause: 'equals' } });
    expect(set.store.state.specs).toHaveLength(0);
    expect(resolved(selection)).toHaveLength(0);
  });
});

describe('external changes via the set store', () => {
  const columns: FilterBridgeColumns = {
    name: { clause: 'ilike' },
    sport: { clause: 'equals' },
  };

  test('an external spec removal is reported through onExternalChange', () => {
    const selection = Selection.intersect();
    const set = makeSet(selection);
    const reported: Array<ColumnFiltersState> = [];
    const bridge = createFilterBridge({
      set,
      columns,
      onExternalChange: (filters) => {
        reported.push(filters);
      },
    });

    bridge.setFilters([
      { id: 'name', value: 'ada' },
      { id: 'sport', value: 'swim' },
    ]);
    expect(resolved(selection)).toHaveLength(2);

    // A chip bar removes exactly one spec.
    set.remove('name');

    expect(reported.at(-1)).toEqual([{ id: 'sport', value: 'swim' }]);
    expect(resolved(selection)).toHaveLength(1);
  });

  test('a global reset clears every managed spec and reports empty state', () => {
    const selection = Selection.intersect();
    const set = makeSet(selection);
    const reported: Array<ColumnFiltersState> = [];
    const bridge = createFilterBridge({
      set,
      columns,
      onExternalChange: (filters) => {
        reported.push(filters);
      },
    });

    bridge.setFilters([
      { id: 'name', value: 'ada' },
      { id: 'sport', value: 'swim' },
    ]);
    set.reset();

    expect(reported.at(-1)).toEqual([]);
    expect(resolved(selection)).toHaveLength(0);

    // The report hands ownership back to the consumer: whatever state it
    // syncs next is authoritative, so re-submitting a filter republishes.
    bridge.setFilters([{ id: 'name', value: 'ada' }]);
    expect(set.store.state.specs.map((s) => s.id)).toEqual(['name']);
  });

  test('without onExternalChange, TanStack state stays authoritative', () => {
    const selection = Selection.intersect();
    const set = makeSet(selection);
    const bridge = createFilterBridge({ set, columns });

    bridge.setFilters([{ id: 'name', value: 'ada' }]);
    set.remove('name');
    // No callback, no report; the bridge still drops its stale tracking...
    expect(resolved(selection)).toHaveLength(0);
    // ...so the next sync republishes even under an equal value (the old
    // "state-authoritative" contract), not just under a changed one.
    bridge.setFilters([{ id: 'name', value: 'ada' }]);
    expect(resolved(selection)).toHaveLength(1);
  });

  test('an external clause drop on the target is mirrored back too', async () => {
    // Reset a target Selection directly (not via the set): the set's own
    // external-clear listener removes the spec (on the async value event),
    // which the bridge mirrors through its store subscription.
    const selection = Selection.intersect();
    const set = makeSet(selection);
    const reported: Array<ColumnFiltersState> = [];
    const bridge = createFilterBridge({
      set,
      columns,
      onExternalChange: (filters) => {
        reported.push(filters);
      },
    });

    bridge.setFilters([{ id: 'name', value: 'ada' }]);
    expect(resolved(selection)).toHaveLength(1);

    selection.reset();
    await waitFor(() => {
      expect(reported.at(-1)).toEqual([]);
    });
    bridge.destroy();
  });
});

describe('hydration adoption', () => {
  const columns: FilterBridgeColumns = {
    name: { clause: 'ilike' },
    weight: { clause: 'range' },
  };

  test('specs already in the set under managed ids are adopted, not cleared', () => {
    const selection = Selection.intersect();
    const set = makeSet(selection);
    // Persisted state hydrated before the bridge mounts.
    set.set({ id: 'name', column: 'name', kind: 'match', value: 'ada' });
    expect(resolved(selection)).toHaveLength(1);

    const reported: Array<ColumnFiltersState> = [];
    createFilterBridge({
      set,
      columns,
      onExternalChange: (filters) => {
        reported.push(filters);
      },
    });

    // The bridge reports the inverted TanStack value; the clause survives.
    expect(reported).toHaveLength(1);
    expect(reported[0]).toEqual([{ id: 'name', value: 'ada' }]);
    expect(resolved(selection)).toHaveLength(1);
  });

  test('without a callback, pre-existing specs are left untouched', () => {
    const selection = Selection.intersect();
    const set = makeSet(selection);
    set.set({ id: 'name', column: 'name', kind: 'match', value: 'ada' });

    const bridge = createFilterBridge({ set, columns });
    // No callback: the bridge does not adopt or clear the spec.
    expect(resolved(selection)).toHaveLength(1);

    // It also does not track the spec, so its own reconcile leaves it alone.
    bridge.setFilters([]);
    expect(resolved(selection)).toHaveLength(1);
  });

  test('specs are adopted when setColumns first configures their column', () => {
    // The hook path: the bridge is constructed before its column config
    // arrives, so adoption must also run for newly-seen setColumns ids.
    const selection = Selection.intersect();
    const set = makeSet(selection);
    set.set({ id: 'name', column: 'name', kind: 'match', value: 'ada' });

    const reported: Array<ColumnFiltersState> = [];
    const bridge = createFilterBridge({
      set,
      onExternalChange: (filters) => {
        reported.push(filters);
      },
    });
    // No columns yet: nothing to adopt.
    expect(reported).toHaveLength(0);

    bridge.setColumns(columns);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toEqual([{ id: 'name', value: 'ada' }]);
    expect(resolved(selection)).toHaveLength(1);
  });

  test('an adopted spec survives reconciles against stale consumer state', () => {
    const selection = Selection.intersect();
    const set = makeSet(selection);
    set.set({ id: 'name', column: 'name', kind: 'match', value: 'ada' });

    const bridge = createFilterBridge({
      set,
      columns,
      onExternalChange: () => {},
    });

    // The same-commit sync effect pushes the consumer's pre-adoption (empty)
    // state; the adopted spec must not be wiped by it.
    bridge.setFilters([]);
    expect(set.store.state.specs.map((s) => s.id)).toEqual(['name']);
    expect(resolved(selection)).toHaveLength(1);
  });

  test('an adopted spec graduates once consumer state covers it, then is removable', () => {
    const selection = Selection.intersect();
    const set = makeSet(selection);
    set.set({ id: 'name', column: 'name', kind: 'match', value: 'ada' });

    const bridge = createFilterBridge({
      set,
      columns,
      onExternalChange: () => {},
    });

    // Consumer state catches up (same value): the spec graduates to the
    // normal lifecycle...
    bridge.setFilters([{ id: 'name', value: 'ada' }]);
    expect(set.store.state.specs.map((s) => s.id)).toEqual(['name']);

    // ...and a later clear now removes it like any bridge-written spec.
    bridge.setFilters([]);
    expect(set.store.state.specs).toHaveLength(0);
    expect(resolved(selection)).toHaveLength(0);
  });

  test('destroy leaves adopted specs the consumer never confirmed', () => {
    const selection = Selection.intersect();
    const set = makeSet(selection);
    set.set({ id: 'name', column: 'name', kind: 'match', value: 'ada' });

    const bridge = createFilterBridge({
      set,
      columns,
      onExternalChange: () => {},
    });
    // Destroyed before any confirming setFilters (the StrictMode first-mount
    // shape): the persisted spec must survive for the next bridge to adopt.
    bridge.destroy();
    expect(set.store.state.specs.map((s) => s.id)).toEqual(['name']);
    expect(resolved(selection)).toHaveLength(1);
  });

  test('destroy removes an adopted spec after it graduated', () => {
    const selection = Selection.intersect();
    const set = makeSet(selection);
    set.set({ id: 'name', column: 'name', kind: 'match', value: 'ada' });

    const bridge = createFilterBridge({
      set,
      columns,
      onExternalChange: () => {},
    });
    bridge.setFilters([{ id: 'name', value: 'ada' }]);

    bridge.destroy();
    expect(set.store.state.specs).toHaveLength(0);
    expect(resolved(selection)).toHaveLength(0);
  });

  test('an external removal of an adopted spec drops its protection', () => {
    const selection = Selection.intersect();
    const set = makeSet(selection);
    set.set({ id: 'name', column: 'name', kind: 'match', value: 'ada' });

    const reported: Array<ColumnFiltersState> = [];
    const bridge = createFilterBridge({
      set,
      columns,
      onExternalChange: (filters) => {
        reported.push(filters);
      },
    });

    set.remove('name');
    expect(reported.at(-1)).toEqual([]);

    // Nothing left to protect: a republish + clear cycle behaves normally.
    bridge.setFilters([{ id: 'name', value: 'bo' }]);
    bridge.setFilters([]);
    expect(set.store.state.specs).toHaveLength(0);
  });
});

describe('end-to-end against DuckDB', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createAthletesDb();
  });

  test('the consuming table is filtered by its own column filters (deliberately not self-excluded)', async () => {
    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });
    const rows = createRowsClient({
      coordinator: db.coordinator,
      query: ({ where }) =>
        Query.from('athletes').select('id', 'name', 'sport').where(where),
      filterBy: $page,
    });
    await waitFor(() => {
      expect(rows.store.state.rows).toHaveLength(6);
    });

    const bridge = createFilterBridge({
      set,
      columns: {
        sport: { clause: 'equals' },
        name: { clause: 'ilike' },
        weight: { clause: 'range' },
      },
    });

    // Even in a crossfilter Selection the spec carries no clients, so the
    // table's own rows client re-queries with the filter.
    bridge.setFilters([{ id: 'sport', value: 'swim' }]);
    expect(resolved($page)[0]?.clients).toBeUndefined();
    await waitFor(() => {
      expect(rows.store.state.rows).toHaveLength(4);
    });

    bridge.setFilters([
      { id: 'sport', value: 'swim' },
      { id: 'weight', value: [65, 85] },
    ]);
    await waitFor(() => {
      expect(
        rows.store.state.rows.map((row) => (row as { name: string }).name),
      ).toEqual(['Bo', 'Cy']);
    });

    bridge.setFilters([{ id: 'name', value: 'AD' }]);
    await waitFor(() => {
      expect(rows.store.state.rows).toHaveLength(1);
    });

    bridge.setFilters([]);
    await waitFor(() => {
      expect(rows.store.state.rows).toHaveLength(6);
    });

    // Re-submitting equal state triggers no re-query.
    const queriesBefore = db.clientQueries.length;
    bridge.setFilters([]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(db.clientQueries.length).toBe(queriesBefore);

    bridge.destroy();
    rows.destroy();
  });

  test('destroy restores unfiltered results for consumers', async () => {
    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });
    const rows = createRowsClient({
      coordinator: db.coordinator,
      query: ({ where }) =>
        Query.from('athletes').select('id', 'sport').where(where),
      filterBy: $page,
    });
    const bridge = createFilterBridge({
      set,
      columns: { sport: { clause: 'in' } },
    });

    bridge.setFilters([{ id: 'sport', value: ['run'] }]);
    await waitFor(() => {
      expect(rows.store.state.rows).toHaveLength(2);
    });

    bridge.destroy();
    await waitFor(() => {
      expect(rows.store.state.rows).toHaveLength(6);
    });

    rows.destroy();
  });
});
