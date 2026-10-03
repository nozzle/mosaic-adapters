import { runInNewContext } from 'node:vm';

import { createTestDb, waitFor } from '@nozzleio/test-support/duckdb';
import type { TestDb } from '@nozzleio/test-support/duckdb';
import { Selection } from '@uwdata/mosaic-core';
import { BetweenOpNode, InOpNode, Query, TableRefNode, count } from '@uwdata/mosaic-sql';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  createFacetClient,
  createFilterSet,
  createHistogramClient,
  createPivotClient,
  createRollupClient,
  createRowsClient,
  createSparklineClient,
  createValuesClient,
  isSameQuerySource,
  subqueryFilterKind,
} from '../src/index';
import type { FilterSpec, Persister, QuerySource, RowsInputs } from '../src/index';
import { dottedTableNameWarning } from '../src/query-source';

let db: TestDb;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  db = await createTestDb();
  // `main` is DuckDB's default schema; `ev` is an explicit one so the
  // qualified name is the only way to reach the table.
  await db.exec(`
    CREATE SCHEMA ev;
    CREATE TABLE ev.events(
      id INTEGER,
      meta STRUCT(country VARCHAR, tier VARCHAR),
      stats STRUCT(score DOUBLE, day INTEGER),
      plain TEXT
    );
    INSERT INTO ev.events VALUES
      (1, {'country': 'us', 'tier': 'a'}, {'score': 10, 'day': 1}, 'x'),
      (2, {'country': 'us', 'tier': 'b'}, {'score': 20, 'day': 1}, 'x'),
      (3, {'country': 'us', 'tier': 'a'}, {'score': 30, 'day': 2}, 'y'),
      (4, {'country': 'de', 'tier': 'b'}, {'score': 40, 'day': 2}, 'y'),
      (5, {'country': 'de', 'tier': 'a'}, {'score': 50, 'day': 3}, 'z');
    -- Columns whose names literally contain a dot (the 'literal' opt-out).
    CREATE TABLE ev.flat AS SELECT
      id,
      meta.country AS "meta.country",
      meta.tier AS "meta.tier",
      stats.score AS "stats.score",
      stats.day AS "stats.day"
    FROM ev.events;
    -- A list column nested in a struct (facet arrayColumn over a path).
    CREATE TABLE ev.tagged AS SELECT
      id,
      {'tags': CASE WHEN id <= 2 THEN ['red', 'blue'] ELSE ['blue'] END} AS meta
    FROM ev.events;
  `);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

const events = (): TableRefNode => new TableRefNode(['ev', 'events']);
const flat = (): TableRefNode => new TableRefNode(['ev', 'flat']);

function dottedSourceWarnings(): Array<unknown> {
  return warn.mock.calls.filter((call: Array<unknown>) =>
    String(call[0]).includes('contains a dot but is a plain string'),
  );
}

