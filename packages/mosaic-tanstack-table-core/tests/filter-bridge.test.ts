import { Selection } from '@uwdata/mosaic-core';
import { Query } from '@uwdata/mosaic-sql';
import { createRowsClient } from '@nozzleio/mosaic-core';
import { beforeEach, describe, expect, test } from 'vitest';

import { createFilterBridge } from '../src/index';
import {
  createAthletesDb,
  settle,
  waitFor,
} from '../../mosaic-core/tests/test-utils';
import type { SelectionClause } from '@uwdata/mosaic-core';
import type { FilterBridgeColumns } from '../src/index';
import type { TestDb } from '../../mosaic-core/tests/test-utils';

function predicateSql(clause: SelectionClause | undefined): string {
  return String(clause?.predicate);
}

function countValueEvents(selection: Selection): () => number {
  let events = 0;
  selection.addEventListener('value', () => {
    events += 1;
  });
  return () => events;
}

describe('clause kinds', () => {
  function publish(
    columns: FilterBridgeColumns,
    id: string,
    value: unknown,
  ): SelectionClause | undefined {
    const selection = Selection.intersect();
    const bridge = createFilterBridge({ selection, columns });
    bridge.setFilters([{ id, value }]);
    return selection.clauses[0];
  }

  test('equals maps to a point clause without self-exclusion', () => {
    const clause = publish({ sport: { clause: 'equals' } }, 'sport', 'swim');
    expect(clause?.meta).toEqual({ type: 'point' });
    expect(clause?.clients).toBeUndefined();
    expect(predicateSql(clause)).toContain(`'swim'`);
  });

  test('equals with an explicit null matches SQL NULLs', () => {
    const clause = publish({ sport: { clause: 'equals' } }, 'sport', null);
    expect(predicateSql(clause)).toContain('IS NULL');
  });

  test('ilike maps to a case-insensitive contains match clause', () => {
    const clause = publish({ name: { clause: 'ilike' } }, 'name', 'AdA');
    expect(clause?.meta).toEqual({ type: 'match', method: 'contains' });
    // Case folding happens in SQL: contains(lower("name"), lower('AdA')).
    const sql = predicateSql(clause);
    expect(sql).toContain('lower');
    expect(sql).toContain(`'AdA'`);
  });

  test('prefix maps to a prefix match clause', () => {
    const clause = publish({ name: { clause: 'prefix' } }, 'name', 'Ad');
    expect(clause?.meta).toEqual({ type: 'match', method: 'prefix' });
  });

  test('range with both bounds maps to an interval clause', () => {
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
    expect(scalar?.value).toEqual([['swim']]);
  });

  test('columns map TanStack ids onto different SQL columns', () => {
    const clause = publish(
      { fullName: { column: 'full_name', clause: 'ilike' } },
      'fullName',
      'ada',
    );
    expect(predicateSql(clause)).toContain('full_name');
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
    '$name publishes nothing',
    async ({ columns, id, value }) => {
      const selection = Selection.intersect();
      const events = countValueEvents(selection);
      const bridge = createFilterBridge({ selection, columns });
      bridge.setFilters([{ id, value }]);
      await settle();
      expect(selection.clauses).toHaveLength(0);
      expect(events()).toBe(0);
    },
  );
});

describe('clause lifecycle', () => {
  const columns: FilterBridgeColumns = {
    name: { clause: 'ilike' },
    sport: { clause: 'equals' },
  };

  test('filter changes replace the clause (stable source), never accumulate', () => {
    const selection = Selection.intersect();
    const bridge = createFilterBridge({ selection, columns });

    bridge.setFilters([{ id: 'name', value: 'ada' }]);
    expect(selection.clauses).toHaveLength(1);
    const firstSource = selection.clauses[0]?.source;

    bridge.setFilters([{ id: 'name', value: 'bo' }]);
    expect(selection.clauses).toHaveLength(1);
    expect(selection.clauses[0]?.source).toBe(firstSource);
    expect(predicateSql(selection.clauses[0])).toContain(`'bo'`);
  });

  test('value-equal filter state publishes nothing (echo suppression)', async () => {
    const selection = Selection.intersect();
    const events = countValueEvents(selection);
    const bridge = createFilterBridge({ selection, columns });

    bridge.setFilters([
      { id: 'name', value: 'ada' },
      { id: 'sport', value: 'swim' },
    ]);
    await settle();
    const eventsAfterPublish = events();
    expect(eventsAfterPublish).toBeGreaterThan(0);
    expect(selection.clauses).toHaveLength(2);

    // Fresh identities, equal content — the render-loop echo shape.
    bridge.setFilters([
      { id: 'name', value: 'ada' },
      { id: 'sport', value: 'swim' },
    ]);
    bridge.setColumns({ ...columns });
    await settle();
    expect(events()).toBe(eventsAfterPublish);
    expect(selection.clauses).toHaveLength(2);
  });

  test('clearing one column removes exactly its clause', () => {
    const selection = Selection.intersect();
    const bridge = createFilterBridge({ selection, columns });

    bridge.setFilters([
      { id: 'name', value: 'ada' },
      { id: 'sport', value: 'swim' },
    ]);
    expect(selection.clauses).toHaveLength(2);

    bridge.setFilters([{ id: 'sport', value: 'swim' }]);
    expect(selection.clauses).toHaveLength(1);
    expect(predicateSql(selection.clauses[0])).toContain(`'swim'`);
  });

  test('unconfigured columns are ignored', async () => {
    const selection = Selection.intersect();
    const events = countValueEvents(selection);
    const bridge = createFilterBridge({ selection, columns });

    bridge.setFilters([{ id: 'mystery', value: 'x' }]);
    await settle();
    expect(selection.clauses).toHaveLength(0);
    expect(events()).toBe(0);
  });

  test('destroy removes every published clause and disables the bridge', () => {
    const selection = Selection.intersect();
    const bridge = createFilterBridge({ selection, columns });

    bridge.setFilters([
      { id: 'name', value: 'ada' },
      { id: 'sport', value: 'swim' },
    ]);
    expect(selection.clauses).toHaveLength(2);

    bridge.destroy();
    expect(bridge.destroyed).toBe(true);
    expect(selection.clauses).toHaveLength(0);

    bridge.setFilters([{ id: 'name', value: 'ada' }]);
    expect(selection.clauses).toHaveLength(0);
  });

  test('setColumns republishes an active filter under its new clause kind', () => {
    const selection = Selection.intersect();
    const bridge = createFilterBridge({
      selection,
      columns: { sport: { clause: 'equals' } },
    });

    bridge.setFilters([{ id: 'sport', value: 'swim' }]);
    expect(selection.clauses[0]?.meta).toEqual({ type: 'point' });
    const source = selection.clauses[0]?.source;

    bridge.setColumns({ sport: { clause: 'ilike' } });
    expect(selection.clauses).toHaveLength(1);
    expect(selection.clauses[0]?.source).toBe(source);
    expect(selection.clauses[0]?.meta).toEqual({
      type: 'match',
      method: 'contains',
    });
  });

  test('removing a column config clears its clause', () => {
    const selection = Selection.intersect();
    const bridge = createFilterBridge({ selection, columns });

    bridge.setFilters([{ id: 'name', value: 'ada' }]);
    expect(selection.clauses).toHaveLength(1);

    bridge.setColumns({ sport: { clause: 'equals' } });
    expect(selection.clauses).toHaveLength(0);
  });

  test('an external selection.reset() drops suppression bookkeeping', () => {
    const selection = Selection.intersect();
    const bridge = createFilterBridge({ selection, columns });

    const filters = [{ id: 'name', value: 'ada' }];
    bridge.setFilters(filters);
    expect(selection.clauses).toHaveLength(1);

    selection.reset();
    expect(selection.clauses).toHaveLength(0);

    // Same content again: without the source.reset hook this would be
    // suppressed as unchanged and the clause would stay lost.
    bridge.setFilters([...filters]);
    expect(selection.clauses).toHaveLength(1);
  });
});

describe('end-to-end against DuckDB', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createAthletesDb();
  });

  test('the consuming table is filtered by its own column filters (deliberately not self-excluded)', async () => {
    const $page = Selection.crossfilter();
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
      selection: $page,
      columns: {
        sport: { clause: 'equals' },
        name: { clause: 'ilike' },
        weight: { clause: 'range' },
      },
    });

    // Even in a crossfilter Selection the bridge clause carries no clients
    // set, so the table's own rows client re-queries with the filter.
    bridge.setFilters([{ id: 'sport', value: 'swim' }]);
    expect($page.clauses[0]?.clients).toBeUndefined();
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
    const rows = createRowsClient({
      coordinator: db.coordinator,
      query: ({ where }) =>
        Query.from('athletes').select('id', 'sport').where(where),
      filterBy: $page,
    });
    const bridge = createFilterBridge({
      selection: $page,
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
