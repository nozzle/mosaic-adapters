import { QueryError } from '@uwdata/mosaic-core';
import { Query, literal } from '@uwdata/mosaic-sql';
import { describe, expect, test } from 'vitest';

import { describeQueryError, isQueryCancellation } from '../src/index';

const SQL = Query.from('t').select({ total: literal(1) });

describe('isQueryCancellation', () => {
  test.each(['Canceled', 'Cleared'])('matches the bare %s string', (reason) => {
    expect(isQueryCancellation(reason)).toBe(true);
  });

  test.each(['Canceled', 'Cleared'])('matches an Error carrying %s', (reason) => {
    expect(isQueryCancellation(new Error(reason))).toBe(true);
  });

  test.each(['Canceled', 'Cleared'])('matches a QueryError whose cause is %s', (reason) => {
    // The coordinator wraps the bare string rejection exactly like this.
    expect(isQueryCancellation(new QueryError(reason, SQL))).toBe(true);
    expect(isQueryCancellation(new QueryError(new Error(reason), SQL))).toBe(true);
  });

  test('does not match genuine failures or near-misses', () => {
    expect(isQueryCancellation(new QueryError(new Error('Parser Error'), SQL))).toBe(false);
    expect(isQueryCancellation(new Error('Canceled by the database'))).toBe(false);
    expect(isQueryCancellation('canceled')).toBe(false);
    expect(isQueryCancellation(new Error('Parser Error', { cause: 'Canceled' }))).toBe(false);
  });

  test('does not match non-error values', () => {
    expect(isQueryCancellation(null)).toBe(false);
    expect(isQueryCancellation(undefined)).toBe(false);
    expect(isQueryCancellation(42)).toBe(false);
    expect(isQueryCancellation({ message: 'Canceled' })).toBe(false);
  });
});

describe('describeQueryError', () => {
  test('returns null when there is no error', () => {
    expect(describeQueryError(null)).toBeNull();
    expect(describeQueryError(undefined)).toBeNull();
  });

  test('splits a QueryError into the cause message, the SQL and the cause', () => {
    const cause = new Error('Catalog Error: Table t does not exist');
    const error = new QueryError(cause, SQL);
    expect(error.message).toContain('SQL Query:');

    const description = describeQueryError(error);
    expect(description).toEqual({ message: cause.message, sql: String(SQL), cause });
    expect(description?.message).not.toContain('SQL Query:');
  });

  test('describes a QueryError wrapping a bare string rejection', () => {
    const description = describeQueryError(new QueryError('Cleared', SQL));
    expect(description?.message).toBe('Cleared');
    expect(description?.sql).toBe(String(SQL));
    expect(description?.cause).toBeInstanceOf(Error);
  });

  test('describes a plain Error by its message, with its cause when present', () => {
    expect(describeQueryError(new Error('boom'))).toEqual({ message: 'boom' });
    const cause = new Error('root');
    expect(describeQueryError(new Error('boom', { cause }))).toEqual({ message: 'boom', cause });
  });

  test('describes any other value by its string form', () => {
    expect(describeQueryError('Cleared')).toEqual({ message: 'Cleared' });
    expect(describeQueryError(42)).toEqual({ message: '42' });
  });
});