describe('TableRefNode query sources', () => {
  test('a TableRefNode renders a schema-qualified FROM', async () => {
    const rows = createRowsClient<{ id: number }>({
      coordinator: db.coordinator,
      query: events(),
      rowCount: 'none',
      inputs: { orderBy: [{ column: 'id' }] },
    });

    await waitFor(() => {
      expect(rows.store.state.status).toBe('success');
    });
    expect(rows.store.state.rows.map((row) => Number(row.id))).toEqual([1, 2, 3, 4, 5]);
    expect(rows.store.state.lastQuery).toContain('FROM "ev"."events"');
    expect(dottedSourceWarnings()).toHaveLength(0);

    rows.destroy();
  });

  test('a TableRefNode source receives the client-applied WHERE', async () => {
    const $page = Selection.crossfilter();
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: events(),
      column: 'plain',
      publish: { as: $page },
    });
    // The filtered client's source is the TableRefNode itself (no factory),
    // so the WHERE below is placed by the client's own resolveBase.
    const rows = createRowsClient<{ id: number }>({
      coordinator: db.coordinator,
      query: events(),
      filterBy: $page,
      rowCount: 'none',
      inputs: { orderBy: [{ column: 'id' }] },
    });

    await waitFor(() => {
      expect(facet.store.state.status).toBe('success');
      expect(rows.store.state.rows).toHaveLength(5);
    });

    facet.toggle('y');
    await waitFor(() => {
      expect(rows.store.state.rows.map((row) => Number(row.id))).toEqual([3, 4]);
    });
    expect(rows.store.state.lastQuery).toContain('FROM "ev"."events"');
    expect(rows.store.state.lastQuery).toContain(`WHERE ("plain" IN ('y'))`);

    facet.destroy();
    rows.destroy();
  });

  test('a string[] source is rejected (it would render a cross join)', () => {
    const source = ['ev', 'events'] as unknown as QuerySource<RowsInputs>;
    expect(() =>
      createRowsClient({ coordinator: db.coordinator, query: source, enabled: false }),
    ).toThrowError(/cannot be an array/);

    const rows = createRowsClient({
      coordinator: db.coordinator,
      query: events(),
      enabled: false,
    });
    expect(() => rows.setQuery(source)).toThrowError(/cross join/);
    rows.destroy();
  });

  test('a plain object that is not a table reference is rejected', () => {
    const source = {} as unknown as QuerySource<RowsInputs>;
    expect(() =>
      createRowsClient({ coordinator: db.coordinator, query: source, enabled: false }),
    ).toThrowError(/Invalid query source/);
  });

  test('a dotted plain-string source warns once per client and is never split', async () => {
    const rows = createRowsClient({
      coordinator: db.coordinator,
      query: 'ev.events',
      rowCount: 'none',
    });

    // The string is ONE quoted identifier, so the qualified table is not found.
    await waitFor(() => {
      expect(rows.store.state.status).toBe('error');
    });
    expect(rows.store.state.lastQuery).toContain('FROM "ev.events"');

    expect(dottedSourceWarnings()).toHaveLength(1);
    expect(String(dottedSourceWarnings()[0])).toContain("new TableRefNode(['ev', 'events'])");

    // Re-sending the same (or another dotted) string never warns again.
    rows.setQuery('ev.events');
    rows.setQuery('other.table');
    expect(dottedSourceWarnings()).toHaveLength(1);

    // A second client warns on its own.
    const other = createRowsClient({
      coordinator: db.coordinator,
      query: 'ev.events',
      enabled: false,
    });
    expect(dottedSourceWarnings()).toHaveLength(2);

    rows.destroy();
    other.destroy();
  });

  test('the warning snippet escapes backslashes, quotes and line breaks in the table name', () => {
    // Plain names are quoted verbatim.
    const plain = dottedTableNameWarning('main.events');
    expect(plain).toContain("`new TableRefNode(['main', 'events'])`");
    expect(plain).toContain("`new TableRefNode('main.events')`");

    // Backslashes are escaped before quotes, so `\'` becomes `\\\'` rather
    // than `\\'` (which would close the literal early).
    const tricky = dottedTableNameWarning(String.raw`o'brien\db.tab\'le`);
    expect(tricky).toContain(String.raw`new TableRefNode(['o\'brien\\db', 'tab\\\'le'])`);
    expect(tricky).toContain(String.raw`new TableRefNode('o\'brien\\db.tab\\\'le')`);

    // Raw LF / CR would be a syntax error inside a string literal.
    const lineBreaks = dottedTableNameWarning('line\nfeed.carriage\rreturn');
    expect(lineBreaks).toContain(String.raw`new TableRefNode(['line\nfeed', 'carriage\rreturn'])`);
    expect(lineBreaks).toContain(String.raw`new TableRefNode('line\nfeed.carriage\rreturn')`);
  });

  test('every warning snippet evaluates back to the original table name', () => {
    const names = [
      'main.events',
      String.raw`o'brien\db.tab\'le`,
      'line\nfeed.carriage\rreturn',
      String.raw`a\\.b\n'\r`,
      "mixed\\'\r\n.done",
    ];
    // Evaluate each snippet as a JavaScript expression in a fresh context.
    const evaluate = (code: string): unknown => runInNewContext(`(${code})`);
    for (const name of names) {
      const snippets = [
        ...dottedTableNameWarning(name).matchAll(/`new TableRefNode\((.*?)\)`/gs),
      ].map((match) => match[1]);
      expect(snippets).toHaveLength(2);
      const [partsSnippet, wholeSnippet] = snippets as [string, string];
      expect(evaluate(partsSnippet)).toEqual(name.split('.'));
      expect(evaluate(wholeSnippet)).toBe(name);
    }
  });

  test('undotted strings, table references and factories never warn', () => {
    const plain = createRowsClient({
      coordinator: db.coordinator,
      query: 'events',
      enabled: false,
    });
    const dottedRef = createRowsClient({
      coordinator: db.coordinator,
      // A table whose name really contains a dot: the opt-out from the warning.
      query: new TableRefNode('ev.events'),
      enabled: false,
    });
    plain.setQuery(() => Query.from(events()).select('*'));
    expect(dottedSourceWarnings()).toHaveLength(0);

    // Swapping to a dotted string later still warns (once).
    plain.setQuery('ev.events');
    expect(dottedSourceWarnings()).toHaveLength(1);

    plain.destroy();
    dottedRef.destroy();
  });

  test('the warning is development-only', () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const rows = createRowsClient({
        coordinator: db.coordinator,
        query: 'ev.events',
        enabled: false,
      });
      expect(dottedSourceWarnings()).toHaveLength(0);
      rows.destroy();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test('rollup clients reject table references like table names', () => {
    expect(() =>
      createRollupClient({
        coordinator: db.coordinator,
        query: events(),
        groupBy: ['plain'],
      }),
    ).toThrowError(/query factory/);
  });

  test('isSameQuerySource compares table references by SQL form', () => {
    const factory = () => Query.from('events').select('*');
    expect(isSameQuerySource(events(), events())).toBe(true);
    expect(isSameQuerySource(events(), new TableRefNode(['ev', 'other']))).toBe(false);
    expect(isSameQuerySource(events(), new TableRefNode('ev.events'))).toBe(false);
    expect(isSameQuerySource('events', 'events')).toBe(true);
    expect(isSameQuerySource('events', 'other')).toBe(false);
    // A string never equals a table reference, even with the same SQL.
    expect(isSameQuerySource('events', new TableRefNode('events'))).toBe(false);
    expect(isSameQuerySource(factory, factory)).toBe(true);
    expect(isSameQuerySource(factory, () => Query.from('events').select('*'))).toBe(false);
  });
});

