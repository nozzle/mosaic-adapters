import { Selection, clausePoint } from '@uwdata/mosaic-core';
import { beforeEach, describe, expect, test } from 'vitest';

import { createPivotClient } from '../src/index';
import { createTestDb, waitFor } from './test-utils';
import type { TestDb } from './test-utils';

interface SalesRow extends Record<string, unknown> {
  region: string;
}

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  await db.exec(`
    CREATE TABLE sales(region TEXT, quarter TEXT, amount INTEGER);
    INSERT INTO sales VALUES
      ('east', 'Q1', 10),
      ('east', 'Q1', 5),
      ('east', 'Q2', 20),
      ('west', 'Q1', 7),
      ('west', 'Q3', 40);
  `);
});

describe('pivot client', () => {
  test('PIVOT with dynamic columns discovered from the result schema', async () => {
    const pivot = createPivotClient<SalesRow>({
      coordinator: db.coordinator,
      from: 'sales',
      on: 'quarter',
      using: [{ agg: 'sum', column: 'amount', as: 'total' }],
      groupBy: ['region'],
      inputs: { orderBy: [{ column: 'region' }] },
    });

    await waitFor(() => {
      expect(pivot.store.state.status).toBe('success');
    });

    // Columns derive from the data, not the config; the aggregate alias
    // suffixes each pivot value column (DuckDB naming).
    expect(pivot.store.state.pivotColumns).toEqual([
      'Q1_total',
      'Q2_total',
      'Q3_total',
    ]);
    const rows = pivot.store.state.rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ region: 'east' });
    expect(Number(rows[0]!.Q1_total)).toBe(15);
    expect(Number(rows[0]!.Q2_total)).toBe(20);
    expect(rows[0]!.Q3_total).toBeNull();
    expect(Number(rows[1]!.Q3_total)).toBe(40);

    pivot.destroy();
  });

  test('cross-filtering re-pivots and re-discovers the columns', async () => {
    const $page = Selection.crossfilter();
    const pivot = createPivotClient<SalesRow>({
      coordinator: db.coordinator,
      from: 'sales',
      on: 'quarter',
      using: [{ agg: 'count' }],
      groupBy: ['region'],
      filterBy: $page,
      inputs: { orderBy: [{ column: 'region' }] },
    });

    await waitFor(() => {
      expect(pivot.store.state.pivotColumns).toEqual(['Q1', 'Q2', 'Q3']);
    });

    // Filtering away Q2/Q3 rows shrinks the dynamic column set.
    $page.update(
      clausePoint('quarter', 'Q1', { source: { peer: true } as object }),
    );
    await waitFor(() => {
      expect(pivot.store.state.pivotColumns).toEqual(['Q1']);
    });
    expect(pivot.store.state.rows).toHaveLength(2);

    pivot.destroy();
  });

  test('pinned `in` values fix the column set regardless of the data', async () => {
    const pivot = createPivotClient<SalesRow>({
      coordinator: db.coordinator,
      from: 'sales',
      on: 'quarter',
      using: [{ agg: 'sum', column: 'amount' }],
      groupBy: ['region'],
      in: ['Q1', 'Q4'],
      inputs: { orderBy: [{ column: 'region' }] },
    });

    await waitFor(() => {
      expect(pivot.store.state.status).toBe('success');
    });
    // Unaliased single aggregate keeps bare value column names.
    expect(pivot.store.state.pivotColumns).toEqual(['Q1', 'Q4']);
    expect(pivot.store.state.rows[0]!.Q4).toBeNull();

    pivot.destroy();
  });

  test('invalid aggregates throw at creation', () => {
    expect(() =>
      createPivotClient({
        coordinator: db.coordinator,
        from: 'sales',
        on: 'quarter',
        using: [],
        groupBy: ['region'],
      }),
    ).toThrowError(/at least one/);

    expect(() =>
      createPivotClient({
        coordinator: db.coordinator,
        from: 'sales',
        on: 'quarter',
        using: [{ agg: 'sum' }],
        groupBy: ['region'],
      }),
    ).toThrowError(/requires a column/);
  });
});
