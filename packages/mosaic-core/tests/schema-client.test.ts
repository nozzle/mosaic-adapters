import { beforeEach, describe, expect, test } from 'vitest';

import { createRowsClient, createSchemaClient } from '../src/index';
import { createAthletesDb, waitFor } from './test-utils';
import type { TestDb } from './test-utils';

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
});
