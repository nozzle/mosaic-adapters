import { beforeEach, describe, expect, test } from 'vitest';

import {
  createAthletesDb,
  renderHook,
  settle,
  waitFor,
} from '@nozzleio/test-support/react';
import { useMosaicSparkline } from '../src/index';
import type { TestDb } from '@nozzleio/test-support/react';

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

describe('useMosaicSparkline', () => {
  test('keys are value-diffed: same page no query, new page exactly one', async () => {
    const hook = await renderHook(
      (props: { keys: Array<string> }) =>
        useMosaicSparkline({
          coordinator: db.coordinator,
          from: 'athletes',
          key: 'sport',
          x: { column: 'weight', step: 10 },
          y: { agg: 'count' },
          inputs: { keys: props.keys },
        }),
      { initialProps: { keys: ['swim'] } },
    );

    await waitFor(() => {
      expect(hook.result.current.series.size).toBe(1);
    });
    const queriesAfterInit = db.clientQueries.length;

    // The typical wiring derives keys from a rows client's page on every
    // render — fresh array identity, same values: no query.
    await hook.rerender({ keys: ['swim'] });
    await settle();
    expect(db.clientQueries.length).toBe(queriesAfterInit);

    await hook.rerender({ keys: ['swim', 'run'] });
    await waitFor(() => {
      expect(hook.result.current.series.size).toBe(2);
    });
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);
    expect(hook.result.current.series.get('run')).toEqual([
      { x: 50, y: 1 },
      { x: 60, y: 1 },
    ]);

    await hook.unmount();
    expect(db.coordinator.clients.size).toBe(0);
  });
});
