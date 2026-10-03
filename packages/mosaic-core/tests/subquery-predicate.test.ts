import { createTestDb } from '@nozzleio/test-support/duckdb';
import * as mSql from '@uwdata/mosaic-sql';
import { describe, expect, test } from 'vitest';

import { SqlIdentifier, emitFilterSpec, subqueryFilterKind } from '../src/index';
import type { FilterSpec } from '../src/index';
import {
  buildSubqueryClauseParts,
  buildSubqueryPredicate,
  normalizeSubqueryFilterQuery,
} from '../src/subquery-predicate';

/** Narrows an optional test value, failing loudly when it is missing. */
function defined<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('expected a value');
  }
  return value;
}

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

describe('buildSubqueryClauseParts', () => {
  test('a single column returns that node as `field` and as the only `fields` entry', () => {
    const parts = buildSubqueryClauseParts({
      column: 'question',
      query: popularQuestions(2),
    });

    expect(parts.predicate).toBeInstanceOf(mSql.InOpNode);
    expect(parts.field).toBe((parts.predicate as mSql.InOpNode).expr);
    expect(parts.fields).toEqual([parts.field]);
    expect(parts.fields[0]).toBe(parts.field);
  });

  test('a one-element array is the same as the bare column', () => {
    const bare = buildSubqueryClauseParts({ column: 'question', query: popularQuestions(2) });
    const listed = buildSubqueryClauseParts({ column: ['question'], query: popularQuestions(2) });

    expect(String(listed.predicate)).toBe(String(bare.predicate));
    expect(listed.field).not.toBeInstanceOf(mSql.TupleNode);
    expect(listed.fields).toEqual([listed.field]);
  });

  test('several columns render a tuple membership test', () => {
    const parts = buildSubqueryClauseParts({
      column: ['domain', 'page.question'],
      query: mSql.Query.select('domain', 'question').from('data'),
    });

    expect(String(parts.predicate)).toBe(
      '(("domain", "page"."question") IN (SELECT "domain", "question" FROM "data"))',
    );
    expect(parts.field).toBeInstanceOf(mSql.TupleNode);
    expect(parts.field).toBe((parts.predicate as mSql.InOpNode).expr);
    // Every `fields` entry is the exact node instance inside the tuple.
    expect(parts.fields).toHaveLength(2);
    expect(parts.fields).toEqual([...(parts.field as mSql.TupleNode).values]);
    expect(parts.fields[0]).toBe((parts.field as mSql.TupleNode).values[0]);
    expect(parts.fields[1]).toBe((parts.field as mSql.TupleNode).values[1]);
  });

  test('negate wraps a tuple membership test in NOT; SqlIdentifier entries are accepted', () => {
    const predicate = buildSubqueryPredicate({
      column: [SqlIdentifier.from('a'), 'b'],
      query: mSql.Query.select('a', 'b').from('t'),
      negate: true,
    });

    expect(String(predicate)).toBe('(NOT (("a", "b") IN (SELECT "a", "b" FROM "t")))');
  });

  test('columnPaths: literal reads every composite entry as one identifier', () => {
    const parts = buildSubqueryClauseParts({
      column: ['meta.domain', 'page.question'],
      columnPaths: 'literal',
      query: mSql.Query.select('domain', 'question').from('data'),
    });

    expect(String(parts.predicate)).toBe(
      '(("meta.domain", "page.question") IN (SELECT "domain", "question" FROM "data"))',
    );
    expect(parts.fields.map((field) => String(field))).toEqual([
      '"meta.domain"',
      '"page.question"',
    ]);
  });

  test('an empty column list throws', () => {
    expect(() => buildSubqueryClauseParts({ column: [], query: popularQuestions(1) })).toThrow(
      /at least one column/,
    );
  });

  test('a tuple holding a NULL never matches, negated or not (DuckDB)', async () => {
    const db = await createTestDb();
    await db.exec(`
      CREATE TABLE pairs(id INTEGER, a INTEGER, b TEXT);
      INSERT INTO pairs VALUES (1, 1, 'x'), (2, 2, 'y'), (3, NULL, 'x'), (4, 1, NULL);
      CREATE TABLE allowed(a INTEGER, b TEXT);
      INSERT INTO allowed VALUES (1, 'x'), (NULL, 'x');
    `);
    const ids = async (negate: boolean, empty = false): Promise<Array<number>> => {
      const query = mSql.Query.select('a', 'b').from('allowed');
      if (empty) {
        query.where(mSql.literal(false));
      }
      const predicate = buildSubqueryPredicate({ column: ['a', 'b'], query, negate });
      const result = await db.coordinator.query(
        mSql.Query.from('pairs').select('id').where(predicate).orderby('id'),
      );
      return result.toArray().map((row) => row.id as number);
    };

    // Row 3 (NULL a) and row 4 (NULL b) are dropped by both forms.
    expect(await ids(false)).toEqual([1]);
    // Row 2 is dropped from the NOT form too: the allowed set holds
    // (NULL, 'x'), so `(2, 'y') IN (...)` is unknown, not false.
    expect(await ids(true)).toEqual([]);
    // An empty subquery makes every test false, never unknown: nothing
    // matches, and the NOT form keeps every row, NULL keys included.
    expect(await ids(false, true)).toEqual([]);
    expect(await ids(true, true)).toEqual([1, 2, 3, 4]);
  });
});

describe('subqueryFilterKind fields', () => {
  const spec: FilterSpec = { id: 'm', column: 'domain', kind: 'membership', value: 3 };

  test('emits the outer column node as `fields`', () => {
    const membership = subqueryFilterKind(() => mSql.Query.select('domain').from('data'));
    const [emission] = emitFilterSpec(spec, { kinds: { membership } });

    expect(String(emission?.predicate)).toBe('("domain" IN (SELECT "domain" FROM "data"))');
    expect(emission?.fields).toHaveLength(1);
    expect(emission?.fields[0]).toBe((defined(emission).predicate as mSql.InOpNode).expr);
  });

  test('`columns` builds a composite-key membership with one field per column', () => {
    const membership = subqueryFilterKind(
      () => mSql.Query.select('domain', 'question').from('data'),
      { columns: ['domain', 'question'] },
    );
    const [emission] = emitFilterSpec(spec, { kinds: { membership } });

    expect(String(emission?.predicate)).toBe(
      '(("domain", "question") IN (SELECT "domain", "question" FROM "data"))',
    );
    const tuple = (defined(emission).predicate as mSql.InOpNode).expr as mSql.TupleNode;
    expect(emission?.fields).toHaveLength(2);
    expect(emission?.fields[0]).toBe(tuple.values[0]);
    expect(emission?.fields[1]).toBe(tuple.values[1]);
  });

  test('the spec columnPaths applies to every `columns` entry', () => {
    const membership = subqueryFilterKind(
      () => mSql.Query.select('domain', 'question').from('data'),
      { columns: ['meta.domain', 'question'] },
    );
    const [emission] = emitFilterSpec(
      { ...spec, columnPaths: 'literal' },
      { kinds: { membership } },
    );

    expect(String(emission?.predicate)).toBe(
      '(("meta.domain", "question") IN (SELECT "domain", "question" FROM "data"))',
    );
  });

  test('an empty `columns` list throws at construction', () => {
    expect(() =>
      subqueryFilterKind(() => mSql.Query.select('a').from('t'), { columns: [] }),
    ).toThrow(/at least one column/);
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