describe('struct-path column options', () => {
  test('facet: options and the published clause use "meta"."country"', async () => {
    const $page = Selection.crossfilter();
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: events(),
      column: 'meta.country',
      publish: { as: $page },
    });
    const rows = createRowsClient<{ id: number }>({
      coordinator: db.coordinator,
      query: events(),
      filterBy: $page,
      rowCount: 'none',
      inputs: { orderBy: [{ column: 'id' }] },
    });

    await waitFor(() => {
      expect(facet.store.state.options).toEqual([
        { value: 'us', count: 3 },
        { value: 'de', count: 2 },
      ]);
    });
    expect(facet.store.state.lastQuery).toContain('"meta"."country"');
    expect(facet.store.state.lastQuery).not.toContain('"meta.country"');

    facet.toggle('de');
    await waitFor(() => {
      expect(rows.store.state.rows.map((row) => Number(row.id))).toEqual([4, 5]);
    });

    // The clause `fields` reuse the exact node the predicate references.
    const clause = $page.clauses[0]!;
    expect(String(clause.predicate)).toBe(`("meta"."country" IN ('de'))`);
    expect(clause.fields).toHaveLength(1);
    expect(String(clause.fields[0])).toBe('"meta"."country"');
    expect(clause.predicate).toBeInstanceOf(InOpNode);
    expect((clause.predicate as InOpNode).expr).toBe(clause.fields[0]);

    facet.destroy();
    rows.destroy();
  });

  test('facet: multi-select publishes the struct path', async () => {
    const $page = Selection.crossfilter();
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: events(),
      column: 'meta.tier',
      select: 'multi',
      publish: { as: $page },
    });
    const values = createValuesClient<{ n: number }>({
      coordinator: db.coordinator,
      query: (ctx) => Query.from(events()).select({ n: count() }).where(ctx.where),
      filterBy: $page,
    });

    await waitFor(() => {
      expect(facet.store.state.status).toBe('success');
    });
    facet.setSelected(['a']);
    await waitFor(() => {
      expect(Number(values.store.state.values?.n)).toBe(3);
    });
    expect(String($page.clauses[0]!.predicate)).toContain('"meta"."tier"');

    facet.destroy();
    values.destroy();
  });

  test('facet: arrayColumn over a struct path unnests and matches "meta"."tags"', async () => {
    const $page = Selection.crossfilter();
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: new TableRefNode(['ev', 'tagged']),
      column: 'meta.tags',
      arrayColumn: true,
      sort: 'alpha',
      publish: { as: $page },
    });
    const rows = createRowsClient<{ id: number }>({
      coordinator: db.coordinator,
      query: new TableRefNode(['ev', 'tagged']),
      filterBy: $page,
      rowCount: 'none',
      inputs: { orderBy: [{ column: 'id' }] },
    });

    await waitFor(() => {
      expect(facet.store.state.options).toEqual([
        { value: 'blue', count: 5 },
        { value: 'red', count: 2 },
      ]);
    });
    expect(facet.store.state.lastQuery).toContain('UNNEST("meta"."tags")');

    facet.toggle('red');
    await waitFor(() => {
      expect(rows.store.state.rows.map((row) => Number(row.id))).toEqual([1, 2]);
    });
    const clause = $page.clauses[0]!;
    expect(String(clause.predicate)).toContain('list_has_any("meta"."tags"');
    expect(String(clause.fields[0])).toBe('"meta"."tags"');

    facet.destroy();
    rows.destroy();
  });

  test('facet: undotted column SQL is unchanged', async () => {
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: events(),
      column: 'plain',
    });

    await waitFor(() => {
      expect(facet.store.state.status).toBe('success');
    });
    expect(facet.store.state.lastQuery).toBe(
      'SELECT "value", count(*) AS "count" FROM (SELECT "plain" AS "value" FROM ' +
        '(SELECT * FROM "ev"."events")) WHERE ("value" IS NOT NULL) ' +
        'GROUP BY "value" ORDER BY "count" DESC, "value" ASC',
    );

    facet.destroy();
  });

  test('histogram: extent, bins and the brush clause use "stats"."score"', async () => {
    const $page = Selection.crossfilter();
    const histogram = createHistogramClient({
      coordinator: db.coordinator,
      from: events(),
      column: 'stats.score',
      inputs: { step: 10 },
      publish: { as: $page },
    });
    const values = createValuesClient<{ n: number }>({
      coordinator: db.coordinator,
      query: (ctx) => Query.from(events()).select({ n: count() }).where(ctx.where),
      filterBy: $page,
    });

    await waitFor(() => {
      expect(histogram.store.state.status).toBe('success');
    });
    expect(histogram.store.state.extent).toEqual([10, 50]);
    expect(histogram.store.state.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(5);
    expect(histogram.store.state.lastQuery).toContain('"stats"."score"');

    histogram.setRange([15, 35]);
    await waitFor(() => {
      expect(Number(values.store.state.values?.n)).toBe(2);
    });
    const clause = $page.clauses[0]!;
    expect(String(clause.predicate)).toBe('("stats"."score" BETWEEN 15 AND 35)');
    expect(String(clause.fields[0])).toBe('"stats"."score"');
    expect(clause.predicate).toBeInstanceOf(BetweenOpNode);
    expect((clause.predicate as BetweenOpNode).expr).toBe(clause.fields[0]);

    histogram.destroy();
    values.destroy();
  });

  test('sparkline: key, x and y accept struct paths', async () => {
    const spark = createSparklineClient({
      coordinator: db.coordinator,
      from: events(),
      key: 'meta.country',
      x: { column: 'stats.day' },
      y: { agg: 'sum', column: 'stats.score' },
      inputs: { keys: ['us', 'de'] },
    });

    await waitFor(() => {
      expect(spark.store.state.status).toBe('success');
    });
    expect(spark.store.state.series.get('us')).toEqual([
      { x: 1, y: 30 },
      { x: 2, y: 30 },
    ]);
    expect(spark.store.state.series.get('de')).toEqual([
      { x: 2, y: 40 },
      { x: 3, y: 50 },
    ]);
    expect(spark.store.state.lastQuery).toContain(`"meta"."country" IN ('us', 'de')`);

    spark.destroy();
  });

  test('pivot: struct paths are projected before PIVOT', async () => {
    const pivot = createPivotClient<Record<string, unknown>>({
      coordinator: db.coordinator,
      from: events(),
      on: 'meta.tier',
      using: [{ agg: 'sum', column: 'stats.score' }],
      groupBy: ['meta.country'],
      inputs: { orderBy: [{ column: 'meta.country' }] },
    });

    await waitFor(() => {
      expect(pivot.store.state.status).toBe('success');
    });
    expect(pivot.store.state.lastQuery).toBe(
      'PIVOT (SELECT *, "meta"."tier" AS "meta.tier", "meta"."country" AS "meta.country", ' +
        '"stats"."score" AS "stats.score" FROM (SELECT * FROM "ev"."events")) ' +
        'ON "meta.tier" USING sum("stats.score") GROUP BY "meta.country" ORDER BY "meta.country" ASC',
    );
    // The groupBy path keeps its dotted option name as the output column.
    expect(pivot.store.state.pivotColumns).toEqual(['a', 'b']);
    const rows = pivot.store.state.rows;
    expect(rows.map((row) => row['meta.country'])).toEqual(['de', 'us']);
    expect(Number(rows[0]!.a)).toBe(50);
    expect(Number(rows[0]!.b)).toBe(40);
    expect(Number(rows[1]!.a)).toBe(40);
    expect(Number(rows[1]!.b)).toBe(20);

    pivot.destroy();
  });

  test('pivot: undotted names keep the base relation unwrapped', async () => {
    const pivot = createPivotClient<Record<string, unknown>>({
      coordinator: db.coordinator,
      from: events(),
      on: 'plain',
      using: [{ agg: 'count' }],
      groupBy: ['id'],
    });

    await waitFor(() => {
      expect(pivot.store.state.status).toBe('success');
    });
    expect(pivot.store.state.lastQuery).toBe(
      'PIVOT (SELECT * FROM "ev"."events") ON "plain" USING count(*) GROUP BY "id"',
    );

    pivot.destroy();
  });
});

