import { createAthletesDb } from '@nozzleio/test-support/duckdb';
import type { TestDb } from '@nozzleio/test-support/duckdb';
import { Query, asc, count } from '@uwdata/mosaic-sql';
import { beforeEach, describe, expect, test } from 'vitest';

import { firstResultRow, resultRowCount, toResultRows } from '../src/index';

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

describe('result-row helpers on Arrow results', () => {
  test('toResultRows, firstResultRow and resultRowCount read a coordinator table', async () => {
    const result = await db.coordinator.query(
      Query.from('athletes').select('id', 'name').orderby(asc('id')),
    );

    expect(resultRowCount(result)).toBe(6);
    expect(toResultRows(result)).toHaveLength(6);
    const first = firstResultRow(result);
    expect(first?.id).toBe(1);
    expect(first?.name).toBe('Ada');
  });

  test('an empty result has no first row and a zero count', async () => {
    const result = await db.coordinator.query(
      Query.from('athletes').select('id').where("sport = 'none'"),
    );

    expect(resultRowCount(result)).toBe(0);
    expect(firstResultRow(result)).toBeUndefined();
    expect(toResultRows(result)).toEqual([]);
  });

  test('firstResultRow reads a single aggregate row', async () => {
    const result = await db.coordinator.query(Query.from('athletes').select({ n: count() }));
    expect(Number(firstResultRow(result)?.n)).toBe(6);
  });
});

describe('result-row helpers on JSON-shaped and unexpected results', () => {
  test('arrays pass through', () => {
    const rows = [{ a: 1 }, { a: 2 }];
    expect(toResultRows(rows)).toBe(rows);
    expect(firstResultRow(rows)).toBe(rows[0]);
    expect(resultRowCount(rows)).toBe(2);
    expect(firstResultRow([])).toBeUndefined();
  });

  test('a toArray()-only result is materialized', () => {
    const data = { toArray: () => [{ a: 1 }] };
    expect(firstResultRow(data)).toEqual({ a: 1 });
    expect(resultRowCount(data)).toBe(1);
  });

  test('get(0) is preferred over toArray()', () => {
    let materialized = false;
    const data = {
      numRows: 2,
      get: (index: number) => ({ index }),
      toArray: () => {
        materialized = true;
        return [];
      },
    };
    expect(firstResultRow(data)).toEqual({ index: 0 });
    expect(resultRowCount(data)).toBe(2);
    expect(materialized).toBe(false);
  });

  test('non-results read as empty', () => {
    for (const value of [undefined, null, 42, 'rows', {}]) {
      expect(toResultRows(value)).toEqual([]);
      expect(firstResultRow(value)).toBeUndefined();
      expect(resultRowCount(value)).toBe(0);
    }
    expect(firstResultRow([null])).toBeUndefined();
  });
});
