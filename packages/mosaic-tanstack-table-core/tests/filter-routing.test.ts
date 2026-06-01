import { describe, expect, test } from 'vitest';
import * as mSql from '@uwdata/mosaic-sql';

import { applyRoutedFilters, routeFilter } from '../src/query/filter-routing';

describe('filter routing', () => {
  test('defaults predicates to WHERE', () => {
    const predicate = mSql.eq(mSql.column('status'), mSql.literal('active'));
    const routed = routeFilter(predicate);

    expect(routed?.target).toBe('where');
    expect(routed?.predicate).toBe(predicate);
  });

  test('explicit WHERE matches direct where output', () => {
    const predicate = mSql.eq(mSql.column('status'), mSql.literal('active'));
    const direct = mSql.Query.from('athletes').select('*').where(predicate);
    const routed = mSql.Query.from('athletes').select('*');

    applyRoutedFilters(routed, [routeFilter(predicate, 'where')]);

    expect(routed.toString()).toBe(direct.toString());
  });

  test('explicit HAVING matches direct having output', () => {
    const predicate = mSql.sql`COUNT(*) >= 2`;
    const direct = mSql.Query.from('athletes')
      .select({ country: mSql.column('country'), count: mSql.count() })
      .groupby('country')
      .having(predicate);
    const routed = mSql.Query.from('athletes')
      .select({ country: mSql.column('country'), count: mSql.count() })
      .groupby('country');

    applyRoutedFilters(routed, [routeFilter(predicate, 'having')]);

    expect(routed.toString()).toBe(direct.toString());
  });

  test('applies WHERE and HAVING predicates to separate clauses', () => {
    const wherePredicate = mSql.eq(mSql.column('sex'), mSql.literal('Female'));
    const havingPredicate = mSql.sql`SUM("gold") >= 3`;
    const statement = mSql.Query.from('athletes')
      .select({ country: mSql.column('country'), total_gold: mSql.sum('gold') })
      .groupby('country');

    applyRoutedFilters(statement, [
      routeFilter(wherePredicate, 'where'),
      routeFilter(havingPredicate, 'having'),
    ]);

    const sql = statement.toString();
    expect(sql).toContain('"sex" = \'Female\'');
    expect(sql).toContain('HAVING SUM("gold") >= 3');
  });

  test('ignores null and undefined predicates', () => {
    const statement = mSql.Query.from('athletes').select('*');

    applyRoutedFilters(statement, [
      routeFilter(null),
      routeFilter(undefined, 'where'),
      routeFilter(undefined, 'having'),
    ]);

    expect(statement.toString()).not.toContain('WHERE');
    expect(statement.toString()).not.toContain('HAVING');
  });
});
