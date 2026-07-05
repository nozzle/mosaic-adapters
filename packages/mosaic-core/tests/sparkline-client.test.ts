import { Selection, clausePoint } from '@uwdata/mosaic-core';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  createAthletesDb,
  settle,
  waitFor,
} from '@nozzleio/test-support/duckdb';
import { createSparklineClient } from '../src/index';
import type { TestDb } from '@nozzleio/test-support/duckdb';

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

describe('sparkline batching', () => {
  test('one query serves every key: WHERE key IN (…) GROUP BY key, x', async () => {
    const spark = createSparklineClient({
      coordinator: db.coordinator,
      from: 'athletes',
      key: 'sport',
      x: { column: 'weight', step: 10 },
      y: { agg: 'count' },
      inputs: { keys: ['swim', 'run'] },
    });

    await waitFor(() => {
      expect(spark.store.state.status).toBe('success');
    });
    expect(db.clientQueries).toHaveLength(1);

    const series = spark.store.state.series;
    expect([...series.keys()].sort()).toEqual(['run', 'swim']);
    // swim weights 60, 70, 80, 90 → floor-to-10 bins.
    expect(series.get('swim')).toEqual([
      { x: 60, y: 1 },
      { x: 70, y: 1 },
      { x: 80, y: 1 },
      { x: 90, y: 1 },
    ]);
    // run weights 55, 65.
    expect(series.get('run')).toEqual([
      { x: 50, y: 1 },
      { x: 60, y: 1 },
    ]);

    spark.destroy();
  });

  test('a keys change is exactly one re-query; unchanged keys none', async () => {
    const spark = createSparklineClient({
      coordinator: db.coordinator,
      from: 'athletes',
      key: 'sport',
      x: { column: 'weight', step: 10 },
      y: { agg: 'count' },
      inputs: { keys: ['swim'] },
    });

    await waitFor(() => {
      expect(spark.store.state.series.size).toBe(1);
    });
    const queriesAfterInit = db.clientQueries.length;

    spark.setInputs({ keys: ['swim'] });
    await settle();
    expect(db.clientQueries.length).toBe(queriesAfterInit);

    spark.setInputs({ keys: ['swim', 'run'] });
    await waitFor(() => {
      expect(spark.store.state.series.size).toBe(2);
    });
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);

    spark.destroy();
  });

  test('empty keys resolve to an empty series', async () => {
    const spark = createSparklineClient({
      coordinator: db.coordinator,
      from: 'athletes',
      key: 'sport',
      x: { column: 'weight', step: 10 },
      y: { agg: 'count' },
    });

    await waitFor(() => {
      expect(spark.store.state.status).toBe('success');
    });
    expect(spark.store.state.series.size).toBe(0);

    spark.destroy();
  });
});

describe('sparkline declarative x/y', () => {
  test('date interval binning with agg modes (the PAA shape)', async () => {
    await db.exec(`
      CREATE TABLE metrics(phrase TEXT, requested DATE, search_volume INTEGER);
      INSERT INTO metrics VALUES
        ('alpha', DATE '2026-01-01', 100),
        ('alpha', DATE '2026-01-01', 250),
        ('alpha', DATE '2026-01-02', 50),
        ('beta',  DATE '2026-01-01', 10),
        ('beta',  DATE '2026-01-03', 30);
    `);

    const spark = createSparklineClient({
      coordinator: db.coordinator,
      from: 'metrics',
      key: 'phrase',
      x: { column: 'requested', interval: 'day' },
      y: { agg: 'max', column: 'search_volume' },
      inputs: { keys: ['alpha', 'beta'] },
    });

    await waitFor(() => {
      expect(spark.store.state.series.size).toBe(2);
    });

    const alpha = spark.store.state.series.get('alpha')!;
    expect(alpha.map((p) => p.y)).toEqual([250, 50]);
    const days = alpha.map((p) =>
      p.x instanceof Date
        ? p.x.getUTCDate()
        : new Date(Number(p.x)).getUTCDate(),
    );
    expect(days).toEqual([1, 2]);
    expect(spark.store.state.series.get('beta')!.map((p) => p.y)).toEqual([
      10, 30,
    ]);

    spark.destroy();
  });

  test('raw x column and sum aggregate', async () => {
    const spark = createSparklineClient({
      coordinator: db.coordinator,
      from: 'athletes',
      key: 'sport',
      x: { column: 'id' },
      y: { agg: 'sum', column: 'weight' },
      inputs: { keys: ['run'] },
    });

    await waitFor(() => {
      expect(spark.store.state.series.get('run')).toEqual([
        { x: 5, y: 55 },
        { x: 6, y: 65 },
      ]);
    });

    spark.destroy();
  });

  test('non-count aggregates require a column', () => {
    expect(() =>
      createSparklineClient({
        coordinator: db.coordinator,
        from: 'athletes',
        key: 'sport',
        x: { column: 'weight' },
        y: { agg: 'max' },
      }),
    ).toThrowError(/requires a column/);
  });
});

describe('sparkline filtering', () => {
  test('series cascade with the page Selection', async () => {
    const $page = Selection.crossfilter();
    const spark = createSparklineClient({
      coordinator: db.coordinator,
      from: 'athletes',
      key: 'sport',
      x: { column: 'weight', step: 10 },
      y: { agg: 'count' },
      filterBy: $page,
      inputs: { keys: ['swim', 'run'] },
    });

    await waitFor(() => {
      expect(spark.store.state.series.size).toBe(2);
    });

    $page.update(
      clausePoint('name', 'Ada', { source: { peer: true } as object }),
    );
    await waitFor(() => {
      expect(spark.store.state.series.size).toBe(1);
      expect(spark.store.state.series.get('swim')).toEqual([{ x: 60, y: 1 }]);
    });

    spark.destroy();
  });
});
