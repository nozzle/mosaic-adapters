import { Selection, clausePoint } from '@uwdata/mosaic-core';
import { Query } from '@uwdata/mosaic-sql';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { createAthletesDb, waitFor } from '@nozzleio/test-support/duckdb';
import { createRowsClient } from '../src/index';
import type { ClauseSource } from '@uwdata/mosaic-core';
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

function athleteQuery() {
  return Query.from('athletes').select('id', 'name', 'sport', 'weight');
}

describe('rowCount: "window"', () => {
  test('returns the filtered total under a crossfilter page context, including externally published clauses', async () => {
    const $page = Selection.crossfilter();

    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      filterBy: $page,
      inputs: { orderBy: [{ column: 'id' }], limit: 2, offset: 0 },
      rowCount: 'window',
    });

    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
    });
    expect(client.store.state.rows).toHaveLength(2);
    expect(client.store.state.totalRows).toBe(6);
    // The window count column is plumbing, not data.
    expect(Object.keys(client.store.state.rows[0]!)).toEqual([
      'id',
      'name',
      'sport',
      'weight',
    ]);

    // An externally published column filter (a facet menu, a TanStack Table filter
    // bridge, ...). Its clause does not list our client in `clients`, so the
    // client must NOT self-exclude it: page rows and total both shrink.
    const externalFacet: ClauseSource = {};
    $page.update(clausePoint('sport', 'swim', { source: externalFacet }));

    await waitFor(() => {
      expect(client.store.state.totalRows).toBe(4);
    });
    expect(client.store.state.rows).toHaveLength(2);
    expect(client.store.state.rows.every((r) => r.sport === 'swim')).toBe(true);

    // Clearing the external clause (same source identity) restores the
    // unfiltered total.
    $page.update(clausePoint('sport', undefined, { source: externalFacet }));

    await waitFor(() => {
      expect(client.store.state.totalRows).toBe(6);
    });

    client.destroy();
  });

  test('wraps the base in a subquery rather than appending the window in-scope', async () => {
    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      inputs: { orderBy: [{ column: 'id' }], limit: 2, offset: 0 },
      rowCount: 'window',
    });

    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
    });

    const sql = client.store.state.lastQuery!;
    // Outer SELECT * over a subquery carrying the base, with the window count
    // added at the outer scope — not appended alongside the base's columns.
    expect(sql).toMatch(/FROM \(\s*SELECT/i);
    expect(sql).toMatch(/count\(\*\) OVER \(\)/i);
    // ORDER BY / LIMIT / OFFSET live on the outer wrapper, after the subquery.
    const subqueryEnd = sql.lastIndexOf(')');
    expect(sql.slice(subqueryEnd)).toMatch(/ORDER BY/i);
    expect(sql.slice(subqueryEnd)).toMatch(/LIMIT 2/i);

    client.destroy();
  });

  test('ORDER BY binds at the outer scope, so sort columns must be projected by the base', async () => {
    // The wrapper's `SELECT *` re-exposes only what the base projects: an
    // alias projected by the base is orderable through the wrapper, while an
    // unprojected column would be a binder error. Pin the shape — the ORDER BY
    // reference lives outside the subquery, against the projected alias.
    const client = createRowsClient<{ id: number; kg: number }>({
      coordinator: db.coordinator,
      query: ({ where }) =>
        Query.from('athletes').select('id', { kg: 'weight' }).where(where),
      inputs: { orderBy: [{ column: 'kg', desc: true }], limit: 2, offset: 0 },
      rowCount: 'window',
    });

    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
    });
    expect(client.store.state.rows.map((r) => r.kg)).toEqual([90, 80]);

    const sql = client.store.state.lastQuery!;
    const subqueryEnd = sql.lastIndexOf(')');
    expect(sql.slice(subqueryEnd)).toMatch(/ORDER BY "kg" DESC/i);

    client.destroy();
  });

  test('counts the fully-resolved relation for a DISTINCT base', async () => {
    // Six athletes across two sports. A DISTINCT base yields two rows; the
    // wrapped window must count those two, not the six pre-dedup rows an
    // in-scope `count(*) OVER ()` would have seen.
    const client = createRowsClient<{ sport: string }>({
      coordinator: db.coordinator,
      query: ({ where }) =>
        Query.from('athletes').select('sport').distinct().where(where),
      inputs: { orderBy: [{ column: 'sport' }], limit: 1, offset: 0 },
      rowCount: 'window',
    });

    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
    });
    expect(client.store.state.rows).toHaveLength(1);
    expect(client.store.state.totalRows).toBe(2);
    expect(Object.keys(client.store.state.rows[0]!)).toEqual(['sport']);

    client.destroy();
  });

  test('pagination beyond the first page keeps the filtered total', async () => {
    const $page = Selection.crossfilter();

    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      filterBy: $page,
      inputs: { orderBy: [{ column: 'id' }], limit: 4, offset: 4 },
      rowCount: 'window',
    });

    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
    });
    expect(client.store.state.rows.map((r) => r.id)).toEqual([5, 6]);
    expect(client.store.state.totalRows).toBe(6);

    client.destroy();
  });
});

