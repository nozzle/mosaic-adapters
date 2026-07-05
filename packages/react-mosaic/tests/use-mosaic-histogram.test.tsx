import { Selection } from '@uwdata/mosaic-core';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  createAthletesDb,
  interact,
  renderHook,
  waitFor,
} from '@nozzleio/test-support/react';
import { useMosaicHistogram } from '../src/index';
import type { TestDb } from '@nozzleio/test-support/react';

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

describe('useMosaicHistogram', () => {
  test('loads zero-filled bins and publishes setRange; StrictMode-safe', async () => {
    const $page = Selection.crossfilter();

    const hook = await renderHook(
      () =>
        useMosaicHistogram({
          coordinator: db.coordinator,
          from: 'athletes',
          column: 'weight',
          inputs: { step: 10 },
          filterBy: $page,
          publish: { as: $page },
        }),
      { initialProps: {}, reactStrictMode: true },
    );

    await waitFor(() => {
      expect(hook.result.current.bins.map((b) => b.count)).toEqual([
        1, 2, 1, 2,
      ]);
    });
    expect(hook.result.current.extent).toEqual([55, 90]);
    expect(hook.result.current.maxCount).toBe(2);

    await interact(() => hook.result.current.client.setRange([60, 70]));
    await waitFor(() => {
      expect(hook.result.current.range).toEqual([60, 70]);
    });
    expect($page.clauses).toHaveLength(1);

    // Crossfilter self-exclusion: its own brush leaves its own bins intact.
    await waitFor(() => {
      expect(hook.result.current.bins.map((b) => b.count)).toEqual([
        1, 2, 1, 2,
      ]);
    });

    await hook.unmount();
    await waitFor(() => {
      expect($page.clauses).toHaveLength(0);
    });
    expect(db.coordinator.clients.size).toBe(0);
  });

  test('a step change re-queries once through the controlled binding', async () => {
    const hook = await renderHook(
      (props: { step: number }) =>
        useMosaicHistogram({
          coordinator: db.coordinator,
          from: 'athletes',
          column: 'weight',
          inputs: { step: props.step },
        }),
      { initialProps: { step: 10 } },
    );

    await waitFor(() => {
      expect(hook.result.current.bins).toHaveLength(4);
    });
    const queriesAfterInit = db.clientQueries.length;

    await hook.rerender({ step: 20 });
    await waitFor(() => {
      expect(hook.result.current.bins).toHaveLength(3);
    });
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);

    await hook.unmount();
  });
});