describe("columnPaths: 'literal' (opt-out to mosaic-sql column() semantics)", () => {
  test('facet: options and the published clause use the "meta.country" identifier', async () => {
    const $page = Selection.crossfilter();
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: flat(),
      column: 'meta.country',
      columnPaths: 'literal',
      publish: { as: $page },
    });
    const rows = createRowsClient<{ id: number }>({
      coordinator: db.coordinator,
      query: flat(),
      filterBy: $page,
      rowCount: 'none',
      inputs: { orderBy: [{ column: 'id' }] },
    });

    await waitFor(() => {
      expect(facet.store.state.options).toEqual([
        { value: 'us', count: 3 },
        { value: 'de', count: 2 },
      ]);
    });
    expect(facet.store.state.lastQuery).toContain('SELECT "meta.country" AS "value"');
    expect(facet.store.state.lastQuery).not.toContain('"meta"."country"');

    facet.toggle('de');
    await waitFor(() => {
      expect(rows.store.state.rows.map((row) => Number(row.id))).toEqual([4, 5]);
    });
    const clause = $page.clauses[0]!;
    expect(String(clause.predicate)).toBe(`("meta.country" IN ('de'))`);
    expect((clause.predicate as InOpNode).expr).toBe(clause.fields[0]);

    facet.destroy();
    rows.destroy();
  });

  test('facet: the default struct mode cannot read a literal dotted column', async () => {
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: flat(),
      column: 'meta.country',
    });

    await waitFor(() => {
      expect(facet.store.state.status).toBe('error');
    });
    expect(facet.store.state.lastQuery).toContain('"meta"."country"');

    facet.destroy();
  });

  test('histogram: extent, bins and the brush clause use the "stats.score" identifier', async () => {
    const $page = Selection.crossfilter();
    const histogram = createHistogramClient({
      coordinator: db.coordinator,
      from: flat(),
      column: 'stats.score',
      columnPaths: 'literal',
      inputs: { step: 10 },
      publish: { as: $page },
    });
    const values = createValuesClient<{ n: number }>({
      coordinator: db.coordinator,
      query: (ctx) => Query.from(flat()).select({ n: count() }).where(ctx.where),
      filterBy: $page,
    });

    await waitFor(() => {
      expect(histogram.store.state.status).toBe('success');
    });
    expect(histogram.store.state.extent).toEqual([10, 50]);
    expect(histogram.store.state.lastQuery).toContain('"stats.score"');
    expect(histogram.store.state.lastQuery).not.toContain('"stats"."score"');

    histogram.setRange([15, 35]);
    await waitFor(() => {
      expect(Number(values.store.state.values?.n)).toBe(2);
    });
    const clause = $page.clauses[0]!;
    expect(String(clause.predicate)).toBe('("stats.score" BETWEEN 15 AND 35)');
    expect((clause.predicate as BetweenOpNode).expr).toBe(clause.fields[0]);

    histogram.destroy();
    values.destroy();
  });

  test('sparkline: key, x and y read literal dotted identifiers', async () => {
    const spark = createSparklineClient({
      coordinator: db.coordinator,
      from: flat(),
      key: 'meta.country',
      x: { column: 'stats.day' },
      y: { agg: 'sum', column: 'stats.score' },
      columnPaths: 'literal',
      inputs: { keys: ['us', 'de'] },
    });

    await waitFor(() => {
      expect(spark.store.state.status).toBe('success');
    });
    expect(spark.store.state.series.get('de')).toEqual([
      { x: 2, y: 40 },
      { x: 3, y: 50 },
    ]);
    expect(spark.store.state.lastQuery).toContain(`"meta.country" IN ('us', 'de')`);
    expect(spark.store.state.lastQuery).toContain('sum("stats.score")');

    spark.destroy();
  });

  test('pivot: literal dotted names are not projected', async () => {
    const pivot = createPivotClient<Record<string, unknown>>({
      coordinator: db.coordinator,
      from: flat(),
      on: 'meta.tier',
      using: [{ agg: 'sum', column: 'stats.score' }],
      groupBy: ['meta.country'],
      columnPaths: 'literal',
      inputs: { orderBy: [{ column: 'meta.country' }] },
    });

    await waitFor(() => {
      expect(pivot.store.state.status).toBe('success');
    });
    expect(pivot.store.state.lastQuery).toBe(
      'PIVOT (SELECT * FROM "ev"."flat") ON "meta.tier" USING sum("stats.score") ' +
        'GROUP BY "meta.country" ORDER BY "meta.country" ASC',
    );
    expect(pivot.store.state.pivotColumns).toEqual(['a', 'b']);
    expect(pivot.store.state.rows.map((row) => row['meta.country'])).toEqual(['de', 'us']);

    pivot.destroy();
  });

  test('facet: publish.into carries the mode, so the set filters "meta.country"', async () => {
    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: flat(),
      column: 'meta.country',
      columnPaths: 'literal',
      publish: { into: set, id: 'country' },
    });
    const rows = createRowsClient<{ id: number }>({
      coordinator: db.coordinator,
      query: flat(),
      filterBy: $page,
      rowCount: 'none',
      inputs: { orderBy: [{ column: 'id' }] },
    });

    await waitFor(() => {
      expect(facet.store.state.status).toBe('success');
      expect(rows.store.state.rows).toHaveLength(5);
    });
    expect(facet.store.state.lastQuery).toContain('SELECT "meta.country" AS "value"');

    facet.toggle('de');
    await waitFor(() => {
      expect(rows.store.state.rows.map((row) => Number(row.id))).toEqual([4, 5]);
    });
    expect(set.store.state.specs).toEqual([
      { id: 'country', column: 'meta.country', columnPaths: 'literal', kind: 'point', value: 'de' },
    ]);
    const clause = $page.clauses[0]!;
    expect(String(clause.predicate)).toBe(`("meta.country" IN ('de'))`);
    expect(String(clause.fields[0])).toBe('"meta.country"');
    expect(rows.store.state.lastQuery).toContain(`"meta.country" IN ('de')`);
    expect(rows.store.state.lastQuery).not.toContain('"meta"."country"');

    facet.destroy();
    rows.destroy();
    set.destroy();
  });

  test('facet: the default struct mode leaves publish.into specs unchanged', async () => {
    const set = createFilterSet({ targets: { where: Selection.crossfilter() } });
    const facet = createFacetClient({
      coordinator: db.coordinator,
      from: events(),
      column: 'meta.country',
      select: 'multi',
      publish: { into: set, id: 'country' },
    });

    await waitFor(() => {
      expect(facet.store.state.status).toBe('success');
    });
    facet.setSelected(['de']);
    expect(set.store.state.specs).toEqual([
      { id: 'country', column: 'meta.country', kind: 'points', value: ['de'] },
    ]);

    facet.destroy();
    set.destroy();
  });

  test('histogram: publish.into carries the mode, so the set filters "stats.score"', async () => {
    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });
    const histogram = createHistogramClient({
      coordinator: db.coordinator,
      from: flat(),
      column: 'stats.score',
      columnPaths: 'literal',
      inputs: { step: 10 },
      publish: { into: set, id: 'score' },
    });
    const values = createValuesClient<{ n: number }>({
      coordinator: db.coordinator,
      query: (ctx) => Query.from(flat()).select({ n: count() }).where(ctx.where),
      filterBy: $page,
    });

    await waitFor(() => {
      expect(histogram.store.state.status).toBe('success');
      expect(Number(values.store.state.values?.n)).toBe(5);
    });

    histogram.setRange([15, 35]);
    await waitFor(() => {
      expect(Number(values.store.state.values?.n)).toBe(2);
    });
    expect(set.store.state.specs[0]).toMatchObject({
      id: 'score',
      column: 'stats.score',
      columnPaths: 'literal',
      kind: 'interval',
      value: [15, 35],
    });
    const clause = $page.clauses[0]!;
    expect(String(clause.predicate)).toBe('("stats.score" BETWEEN 15 AND 35)');
    expect(String(clause.fields[0])).toBe('"stats.score"');

    histogram.destroy();
    values.destroy();
    set.destroy();
  });
});

