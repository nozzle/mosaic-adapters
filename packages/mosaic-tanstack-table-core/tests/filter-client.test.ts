import { Selection } from '@uwdata/mosaic-core';
import * as mSql from '@uwdata/mosaic-sql';
import { describe, expect, test } from 'vitest';

import { MosaicFilter } from '../src/filter-client';

function popularQuestions(threshold: number) {
  return mSql.Query.select('question')
    .from('data')
    .groupby('question')
    .having(mSql.gte(mSql.count(), threshold));
}

function getPredicateText(selection: Selection) {
  return selection.predicate(null)?.toString() ?? '';
}

describe('MosaicFilter SUBQUERY mode', () => {
  test('apply publishes an IN-subquery predicate without optimizer meta', () => {
    const selection = Selection.intersect();
    const filter = new MosaicFilter({
      selection,
      column: 'question',
      mode: 'SUBQUERY',
      subquery: (value) =>
        value === null ? null : popularQuestions(Number(value)),
    });

    filter.apply(100);

    expect(getPredicateText(selection)).toBe(
      '("question" IN (SELECT "question" FROM "data" GROUP BY "question" HAVING (count(*) >= 100)))',
    );
    expect(selection.clauses[0]?.meta).toBeUndefined();
  });

  test('factories can negate the membership predicate', () => {
    const selection = Selection.intersect();
    const filter = new MosaicFilter({
      selection,
      column: 'question',
      mode: 'SUBQUERY',
      subquery: (value) =>
        value === null
          ? null
          : { query: popularQuestions(Number(value)), negate: true },
    });

    filter.apply(3);

    expect(getPredicateText(selection)).toContain('NOT ("question" IN');
  });

  test('null factory results and dispose clear the clause', () => {
    const selection = Selection.intersect();
    const filter = new MosaicFilter({
      selection,
      column: 'question',
      mode: 'SUBQUERY',
      subquery: (value) =>
        value === null ? null : popularQuestions(Number(value)),
    });

    filter.apply(2);
    expect(selection.clauses).toHaveLength(1);

    filter.apply(null);
    expect(selection.clauses).toHaveLength(0);

    filter.apply(2);
    filter.dispose();
    expect(selection.clauses).toHaveLength(0);
  });

  test('value modes still publish literal-value predicates', () => {
    const selection = Selection.intersect();
    const filter = new MosaicFilter({
      selection,
      column: 'name',
      mode: 'TEXT',
    });

    filter.apply('ali');

    expect(getPredicateText(selection)).toBe('"name" ILIKE \'%ali%\'');
  });
});
