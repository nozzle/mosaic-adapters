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

  test('ignores null and undefined predicates', () => {
    const statement = mSql.Query.from('athletes').select('*');

    applyRoutedFilters(statement, [
      routeFilter(null),
      routeFilter(undefined, 'where'),
    ]);

    expect(statement.toString()).not.toContain('WHERE');
  });
});
