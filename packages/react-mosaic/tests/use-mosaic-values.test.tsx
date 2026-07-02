import { Selection } from '@uwdata/mosaic-core';
import { Query, count, eq, literal, max } from '@uwdata/mosaic-sql';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  MosaicProvider,
  createRowsClient,
  createValuesClient,
  useMosaicValues,
} from '../src/index';
import { actWaitFor, createAthletesDb, renderHook } from './test-utils';
import type { ReactNode } from 'react';
import type { TestDb } from './test-utils';

interface Kpis extends Record<string, unknown> {
  athletes: number;
  heaviest: number;
}

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

describe('useMosaicValues', () => {
  test('resolves the coordinator from MosaicProvider and reacts to filterBy', async () => {
    const $page = Selection.crossfilter();

    const hook = await renderHook(
      (_props: object) =>
        useMosaicValues<Kpis>({
          query: ({ where }) =>
            Query.from('athletes')
              .select({ athletes: count(), heaviest: max('weight') })
              .where(where),
          filterBy: $page,
        }),
      {
        initialProps: {},
        wrapper: (children: ReactNode) => (
          <MosaicProvider coordinator={db.coordinator}>
            {children}
          </MosaicProvider>
        ),
      },
    );

    await actWaitFor(() => {
      expect(hook.result.current.status).toBe('success');
      expect(hook.result.current.values).toEqual({
        athletes: 6,
        heaviest: 90,
      });
    });
    expect(db.coordinator.clients.size).toBe(1);

    $page.update({
      source: {},
      value: 'run',
      predicate: eq('sport', literal('run')),
    });

    await actWaitFor(() => {
      expect(hook.result.current.values).toEqual({ athletes: 2, heaviest: 65 });
    });

    await hook.unmount();
    expect(db.coordinator.clients.size).toBe(0);
  });
});

describe('distribution model', () => {
  test('the package entry re-exports the core public API', () => {
    expect(typeof createRowsClient).toBe('function');
    expect(typeof createValuesClient).toBe('function');
  });
});
