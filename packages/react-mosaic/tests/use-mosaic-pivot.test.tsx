import { beforeEach, describe, expect, test } from 'vitest';

import {
  createAthletesDb,
  renderHook,
  waitFor,
} from '@nozzleio/test-support/react';
import { useMosaicPivot, useMosaicSchema } from '../src/index';
import type { TestDb } from '@nozzleio/test-support/react';

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

describe('useMosaicPivot', () => {
  test('loads pivoted rows with discovered pivotColumns', async () => {
    const hook = await renderHook(
      () =>
        useMosaicPivot<Record<string, unknown>>({
          coordinator: db.coordinator,
          from: 'athletes',
          on: 'sport',
          using: [{ agg: 'sum', column: 'weight' }],
          groupBy: ['name'],
          inputs: { orderBy: [{ column: 'name' }] },
        }),
      { initialProps: {}, reactStrictMode: true },
    );

    await waitFor(() => {
      expect(hook.result.current.rows).toHaveLength(6);
    });
    expect(hook.result.current.pivotColumns).toEqual(['run', 'swim']);
    expect(Number(hook.result.current.rows[0]!.swim)).toBe(60); // Ada

    await hook.unmount();
    expect(db.coordinator.clients.size).toBe(0);
  });
});

describe('useMosaicSchema', () => {
  test('reads field info once', async () => {
    const hook = await renderHook(
      () =>
        useMosaicSchema({
          coordinator: db.coordinator,
          table: 'athletes',
        }),
      { initialProps: {}, reactStrictMode: true },
    );

    await waitFor(() => {
      expect(hook.result.current.status).toBe('success');
    });
    expect(hook.result.current.fields.map((f) => f.column)).toEqual([
      'id',
      'name',
      'sport',
      'weight',
    ]);

    await hook.unmount();
  });
});
