import { Selection, clausePoint } from '@uwdata/mosaic-core';
import { Query, avg, count, max } from '@uwdata/mosaic-sql';
import { beforeEach, describe, expect, test } from 'vitest';

import { createAthletesDb, waitFor } from '@nozzleio/test-support/duckdb';
import { createValuesClient } from '../src/index';
import type { TestDb } from '@nozzleio/test-support/duckdb';

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

describe('values client', () => {
  test('a single-row aggregate query becomes a typed record (N KPIs, one round trip)', async () => {
    const $page = Selection.crossfilter();

    const kpis = createValuesClient<{
      athletes: number;
      maxWeight: number;
      avgWeight: number;
    }>({
      coordinator: db.coordinator,
      query: ({ where }) =>
        Query.from('athletes')
          .select({
            athletes: count(),
            maxWeight: max('weight'),
            avgWeight: avg('weight'),
          })
          .where(where),
      filterBy: $page,
    });

    await waitFor(() => {
      expect(kpis.store.state.status).toBe('success');
    });
    expect(kpis.store.state.values).toEqual({
      athletes: 6,
      maxWeight: 90,
      avgWeight: 70,
    });

    // Cross-filtering updates the record like any other client.
    $page.update(clausePoint('sport', 'run', { source: {} }));

    await waitFor(() => {
      expect(kpis.store.state.values?.athletes).toBe(2);
    });
    expect(kpis.store.state.values?.maxWeight).toBe(65);

    kpis.destroy();
  });

  test('values is undefined before the first result and on empty results', async () => {
    const $page = Selection.crossfilter();

    const kpis = createValuesClient<{ athletes: number }>({
      coordinator: db.coordinator,
      query: ({ where }) =>
        Query.from('athletes').select({ athletes: count() }).where(where),
      filterBy: $page,
      enabled: false,
    });

    expect(kpis.store.state.values).toBeUndefined();
    expect(kpis.store.state.status).toBe('idle');

    kpis.setEnabled(true);
    await waitFor(() => {
      expect(kpis.store.state.values?.athletes).toBe(6);
    });

    kpis.destroy();
  });
});
