import {
  FromClauseNode,
  Query,
  count,
  cross_join,
  max,
  row_number,
  sql,
  sum,
} from '@uwdata/mosaic-sql';
import { describe, expect, test } from 'vitest';

import { canPreAggregate, findFilterUnstableShape } from '../src/filter-stability';

const athletes = () => Query.from('athletes');

describe('canPreAggregate', () => {
  test('true only for a SELECT query with an outer structured aggregate', () => {
    expect(canPreAggregate(athletes().select({ n: count() }))).toBe(true);
    expect(canPreAggregate(athletes().select('sport', { n: count() }).groupby('sport'))).toBe(true);
    // Aggregates in HAVING / ORDER BY count too, as they do upstream.
    expect(
      canPreAggregate(
        athletes()
          .select('sport')
          .groupby('sport')
          .having(sql`${count()} > 1`),
      ),
    ).toBe(true);
    expect(
      canPreAggregate(athletes().select('sport').groupby('sport').orderby(max('weight'))),
    ).toBe(true);
  });

  test('false for plain rows, window-only aggregates, wrappers and non-SELECT queries', () => {
    expect(canPreAggregate(athletes().select('id', 'sport'))).toBe(false);
    expect(canPreAggregate(athletes().select('sport').groupby('sport'))).toBe(false);
    expect(canPreAggregate(athletes().select('*', { n: count().window() }))).toBe(false);
    // The rows client's rowCount: 'window' wrapper.
    const grouped = athletes().select('sport', { n: count() }).groupby('sport');
    expect(canPreAggregate(Query.from(grouped).select('*', { t: sql`count(*) OVER ()` }))).toBe(
      false,
    );
    // A grouping only inside a subquery: the outer query has no aggregate.
    expect(canPreAggregate(Query.from(grouped).select('*'))).toBe(false);
    expect(canPreAggregate(Query.union(grouped, grouped))).toBe(false);
    expect(canPreAggregate('SELECT count(*) FROM athletes')).toBe(false);
    expect(canPreAggregate(null)).toBe(false);
  });
});

describe('findFilterUnstableShape', () => {
  test('null for a plain or globally aggregated query', () => {
    expect(findFilterUnstableShape(athletes().select('id', 'sport'))).toBeNull();
    expect(findFilterUnstableShape(athletes().select({ n: count() }))).toBeNull();
    // A scalar or IN subquery belongs to a predicate, not the row domain.
    const inner = athletes().select('sport').groupby('sport');
    expect(
      findFilterUnstableShape(
        athletes()
          .select({ n: count() })
          .where(sql`sport IN (${inner})`),
      ),
    ).toBeNull();
    expect(findFilterUnstableShape(undefined)).toBeNull();
  });

  test('top-level GROUP BY, DISTINCT, QUALIFY, window functions and PIVOT', () => {
    expect(
      findFilterUnstableShape(athletes().select('sport', { n: count() }).groupby('sport')),
    ).toEqual({ clause: 'GROUP BY', nested: false });
    expect(findFilterUnstableShape(athletes().select('sport').distinct())).toEqual({
      clause: 'SELECT DISTINCT',
      nested: false,
    });
    expect(
      findFilterUnstableShape(
        athletes()
          .select('id')
          .qualify(sql`${row_number().orderby('id')} = 1`),
      ),
    ).toEqual({ clause: 'QUALIFY', nested: false });
    expect(findFilterUnstableShape(athletes().select('id', { r: row_number() }))).toEqual({
      clause: 'a window function',
      nested: false,
    });
    expect(findFilterUnstableShape(athletes().select('id', { s: sum('weight').window() }))).toEqual(
      {
        clause: 'a window function',
        nested: false,
      },
    );
    // Window functions written as raw SQL text are recognized as well.
    expect(
      findFilterUnstableShape(athletes().select({ r: sql`rank() OVER (ORDER BY weight)` })),
    ).toEqual({
      clause: 'a window function',
      nested: false,
    });
    expect(findFilterUnstableShape(Query.pivot('athletes').on('sport').using(count()))).toEqual({
      clause: 'PIVOT',
      nested: false,
    });
  });

  test('window functions used only in ORDER BY, top-level and nested', () => {
    const window = { clause: 'a window function', nested: false };
    expect(
      findFilterUnstableShape(athletes().select('id').orderby(row_number().orderby('weight'))),
    ).toEqual(window);
    expect(
      findFilterUnstableShape(
        athletes()
          .select('id')
          .orderby(sql`rank() OVER (ORDER BY weight)`),
      ),
    ).toEqual(window);
    // Top-N by a window ranking inside a FROM subquery, under an outer count().
    const topN = athletes().select('id').orderby(row_number().orderby('weight')).limit(10);
    expect(findFilterUnstableShape(Query.from(topN).select({ n: count() }))).toEqual({
      clause: 'a window function',
      nested: true,
    });
    // A plain ORDER BY is not a window function.
    expect(findFilterUnstableShape(athletes().select('id').orderby('weight'))).toBeNull();
  });

  test('raw SQL text without OVER is not a window function', () => {
    expect(findFilterUnstableShape(athletes().select({ w: sql`weight * 2` }))).toBeNull();
    expect(
      findFilterUnstableShape(
        athletes().select({ w: sql`(SELECT max(weight) OVER () FROM athletes)` }),
      ),
    ).toBeNull();
  });

  test('grouping nested in CTEs, FROM subqueries, joins and set operations', () => {
    const grouped = athletes().select('sport', { n: count() }).groupby('sport');
    const nested = { clause: 'GROUP BY', nested: true };

    // Query.with() CTE.
    expect(
      findFilterUnstableShape(
        Query.with({ g: grouped })
          .from('g')
          .select({ total: sum('n') }),
      ),
    ).toEqual(nested);
    // FROM subquery.
    expect(findFilterUnstableShape(Query.from(grouped).select({ total: sum('n') }))).toEqual(
      nested,
    );
    // Aliased FROM subquery in a comma-separated FROM list.
    expect(
      findFilterUnstableShape(
        Query.from({ a: athletes().select('sport') }, { g: grouped }).select({ n: count() }),
      ),
    ).toEqual(nested);
    // FROM subquery on one side of an explicit JOIN.
    expect(
      findFilterUnstableShape(
        Query.from(cross_join('athletes', new FromClauseNode(grouped, 'g'))).select({ n: count() }),
      ),
    ).toEqual(nested);
    // Set operation members, two levels deep.
    expect(
      findFilterUnstableShape(
        Query.from(Query.unionAll(athletes().select('sport'), grouped)).select({ n: count() }),
      ),
    ).toEqual(nested);
    // DISTINCT nested in a CTE is reported with its own clause name.
    expect(
      findFilterUnstableShape(
        Query.with({ d: athletes().select('sport').distinct() })
          .from('d')
          .select({ n: count() }),
      ),
    ).toEqual({ clause: 'SELECT DISTINCT', nested: true });
  });

  test('fixed histogram bins are still reported (callers opt in with an explicit true)', () => {
    const bins = athletes()
      .select({ bin: sql`floor(weight / 10)`, n: count() })
      .groupby('bin');
    expect(findFilterUnstableShape(bins)).toEqual({ clause: 'GROUP BY', nested: false });
  });
});