describe('rowCount: "query"', () => {
  test('issues a separate count sharing the same filters', async () => {
    const $page = Selection.crossfilter();

    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      filterBy: $page,
      inputs: { orderBy: [{ column: 'id' }], limit: 2 },
      rowCount: 'query',
    });

    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.totalRows).toBe(6);
    });
    expect(client.store.state.rows).toHaveLength(2);

    const externalFacet: ClauseSource = {};
    $page.update(clausePoint('sport', 'run', { source: externalFacet }));

    await waitFor(() => {
      expect(client.store.state.totalRows).toBe(2);
    });

    client.destroy();
  });

  test('memoizes the count across page turns and sort changes, issuing it once', async () => {
    // Spy on the coordinator: the count query is issued directly through
    // `coordinator.query`, so counting count-shaped calls proves the gate
    // (the SQL-string cache would otherwise hide duplicate issuances).
    const querySpy = vi.spyOn(db.coordinator, 'query');
    const countCalls = () =>
      querySpy.mock.calls.filter(([q]) => /__total_rows__/.test(String(q)))
        .length;

    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      inputs: { orderBy: [{ column: 'id' }], limit: 2, offset: 0 },
      rowCount: 'query',
    });

    await waitFor(() => {
      expect(client.store.state.totalRows).toBe(6);
    });
    expect(countCalls()).toBe(1);

    client.setInputs({ offset: 2 });
    await waitFor(() => {
      expect(client.store.state.rows.map((r) => r.id)).toEqual([3, 4]);
    });
    client.setInputs({ offset: 4 });
    await waitFor(() => {
      expect(client.store.state.rows.map((r) => r.id)).toEqual([5, 6]);
    });
    client.setInputs({ orderBy: [{ column: 'id', desc: true }], offset: 0 });
    await waitFor(() => {
      expect(client.store.state.rows.map((r) => r.id)).toEqual([6, 5]);
    });

    // No new count query for page turns or sort changes; the total holds.
    expect(countCalls()).toBe(1);
    expect(client.store.state.totalRows).toBe(6);

    querySpy.mockRestore();
    client.destroy();
  });

  test('re-issues the count when the WHERE predicate changes', async () => {
    const querySpy = vi.spyOn(db.coordinator, 'query');
    const countCalls = () =>
      querySpy.mock.calls.filter(([q]) => /__total_rows__/.test(String(q)))
        .length;

    const $page = Selection.crossfilter();
    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      filterBy: $page,
      inputs: { orderBy: [{ column: 'id' }], limit: 2, offset: 0 },
      rowCount: 'query',
    });

    await waitFor(() => {
      expect(client.store.state.totalRows).toBe(6);
    });
    expect(countCalls()).toBe(1);

    const facet: ClauseSource = {};
    $page.update(clausePoint('sport', 'run', { source: facet }));

    await waitFor(() => {
      expect(client.store.state.totalRows).toBe(2);
    });
    expect(countCalls()).toBe(2);

    querySpy.mockRestore();
    client.destroy();
  });

  test('refetch forces a fresh count even when the predicate is unchanged', async () => {
    const querySpy = vi.spyOn(db.coordinator, 'query');
    const countCalls = () =>
      querySpy.mock.calls.filter(([q]) => /__total_rows__/.test(String(q)))
        .length;

    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      inputs: { orderBy: [{ column: 'id' }], limit: 2, offset: 0 },
      rowCount: 'query',
    });

    await waitFor(() => {
      expect(client.store.state.totalRows).toBe(6);
    });
    expect(countCalls()).toBe(1);

    // A page turn alone must not re-count (the memo holds)...
    client.setInputs({ offset: 2 });
    await waitFor(() => {
      expect(client.store.state.rows.map((r) => r.id)).toEqual([3, 4]);
    });
    expect(countCalls()).toBe(1);

    // ...but an explicit refetch invalidates the memo and re-issues the count,
    // since the underlying data may have changed even with the same predicate.
    await client.refetch();
    await waitFor(() => {
      expect(countCalls()).toBe(2);
    });
    expect(client.store.state.totalRows).toBe(6);

    querySpy.mockRestore();
    client.destroy();
  });
});

