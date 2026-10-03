/**
 * The mosaic-sql gap helpers (`withRecursive`, `selectStarExclude`,
 * `sqlFromParts`, `tableRef`, `andOrTrue`) depend on mosaic-sql internals, so
 * every test pins the exact SQL a helper renders. A mosaic-sql upgrade that
 * changes those internals fails here. The "upstream gaps" block fails once
 * mosaic-sql ships an equivalent, which is the cue to remove or alias the
 * helper.
 */
import { createAthletesDb } from '@nozzleio/test-support/duckdb';
import type { TestDb } from '@nozzleio/test-support/duckdb';
import { MosaicClient, Param, Selection, clausePoint } from '@uwdata/mosaic-core';
import * as mSql from '@uwdata/mosaic-sql';
import {
  FragmentNode,
  Query,
  TableRefNode,
  WithClauseNode,
  and,
  asc,
  column,
  count,
  cte,
  deepClone,
  eq,
  isNull,
  literal,
  not,
  sql,
} from '@uwdata/mosaic-sql';
import type { ExprNode, FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import { beforeEach, describe, expect, expectTypeOf, test } from 'vitest';

import {
  andOrTrue,
  isSameQuerySource,
  selectStarExclude,
  sqlFromParts,
  tableRef,
  toResultRows,
  withRecursive,
} from '../src/index';
import type { SqlTemplateValue } from '../src/index';

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

/** A bare MosaicClient whose query is built by `build`. */
class QueryClient extends MosaicClient {
  constructor(
    filterBy: Selection,
    private readonly build: (filter: FilterExpr) => SelectQuery,
  ) {
    super(filterBy);
  }

  override query(filter: FilterExpr = []): SelectQuery {
    return this.build(filter);
  }
}

async function rows(query: Query | string): Promise<Array<Record<string, unknown>>> {
  return toResultRows(await db.coordinator.query(query, { cache: false }));
}

/** `SELECT 1 AS n UNION ALL SELECT n + 1 FROM t WHERE n < 3`: counts 1..3. */
function countToThree(name = 't'): Query {
  return Query.unionAll(
    Query.select({ n: literal(1) }),
    Query.from(name)
      .select({ n: sql`n + 1` })
      .where(sql`n < 3`),
  );
}

describe('withRecursive', () => {
  test('renders WITH RECURSIVE and runs on DuckDB', async () => {
    const query = withRecursive(Query.from('t').select('n'), 't', countToThree());

    expect(String(query)).toBe(
      'WITH RECURSIVE "t" AS (SELECT 1 AS "n" UNION ALL SELECT n + 1 AS "n" FROM "t" WHERE n < 3) ' +
        'SELECT "n" FROM "t"',
    );
    expect(await rows(query.orderby(asc('n')))).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  test('returns the same query, typed as the input query', () => {
    const query = Query.from('t').select('n');
    const result = withRecursive(query, 't', countToThree());

    expect(result).toBe(query);
    expectTypeOf(result).toEqualTypeOf<SelectQuery>();
  });

  test('keeps earlier CTEs first and puts RECURSIVE on the clause once', async () => {
    const query = Query.from('t')
      .select('n')
      .with(cte('base', Query.select({ n: literal(1) })));
    const step = Query.from('t')
      .select({ n: sql`n + 1` })
      .where(sql`n < 3`);
    withRecursive(query, 't', Query.unionAll(Query.from('base').select('n'), step));
    withRecursive(query, 'u', Query.from('t').select('n'));
    query.with(cte('v', Query.from('u').select('n')));

    expect(String(query)).toBe(
      'WITH RECURSIVE "base" AS (SELECT 1 AS "n"), ' +
        '"t" AS (SELECT "n" FROM "base" UNION ALL SELECT n + 1 AS "n" FROM "t" WHERE n < 3), ' +
        '"u" AS (SELECT "n" FROM "t"), ' +
        '"v" AS (SELECT "n" FROM "u") ' +
        'SELECT "n" FROM "t"',
    );
    // DuckDB does not allow forward CTE references, so order matters.
    expect(await rows(query.orderby(asc('n')))).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  test('passes materialization and column aliases through', async () => {
    const body = Query.unionAll(
      Query.select({ x: literal(1) }),
      Query.from('t')
        .select({ x: sql`n + 1` })
        .where(sql`n < 2`),
    );
    const query = withRecursive(Query.from('t').select('n'), 't', body, {
      materialized: true,
      columnNames: ['n'],
    });

    expect(String(query)).toBe(
      'WITH RECURSIVE "t"("n") AS MATERIALIZED ' +
        '(SELECT 1 AS "x" UNION ALL SELECT n + 1 AS "x" FROM "t" WHERE n < 2) ' +
        'SELECT "n" FROM "t"',
    );
    expect(await rows(query.orderby(asc('n')))).toEqual([{ n: 1 }, { n: 2 }]);

    const notMaterialized = withRecursive(Query.from('t').select('n'), 't', countToThree(), {
      materialized: false,
    });
    expect(String(notMaterialized)).toContain('WITH RECURSIVE "t" AS NOT MATERIALIZED (');
  });

  test('keeps name and query on each WITH entry for pre-aggregation lineage', () => {
    const body = countToThree();
    const query = withRecursive(Query.from('t').select('n'), 't', body);
    const [entry] = query._with;

    // Mosaic's lineage reads `{ name, query }` from every `_with` entry, and
    // `Query.with()` only keeps entries that are `WithClauseNode` instances.
    expect(entry).toBeInstanceOf(WithClauseNode);
    expect(entry?.name).toBe('t');
    expect(entry?.query).toBe(body);

    const rebuilt = Query.from('t').select('n').with(query._with);
    expect(String(rebuilt)).toBe(String(query));
  });

  test('deepClone copies the CTE body, so mutating the clone leaves the original alone', () => {
    const query = withRecursive(
      Query.from('t').select('n'),
      't',
      Query.from('athletes').select('id'),
    );
    const before = String(query);

    const clone = deepClone(query);
    const clonedBody = clone._with[0]?.query as SelectQuery;
    clonedBody.select('name');

    expect(clone._with[0]?.query).not.toBe(query._with[0]?.query);
    expect(String(clone)).toContain('SELECT "id", "name" FROM "athletes"');
    expect(String(query)).toBe(before);
  });

  test('pre-aggregates through a non-self-referencing CTE and backs off for a self-referencing one', async () => {
    const selection = Selection.crossfilter();
    const clause = clausePoint('sport', 'swim', { source: {} });

    // The CTE body reads one base table, so lineage resolves "src" to "athletes".
    const overCte = new QueryClient(selection, (filter) =>
      withRecursive(
        Query.from('src').select({ weight: 'weight', n: count() }).groupby('weight'),
        'src',
        Query.from('athletes').select('*'),
      ).where(filter),
    );
    const info = db.coordinator.preaggregator.request(overCte, selection, clause);
    if (info === null || !('create' in info)) {
      throw new Error(`expected pre-aggregation info, received ${String(info)}`);
    }
    expect(String(info.create)).toMatch(/^WITH RECURSIVE "src" AS \(SELECT \* FROM "athletes"\) /);
    expect(String(info.query(clause))).toMatch(/FROM "mosaic"."preagg_[0-9a-f]+"/);
    await info.result;

    const optimized = await rows(Query.from(info.query(clause)).select('*').orderby(asc('weight')));
    const direct = await rows(
      Query.from(overCte.query(clause.predicate ?? []))
        .select('*')
        .orderby(asc('weight')),
    );
    expect(optimized).toEqual(direct);
    expect(direct).toEqual([
      { weight: 60, n: 1 },
      { weight: 70, n: 1 },
      { weight: 80, n: 1 },
      { weight: 90, n: 1 },
    ]);

    // A self-referencing body has no single base table: standard query path.
    const recursive = new QueryClient(selection, (filter) =>
      withRecursive(
        Query.from('t').select({ n: 'n', c: count() }).groupby('n'),
        't',
        countToThree(),
      ).where(filter),
    );
    expect(db.coordinator.preaggregator.request(recursive, selection, clause)).toBeNull();
  });

  test('rejects invalid input', () => {
    const query = Query.from('t').select('n');
    expect(() => withRecursive(query, '', countToThree())).toThrow(TypeError);
    expect(() => withRecursive(query, 't', sql`SELECT 1` as unknown as Query)).toThrow(TypeError);
    expect(() => withRecursive('SELECT 1' as unknown as SelectQuery, 't', countToThree())).toThrow(
      TypeError,
    );
    expect(query._with).toEqual([]);
  });
});

describe('selectStarExclude', () => {
  test('renders * EXCLUDE (…) with quoted names and runs on DuckDB', async () => {
    const query = selectStarExclude(Query.from('athletes'), ['name', 'weight']).orderby(asc('id'));

    expect(String(query)).toBe(
      'SELECT * EXCLUDE ("name", "weight") FROM "athletes" ORDER BY "id" ASC',
    );
    expect((await rows(query))[0]).toEqual({ id: 1, sport: 'swim' });
  });

  test('appends to the SELECT list and returns the same query', async () => {
    const query = Query.from('athletes').select({ heavy: sql`weight > 75` });
    const result = selectStarExclude(query, ['name', 'weight', 'sport']).orderby(asc('id'));

    expect(result).toBe(query);
    expectTypeOf(result).toEqualTypeOf<SelectQuery>();
    expect(String(query)).toBe(
      'SELECT weight > 75 AS "heavy", * EXCLUDE ("name", "weight", "sport") FROM "athletes" ORDER BY "id" ASC',
    );
    expect((await rows(query))[3]).toEqual({ heavy: true, id: 4 });
  });

  test('escapes double quotes inside a column name', () => {
    expect(String(selectStarExclude(Query.from('t'), ['we"ird']))).toBe(
      'SELECT * EXCLUDE ("we""ird") FROM "t"',
    );
  });

  test('quotes a column named "*" as an identifier, not a wildcard', async () => {
    const source = Query.select({ '*': literal(1), b: literal(2) });
    const query = selectStarExclude(Query.from(source), ['*']);

    expect(String(query)).toBe('SELECT * EXCLUDE ("*") FROM (SELECT 1 AS "*", 2 AS "b")');
    expect(await rows(query)).toEqual([{ b: 2 }]);
  });

  test('an empty exclusion list selects a plain star', () => {
    expect(String(selectStarExclude(Query.from('t'), []))).toBe('SELECT * FROM "t"');
  });

  test('rejects an empty column name', () => {
    expect(() => selectStarExclude(Query.from('t'), ['a', ''])).toThrow(TypeError);
  });
});

describe('sqlFromParts', () => {
  test('matches the sql tag for the same parts', () => {
    const fromParts = sqlFromParts(['coalesce(', ', ', ')'], column('a'), 0);

    expect(fromParts).toBeInstanceOf(FragmentNode);
    expect(String(fromParts)).toBe('coalesce("a", 0)');
    expect(String(fromParts)).toBe(String(sql`coalesce(${column('a')}, ${0})`));
  });

  test('accepts parts built at runtime', () => {
    const columns = ['a', 'b', 'c'];
    const parts = ['greatest(', ...columns.slice(1).map(() => ', '), ')'];

    expect(String(sqlFromParts(parts, ...columns.map((name) => column(name))))).toBe(
      'greatest("a", "b", "c")',
    );
    expect(String(sqlFromParts(['TRUE']))).toBe('TRUE');
  });

  test('keeps params structured and renders literals like the tag', () => {
    const param = Param.value(5);
    const fragment = sqlFromParts(['x > ', ' AND y = ', ''], param, 'raw_sql');

    expect(String(fragment)).toBe('x > 5 AND y = raw_sql');
    param.update(7);
    expect(String(fragment)).toBe('x > 7 AND y = raw_sql');
    expect(String(sqlFromParts(['', ''], new Date(Date.UTC(2026, 0, 2))))).toBe(
      "DATE '2026-01-02'",
    );
  });

  test('interpolates strings as raw SQL, like the tag; literal() quotes string data', () => {
    // Plain strings are spliced in verbatim, exactly as the `sql` tag does.
    expect(String(sqlFromParts(['SELECT ', ''], "O'Reilly"))).toBe("SELECT O'Reilly");
    expect(String(sqlFromParts(['SELECT ', ''], "O'Reilly"))).toBe(
      String(sql`SELECT ${"O'Reilly"}`),
    );
    // Wrap string data in literal() to get a quoted, escaped SQL string.
    expect(String(sqlFromParts(['SELECT ', ''], literal("O'Reilly")))).toBe("SELECT 'O''Reilly'");
    // Numbers, booleans, and dates become SQL literals.
    expect(String(sqlFromParts(['', ', ', ''], 1.5, false))).toBe('1.5, FALSE');
  });

  test('types values as the sql tag does', () => {
    expectTypeOf<SqlTemplateValue>().toEqualTypeOf<Parameters<typeof sql>[1]>();
    // @ts-expect-error objects are not template values
    sqlFromParts(['', ''], { a: 1 });
  });

  test('rejects a part count that does not match the values', () => {
    expect(() => sqlFromParts(['a', 'b'])).toThrow(RangeError);
    expect(() => sqlFromParts(['a'], 1)).toThrow(RangeError);
    expect(() => sqlFromParts([])).toThrow(RangeError);
  });
});

describe('tableRef', () => {
  test('builds a qualified TableRefNode', () => {
    const ref = tableRef('main', 'events');

    expect(ref).toBeInstanceOf(TableRefNode);
    expect(ref.table).toEqual(['main', 'events']);
    expect(String(ref)).toBe('"main"."events"');
    expect(String(Query.from(ref).select('*'))).toBe('SELECT * FROM "main"."events"');
    expect(isSameQuerySource(ref, new TableRefNode(['main', 'events']))).toBe(true);
  });

  test('flattens arrays like the upstream helper', () => {
    expect(String(tableRef(['db', 'main'], 'events'))).toBe('"db"."main"."events"');
    expect(String(tableRef(['main', 'events']))).toBe('"main"."events"');
  });

  test('keeps a dotted name as one identifier', () => {
    expect(String(tableRef('main.events'))).toBe('"main.events"');
  });

  test('works as a query source against DuckDB', async () => {
    expect(await rows(Query.from(tableRef('main', 'athletes')).select({ n: count() }))).toEqual([
      { n: 6 },
    ]);
  });

  test('rejects no names or an empty name', () => {
    expect(() => tableRef()).toThrow(TypeError);
    expect(() => tableRef([])).toThrow(TypeError);
    expect(() => tableRef('main', '')).toThrow(TypeError);
  });
});

describe('andOrTrue', () => {
  test('renders TRUE for no clauses', () => {
    expect(String(andOrTrue())).toBe('TRUE');
    expect(String(andOrTrue(null, []))).toBe('TRUE');
    expect(String(not(andOrTrue()))).toBe('(NOT TRUE)');
  });

  test('renders like and() for one or more clauses', () => {
    expect(String(andOrTrue(eq('a', 1)))).toBe('("a" = 1)');
    expect(String(andOrTrue(eq('a', 1), null, isNull('b')))).toBe('(("a" = 1) AND ("b" IS NULL))');
    expect(String(andOrTrue([eq('a', 1), eq('b', 2)]))).toBe(String(and(eq('a', 1), eq('b', 2))));
  });

  test('filters correctly on DuckDB with and without clauses', async () => {
    const total = (filter: ExprNode) =>
      rows(
        Query.from('athletes')
          .select({ n: count() })
          .where(sql`${filter}`),
      );

    expect(await total(andOrTrue())).toEqual([{ n: 6 }]);
    expect(await total(andOrTrue(eq('sport', literal('run'))))).toEqual([{ n: 2 }]);
  });
});

/**
 * The gaps the helpers cover. When one of these fails after a mosaic-sql
 * upgrade, mosaic-sql ships the equivalent: remove or alias the helper.
 */
describe('upstream gaps', () => {
  test('mosaic-sql does not export a tableRef helper', () => {
    expect('tableRef' in mSql).toBe(false);
  });

  test('mosaic-sql renders an empty and() as an empty string', () => {
    expect(String(and())).toBe('');
  });

  test('mosaic-sql has no recursive CTE flag', () => {
    expect(Object.keys(cte('t', countToThree()))).not.toContain('recursive');
  });
});
