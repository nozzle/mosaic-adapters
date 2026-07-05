import { Selection, clausePoint } from '@uwdata/mosaic-core';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  createAthletesDb,
  settle,
  waitFor,
} from '@nozzleio/test-support/duckdb';
import { createHistogramClient, createRowsClient } from '../src/index';
import type { TestDb } from '@nozzleio/test-support/duckdb';

interface AthleteRow {
  id: number;
  name: string;
  sport: string;
  weight: number;
}

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

// Weights: 55, 60, 65, 70, 80, 90. With step 10, binSpec snaps the discovered
// [55, 90] extent to a nice [50, 90] domain: 50-60 → {55}, 60-70 → {60, 65},
// 70-80 → {70}, 80-90 → {80, 90} (the domain max folds into the last bin).

describe('histogram bins', () => {
  test('bins ride binHistogram over a discovered extent; empty bins are zero-filled', async () => {
    const hist = createHistogramClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'weight',
      inputs: { step: 10 },
    });

    await waitFor(() => {
      expect(hist.store.state.status).toBe('success');
    });

    expect(hist.store.state.extent).toEqual([55, 90]);
    const bins = hist.store.state.bins;
    // Nice snapping expands [55, 90] to [50, 90] with step 10.
    expect(bins.map((b) => [b.x0, b.x1])).toEqual([
      [50, 60],
      [60, 70],
      [70, 80],
      [80, 90],
    ]);
    expect(bins.map((b) => b.count)).toEqual([1, 2, 1, 2]);
    expect(hist.store.state.maxCount).toBe(2);

    hist.destroy();
  });

  test('a fixed extent skips discovery and pins the domain', async () => {
    const hist = createHistogramClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'weight',
      extent: [0, 100],
      inputs: { step: 50 },
    });

    await waitFor(() => {
      expect(hist.store.state.status).toBe('success');
    });
    expect(
      db.connectorQueries.filter((sql) => /min\(/i.test(sql)),
    ).toHaveLength(0);
    // All six weights (55–90) land in the upper [50, 100) bin.
    expect(hist.store.state.bins.map((b) => b.count)).toEqual([0, 6]);

    hist.destroy();
  });

  test('a step change is one re-query; bin boundaries stay stable under peer filters', async () => {
    const $page = Selection.crossfilter();
    const hist = createHistogramClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'weight',
      inputs: { step: 10 },
      filterBy: $page,
    });

    await waitFor(() => {
      expect(hist.store.state.status).toBe('success');
    });
    const queriesAfterInit = db.clientQueries.length;

    hist.setInputs({ step: 20 });
    await waitFor(() => {
      expect(hist.store.state.bins.map((b) => [b.x0, b.x1])).toEqual([
        [40, 60],
        [60, 80],
        [80, 100],
      ]);
    });
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);

    // A peer clause changes the counts, never the boundaries.
    $page.update(
      clausePoint('sport', 'run', { source: { peer: true } as object }),
    );
    await waitFor(() => {
      expect(hist.store.state.bins.map((b) => b.count)).toEqual([1, 1, 0]);
    });
    expect(hist.store.state.bins.map((b) => b.x0)).toEqual([40, 60, 80]);

    hist.destroy();
  });
});

describe('histogram publishing', () => {
  test('setRange publishes an interval clause that filters peers but not its own bins', async () => {
    const $page = Selection.crossfilter();
    const hist = createHistogramClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'weight',
      inputs: { step: 10 },
      filterBy: $page,
      publish: { as: $page },
    });
    const rows = createRowsClient<AthleteRow>({
      coordinator: db.coordinator,
      query: 'athletes',
      filterBy: $page,
      inputs: { orderBy: [{ column: 'id' }] },
    });

    await waitFor(() => {
      expect(hist.store.state.status).toBe('success');
      expect(rows.store.state.rows).toHaveLength(6);
    });
    const binsBefore = hist.store.state.bins;

    hist.setRange([60, 70]);
    expect(hist.store.state.range).toEqual([60, 70]);
    expect($page.clauses).toHaveLength(1);
    expect($page.clauses[0]!.meta).toMatchObject({ type: 'interval' });
    expect($page.clauses[0]!.clients?.has(hist.mosaicClient)).toBe(true);

    // The brush filters the downstream rows client (Ada 60, Bo 70, Fi 65 in
    // id order)…
    await waitFor(() => {
      expect(rows.store.state.rows.map((r) => r.weight)).toEqual([60, 70, 65]);
    });
    // …while crossfilter self-exclusion keeps this histogram's bins intact.
    await settle();
    expect(hist.store.state.bins).toEqual(binsBefore);

    hist.setRange(null);
    expect(hist.store.state.range).toBeNull();
    expect($page.clauses).toHaveLength(0);
    await waitFor(() => {
      expect(rows.store.state.rows).toHaveLength(6);
    });

    hist.destroy();
    rows.destroy();
  });

  test('an external Selection reset clears the tracked range', async () => {
    const $page = Selection.crossfilter();
    const hist = createHistogramClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'weight',
      publish: { as: $page },
    });

    await waitFor(() => {
      expect(hist.store.state.status).toBe('success');
    });
    hist.setRange([60, 70]);
    expect(hist.store.state.range).toEqual([60, 70]);

    $page.reset();
    await waitFor(() => {
      expect(hist.store.state.range).toBeNull();
    });

    hist.destroy();
  });

  test('destroy() clears the published clause', async () => {
    const $page = Selection.crossfilter();
    const hist = createHistogramClient({
      coordinator: db.coordinator,
      from: 'athletes',
      column: 'weight',
      publish: { as: $page },
    });

    await waitFor(() => {
      expect(hist.store.state.status).toBe('success');
    });
    hist.setRange([60, 70]);
    expect($page.clauses).toHaveLength(1);

    hist.destroy();
    // Selection events dispatch async once the Selection has listeners; the
    // destroy-time clear lands on the next tick.
    await waitFor(() => {
      expect($page.clauses).toHaveLength(0);
    });
  });
});
