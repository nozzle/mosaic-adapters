import { createAthletesDb, waitFor } from '@nozzleio/test-support/duckdb';
import type { TestDb } from '@nozzleio/test-support/duckdb';
import { Query, asc, column } from '@uwdata/mosaic-sql';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  createHistogramClient,
  firstResultRow,
  histogramBinning,
  histogramBinsFromRows,
  histogramExtentQuery,
  histogramFilter,
  histogramSelect,
  toResultRows,
} from '../src/index';
import type { HistogramBinning } from '../src/index';

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

/** The building-block recipe the docs show, run against a real coordinator. */
async function binWithHelpers(
  binningOptions: Omit<Parameters<typeof histogramBinning>[0], 'extent'> & {
    extent?: [number, number];
  },
): Promise<{ binning: HistogramBinning; result: ReturnType<typeof histogramBinsFromRows> }> {
  let extent = binningOptions.extent;
  if (extent === undefined) {
    const row = firstResultRow(
      await db.coordinator.query(
        histogramExtentQuery('athletes', 'weight', { scale: binningOptions.scale }),
      ),
    );
    extent = [Number(row?.min), Number(row?.max)];
  }
  const binning = histogramBinning({ ...binningOptions, extent });
  const query = Query.from('athletes')
    .select(histogramSelect('weight', binning))
    .where(histogramFilter('weight', binning))
    .groupby('x0')
    .orderby(asc('x0'));
  const rows = toResultRows(await db.coordinator.query(query));
  return { binning, result: histogramBinsFromRows(rows, binning) };
}

describe('histogram building blocks', () => {
  test('reproduce the histogram client bins over a discovered extent', async () => {
    const hist = createHistogramClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'weight',
      inputs: { step: 10 },
    });
    await waitFor(() => {
      expect(hist.store.state.status).toBe('success');
    });

    const { binning, result } = await binWithHelpers({ step: 10 });
    expect(binning.extent).toEqual([55, 90]);
    expect(result.bins).toEqual(hist.store.state.bins);
    expect(result.maxCount).toBe(hist.store.state.maxCount);
    expect(result.bins.map((bin) => bin.count)).toEqual([1, 2, 1, 2]);

    hist.destroy();
  });

  test('reproduce the histogram client bins on a log scale', async () => {
    const hist = createHistogramClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'weight',
      scale: 'log',
      inputs: { bins: 4 },
    });
    await waitFor(() => {
      expect(hist.store.state.status).toBe('success');
    });

    const { result } = await binWithHelpers({ scale: 'log', bins: 4 });
    expect(result.bins).toEqual(hist.store.state.bins);
    expect(result.bins.reduce((total, bin) => total + bin.count, 0)).toBe(6);

    hist.destroy();
  });

  test('a fixed extent zero-fills empty bins', async () => {
    const { result } = await binWithHelpers({ extent: [0, 100], step: 50 });
    expect(result.bins).toEqual([
      { x0: 0, x1: 50, count: 0 },
      { x0: 50, x1: 100, count: 6 },
    ]);
    expect(result.maxCount).toBe(6);
  });
});

describe('histogramBinning', () => {
  test('defaults to a linear, nice, 25-step hint', () => {
    const binning = histogramBinning({ extent: [0, 100] });
    expect(binning.scale).toBe('linear');
    expect(binning.options).toEqual({ step: undefined, steps: 25, nice: undefined });
    expect(binning.spec.min).toBe(0);
    expect(binning.spec.max).toBe(100);
    expect(binning.spec.steps).toBeGreaterThan(0);
  });

  test('log bins stay pinned to the exact extent', () => {
    const binning = histogramBinning({ extent: [1, 1000], scale: 'log', bins: 3 });
    expect(binning.options.nice).toBe(false);
    expect(binning.spec.min).toBe(0);
    expect(binning.spec.max).toBeCloseTo(Math.log(1000));
    expect(binning.spec.steps).toBe(3);
  });

  test('log scale rejects a non-positive extent', () => {
    expect(() => histogramBinning({ extent: [0, 10], scale: 'log' })).toThrow(
      'Histogram log scale requires a positive extent.',
    );
  });

  test('does not alias the caller extent', () => {
    const extent: [number, number] = [0, 10];
    const binning = histogramBinning({ extent });
    extent[0] = 5;
    expect(binning.extent).toEqual([0, 10]);
  });
});

describe('histogram SQL helpers', () => {
  test('histogramExtentQuery selects min/max, filtering non-positive values for log', () => {
    expect(String(histogramExtentQuery('athletes', 'weight'))).toBe(
      'SELECT min("weight") AS "min", max("weight") AS "max" FROM "athletes"',
    );
    expect(String(histogramExtentQuery('athletes', 'weight', { scale: 'log' }))).toContain(
      'WHERE ("weight" > 0)',
    );
  });

  test('a dotted column is a struct path unless columnPaths is literal', () => {
    expect(String(histogramExtentQuery('t', 'stats.score'))).toContain('min("stats"."score")');
    expect(String(histogramExtentQuery('t', 'stats.score', { columnPaths: 'literal' }))).toContain(
      'min("stats.score")',
    );
    const binning = histogramBinning({ extent: [0, 10] });
    expect(String(histogramFilter('stats.score', binning))).toContain(
      '"stats"."score" IS NOT NULL',
    );
  });

  test('an expression column is used as-is', () => {
    const binning = histogramBinning({ extent: [0, 10] });
    const select = histogramSelect(column('w'), binning);
    expect(String(select.x0)).toContain('"w"');
    expect(String(select.count)).toBe('count(*)');
  });

  test('histogramFilter drops NULLs, and non-positive values on a log scale', () => {
    const linear = String(histogramFilter('weight', histogramBinning({ extent: [1, 10] })));
    expect(linear).toContain('"weight" IS NOT NULL');
    expect(linear).not.toContain('> 0');
    const log = String(
      histogramFilter('weight', histogramBinning({ extent: [1, 10], scale: 'log' })),
    );
    expect(log).toContain('"weight" IS NOT NULL');
    expect(log).toContain('"weight" > 0');
  });
});

describe('histogramBinsFromRows', () => {
  test('folds rows into contiguous bins and tracks the max count', () => {
    const binning = histogramBinning({ extent: [0, 30], step: 10 });
    const { bins, maxCount } = histogramBinsFromRows(
      [
        { x0: 0, count: 2 },
        { x0: 20, count: 5n },
      ],
      binning,
    );
    expect(bins).toEqual([
      { x0: 0, x1: 10, count: 2 },
      { x0: 10, x1: 20, count: 0 },
      { x0: 20, x1: 30, count: 5 },
    ]);
    expect(maxCount).toBe(5);
  });

  test('a row at the domain max folds into the last bin', () => {
    const binning = histogramBinning({ extent: [0, 20], step: 10 });
    const { bins } = histogramBinsFromRows([{ x0: 20, count: 1 }], binning);
    expect(bins.map((bin) => bin.count)).toEqual([0, 1]);
  });

  test('a degenerate extent yields no bins', () => {
    const binning = histogramBinning({ extent: [5, 5] });
    expect(histogramBinsFromRows([{ x0: 5, count: 3 }], binning)).toEqual({
      bins: [],
      maxCount: 0,
    });
  });
});