describe("FilterSpec columnPaths: 'literal'", () => {
  test('a multi-column points envelope reads each column as one identifier', async () => {
    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });
    const values = createValuesClient<{ n: number }>({
      coordinator: db.coordinator,
      query: (ctx) => Query.from(flat()).select({ n: count() }).where(ctx.where),
      filterBy: $page,
    });

    set.set({
      id: 'pair',
      column: 'meta.country',
      columnPaths: 'literal',
      kind: 'points',
      value: { columns: ['meta.country', 'meta.tier'], tuples: [['us', 'a']] },
    });
    expect(String($page.clauses[0]!.predicate)).toContain('"meta.country"');
    expect(String($page.clauses[0]!.predicate)).toContain('"meta.tier"');
    expect(String($page.clauses[0]!.predicate)).not.toContain('"meta"."');
    await waitFor(() => {
      expect(Number(values.store.state.values?.n)).toBe(2);
    });

    values.destroy();
    set.destroy();
  });

  test('a subquery kind reads its outer column as one identifier', () => {
    const $page = Selection.crossfilter();
    const set = createFilterSet({
      targets: { where: $page },
      kinds: {
        member: subqueryFilterKind(() => Query.from(flat()).select('meta.country')),
      },
    });

    set.set({ id: 'm', column: 'meta.country', columnPaths: 'literal', kind: 'member' });
    const clause = $page.clauses[0]!;
    expect(String(clause.predicate)).toMatch(/^\("meta\.country" IN \(SELECT /);
    expect(String(clause.fields[0])).toBe('"meta.country"');

    set.destroy();
  });

  test('the mode persists and hydrates with the spec', () => {
    let stored: Array<FilterSpec> | undefined;
    const persister: Persister<Array<FilterSpec>> = {
      read: () => stored,
      write: (value) => {
        stored = value === null ? undefined : JSON.parse(JSON.stringify(value));
      },
    };
    const first = createFilterSet({
      targets: { where: Selection.crossfilter() },
      persist: persister,
    });
    first.set({
      id: 'country',
      column: 'meta.country',
      columnPaths: 'literal',
      kind: 'point',
      value: 'de',
    });
    first.destroy();
    expect(stored?.[0]?.columnPaths).toBe('literal');

    const $page = Selection.crossfilter();
    const second = createFilterSet({ targets: { where: $page }, persist: persister });
    expect(String($page.clauses[0]!.predicate)).toBe(`("meta.country" IN ('de'))`);

    second.destroy();
  });

  test('an unknown mode is rejected by set() and skipped on hydration', () => {
    const $page = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $page } });
    const bad = {
      id: 'country',
      column: 'meta.country',
      columnPaths: 'flat',
      kind: 'point',
      value: 'de',
    } as unknown as FilterSpec;
    expect(() => set.set(bad)).toThrowError(/unknown columnPaths 'flat'/);
    expect(set.store.state.specs).toHaveLength(0);
    set.destroy();

    const $hydrated = Selection.crossfilter();
    const hydrated = createFilterSet({
      targets: { where: $hydrated },
      persist: {
        read: () => [bad, { id: 'ok', column: 'plain', kind: 'point', value: 'x' }],
        write: () => {},
      },
    });
    expect(hydrated.store.state.specs.map((spec) => spec.id)).toEqual(['ok']);
    expect($hydrated.clauses).toHaveLength(1);
    hydrated.destroy();
  });
});
