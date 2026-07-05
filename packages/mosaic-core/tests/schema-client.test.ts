import { beforeEach, describe, expect, test } from 'vitest';

import { createAthletesDb, waitFor } from '@nozzleio/test-support/duckdb';
import {
  createRowsClient,
  createSchemaClient,
  resolveCoerce,
} from '../src/index';
import type { TestDb } from '@nozzleio/test-support/duckdb';

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

describe('schema client', () => {
  test("columns: '*' describes every column (read-once)", async () => {
    const schema = createSchemaClient({
      coordinator: db.coordinator,
      table: 'athletes',
    });

    await waitFor(() => {
      expect(schema.store.state.status).toBe('success');
    });
    const fields = schema.store.state.fields;
    expect(fields.map((f) => f.column)).toEqual([
      'id',
      'name',
      'sport',
      'weight',
    ]);
    expect(fields.find((f) => f.column === 'weight')).toMatchObject({
      table: 'athletes',
      type: 'number',
      sqlType: 'INTEGER',
    });

    schema.destroy();
  });

  test('specific columns fetch summary stats', async () => {
    const schema = createSchemaClient({
      coordinator: db.coordinator,
      table: 'athletes',
      columns: ['weight'],
      stats: ['min', 'max', 'distinct'],
    });

    await waitFor(() => {
      expect(schema.store.state.status).toBe('success');
    });
    expect(schema.store.state.fields[0]).toMatchObject({
      column: 'weight',
      min: 55,
      max: 90,
      distinct: 6,
    });

    schema.destroy();
  });

  test('errors surface on the store', async () => {
    const schema = createSchemaClient({
      coordinator: db.coordinator,
      table: 'no_such_table',
    });

    await waitFor(() => {
      expect(schema.store.state.status).toBe('error');
    });
    expect(schema.store.state.error).toBeInstanceOf(Error);

    schema.destroy();
  });
});

describe('coerce descriptors', () => {
  test('a serializable descriptor map coerces per column like the closure form', async () => {
    await db.exec(`
      CREATE TABLE people(id INTEGER, born DATE, score TEXT);
      INSERT INTO people VALUES (1, DATE '1990-05-04', '12.5'), (2, NULL, NULL);
    `);

    const rows = createRowsClient<{
      id: number;
      born: Date | null;
      score: number | null;
    }>({
      coordinator: db.coordinator,
      query: 'people',
      inputs: { orderBy: [{ column: 'id' }] },
      coerce: { born: 'date', score: 'number' },
    });

    await waitFor(() => {
      expect(rows.store.state.rows).toHaveLength(2);
    });
    const [first, second] = rows.store.state.rows;
    expect(first!.born).toBeInstanceOf(Date);
    expect(first!.born!.getUTCFullYear()).toBe(1990);
    expect(first!.score).toBe(12.5);
    // Null values stay null instead of becoming Invalid Date / NaN.
    expect(second!.born).toBeNull();
    expect(second!.score).toBeNull();

    rows.destroy();
  });

  // The descriptor 'date' path (resolveCoerce → coerceValue). Driven directly
  // rather than through DuckDB: an in-range BIGINT surfaces as a JS number and
  // an over-range one as an actual bigint, so a query can't reliably hand the
  // bigint branch the value it needs to see.
  describe("the 'date' descriptor", () => {
    const toDate = resolveCoerce<{ at: Date | null }>({ at: 'date' })!;

    test('millisecond-scale bigint is used verbatim', () => {
      // 2021-05-03T00:00:00Z in epoch ms.
      const { at } = toDate({ at: 1620000000000n });
      expect(at).toBeInstanceOf(Date);
      expect(at!.getUTCFullYear()).toBe(2021);
    });

    test('microsecond-scale bigint is scaled to ms', () => {
      // Same instant in epoch µs; without the /1000 it decodes to ~year 53000.
      const { at } = toDate({ at: 1620000000000000n });
      expect(at).toBeInstanceOf(Date);
      expect(at!.getUTCFullYear()).toBe(2021);
    });

    test('the threshold boundary stays in the millisecond branch', () => {
      // Exactly 10^13 ms (≈ year 2286) is not scaled — only strictly greater.
      const { at } = toDate({ at: 10_000_000_000_000n });
      expect(at!.getTime()).toBe(10_000_000_000_000);
    });

    test('a Date passes through untouched', () => {
      const source = new Date('2021-05-03T00:00:00Z');
      expect(toDate({ at: source }).at).toBe(source);
    });

    test('an ISO string parses through the string path', () => {
      const { at } = toDate({ at: '2021-05-03T00:00:00Z' });
      expect(at).toBeInstanceOf(Date);
      expect(at!.getUTCFullYear()).toBe(2021);
    });

    test('null stays null', () => {
      expect(toDate({ at: null }).at).toBeNull();
    });
  });
});
