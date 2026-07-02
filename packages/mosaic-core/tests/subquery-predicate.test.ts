import * as mSql from '@uwdata/mosaic-sql';
import { describe, expect, test } from 'vitest';

import {
  buildSubqueryPredicate,
  normalizeSubqueryFilterQuery,
} from '../src/filter-builder/subquery-predicate';

function popularQuestions(threshold: number) {
  return mSql.Query.select('question')
    .from('data')
    .groupby('question')
    .having(mSql.gte(mSql.count(), threshold));
}

describe('buildSubqueryPredicate', () => {
  test('builds an IN membership predicate over a scalar subquery', () => {
    const predicate = buildSubqueryPredicate({
      column: 'question',
      query: popularQuestions(100),
    });

    expect(String(predicate)).toBe(
      '("question" IN (SELECT "question" FROM "data" GROUP BY "question" HAVING (count(*) >= 100)))',
    );
  });

  test('negate wraps the membership predicate in NOT', () => {
    const predicate = buildSubqueryPredicate({
      column: 'question',
      query: popularQuestions(3),
      negate: true,
    });

    expect(String(predicate)).toBe(
      '(NOT ("question" IN (SELECT "question" FROM "data" GROUP BY "question" HAVING (count(*) >= 3))))',
    );
  });

  test('supports struct paths for the outer column', () => {
    const predicate = buildSubqueryPredicate({
      column: 'payload.question',
      query: mSql.Query.select('question').from('data'),
    });

    expect(String(predicate)).toContain('"payload"');
    expect(String(predicate)).toContain('IN (SELECT "question" FROM "data")');
  });
});

describe('normalizeSubqueryFilterQuery', () => {
  test('passes through bare queries without negation', () => {
    const query = popularQuestions(2);

    expect(normalizeSubqueryFilterQuery(query)).toEqual({
      query,
      negate: false,
    });
  });

  test('unwraps object results and defaults negate to false', () => {
    const query = popularQuestions(2);

    expect(normalizeSubqueryFilterQuery({ query })).toEqual({
      query,
      negate: false,
    });
    expect(normalizeSubqueryFilterQuery({ query, negate: true })).toEqual({
      query,
      negate: true,
    });
  });

  test('returns null for empty results', () => {
    expect(normalizeSubqueryFilterQuery(null)).toBeNull();
  });
});
