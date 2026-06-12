import { Selection } from '@uwdata/mosaic-core';
import * as mSql from '@uwdata/mosaic-sql';
import { describe, expect, test } from 'vitest';

import {
  createClearClause,
  createSubqueryClause,
  createValueClause,
} from '../src/clause-factory';
import { buildSubqueryPredicate } from '../src/subquery-predicate';

function createSource(id: string) {
  return { id };
}

describe('clause-factory', () => {
  test('createValueClause preserves the full clause shape', () => {
    const source = createSource('value-clause');
    const clients = new Set<never>();
    const predicate = mSql.eq(mSql.column('a'), mSql.literal(1));

    const clause = createValueClause({
      source,
      clients,
      value: [1],
      predicate,
      meta: { type: 'point' },
    });

    expect(clause).toEqual({
      source,
      clients,
      value: [1],
      predicate,
      meta: { type: 'point' },
    });
  });

  test('createValueClause leaves clients and meta undefined when omitted', () => {
    const source = createSource('bare-value-clause');
    const predicate = mSql.eq(mSql.column('a'), mSql.literal(1));

    const clause = createValueClause({ source, value: 1, predicate });

    expect(clause.clients).toBeUndefined();
    expect(clause.meta).toBeUndefined();
  });

  test('createSubqueryClause never carries optimizer meta', () => {
    const source = createSource('subquery-clause');
    const predicate = buildSubqueryPredicate({
      column: 'question',
      query: mSql.Query.select('question').from('data'),
    });

    const clause = createSubqueryClause({
      source,
      value: { threshold: 100 },
      predicate,
    });

    expect(clause).toEqual({
      source,
      clients: undefined,
      value: { threshold: 100 },
      predicate,
    });
    expect('meta' in clause).toBe(false);
  });

  test('createClearClause produces a null value and predicate', () => {
    const source = createSource('clear-clause');

    expect(createClearClause(source)).toEqual({
      source,
      clients: undefined,
      value: null,
      predicate: null,
    });
  });

  test('value and clear clauses round-trip through a Selection', () => {
    const selection = Selection.intersect();
    const source = createSource('round-trip');

    selection.update(
      createValueClause({
        source,
        value: 'x',
        predicate: mSql.eq(mSql.column('a'), mSql.literal('x')),
      }),
    );

    expect(selection.clauses).toHaveLength(1);
    expect(selection.valueFor(source)).toBe('x');

    selection.update(createClearClause(source));

    expect(selection.clauses).toHaveLength(0);
  });
});