describe('rowCount: "none"', () => {
  test('totalRows stays undefined', async () => {
    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      inputs: { limit: 2 },
    });

    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
    });
    expect(client.store.state.totalRows).toBeUndefined();

    client.destroy();
  });
});

describe('inputMode', () => {
  test('"manual" + rowCount "window" is a clear error', () => {
    expect(() =>
      createRowsClient<AthleteRow>({
        coordinator: db.coordinator,
        query: ({ where }) => athleteQuery().where(where),
        inputMode: 'manual',
        rowCount: 'window',
      }),
    ).toThrowError(
      /rowCount: 'window'.*inputMode: 'manual'|inputMode: 'manual'.*rowCount: 'window'/s,
    );
  });

  test('"manual" hands inputs to the factory and appends nothing', async () => {
    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where, inputs }) =>
        athleteQuery()
          .where(where)
          .limit(inputs.limit ?? 1),
      inputMode: 'manual',
      inputs: { limit: 3 },
    });

    await waitFor(() => {
      expect(client.store.state.rows).toHaveLength(3);
    });
    // The client did not double-append the window.
    expect((client.store.state.lastQuery!.match(/LIMIT/gi) ?? []).length).toBe(
      1,
    );

    client.destroy();
  });
});

describe('inputs → SQL appending', () => {
  test('orderBy supports desc and nullsFirst', async () => {
    await db.exec(`INSERT INTO athletes VALUES (7, 'Gil', 'run', NULL)`);

    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      inputs: {
        orderBy: [{ column: 'weight', desc: true, nullsFirst: true }],
        limit: 2,
      },
    });

    await waitFor(() => {
      expect(client.store.state.rows.map((r) => r.id)).toEqual([7, 4]);
    });

    client.destroy();
  });

  test('a string query source selects the whole table', async () => {
    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      inputs: { orderBy: [{ column: 'id', desc: true }], limit: 1 },
    });

    await waitFor(() => {
      expect(client.store.state.rows.map((r) => r.id)).toEqual([6]);
    });

    client.destroy();
  });
});

describe('coerce', () => {
  test('maps raw rows to display rows', async () => {
    const client = createRowsClient<{ id: number; label: string }>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      inputs: { orderBy: [{ column: 'id' }], limit: 1 },
      coerce: (raw) => ({
        id: raw.id as number,
        label: `${raw.name as string} (${raw.sport as string})`,
      }),
    });

    await waitFor(() => {
      expect(client.store.state.rows).toEqual([{ id: 1, label: 'Ada (swim)' }]);
    });

    client.destroy();
  });
});

describe('prefetch', () => {
  test('warms the cache with the next page query', async () => {
    const client = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: ({ where }) => athleteQuery().where(where),
      inputs: { orderBy: [{ column: 'id' }], limit: 2, offset: 0 },
    });

    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
    });

    client.prefetch({ offset: 2 });
    await waitFor(() => {
      expect(db.connectorQueries.some((sql) => /OFFSET 2/i.test(sql))).toBe(
        true,
      );
    });

    // Navigating to the prefetched page is served from the coordinator
    // cache: no new connector query for the same SQL.
    const connectorCount = db.connectorQueries.length;
    client.setInputs({ offset: 2 });
    await waitFor(() => {
      expect(client.store.state.rows.map((r) => r.id)).toEqual([3, 4]);
    });
    expect(db.connectorQueries.length).toBe(connectorCount);

    client.destroy();
  });
});
