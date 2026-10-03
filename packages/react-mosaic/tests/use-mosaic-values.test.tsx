import { createAthletesDb, interact, renderHook, waitFor } from '@nozzleio/test-support/react';
import type { TestDb } from '@nozzleio/test-support/react';
import { Selection } from '@uwdata/mosaic-core';
import { Query, count, eq, literal, max } from '@uwdata/mosaic-sql';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  MosaicProvider,
  createRowsClient,
  createValuesClient,
  useMosaicValues,
} from '../src/index';

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
        wrapper: ({ children }: { children: ReactNode }) => (
          <MosaicProvider coordinator={db.coordinator}>{children}</MosaicProvider>
        ),
      },
    );

    await waitFor(() => {
      expect(hook.result.current.status).toBe('success');
      expect(hook.result.current.values).toEqual({
        athletes: 6,
        heaviest: 90,
      });
    });
    expect(db.coordinator.clients.size).toBe(1);

    await interact(() => {
      $page.update({
        source: {},
        value: 'run',
        fields: [],
        predicate: eq('sport', literal('run')),
      });
    });

    await waitFor(() => {
      expect(hook.result.current.values).toEqual({ athletes: 2, heaviest: 65 });
    });

    await hook.unmount();
    expect(db.coordinator.clients.size).toBe(0);
  });
});

describe('coalesceFilterBy', () => {
  test('is structural: flipping it recreates the client on the matching filterBy path', async () => {
    const $page = Selection.crossfilter();
    const hook = await renderHook(
      (props: { coalesce: boolean }) =>
        useMosaicValues<Kpis>({
          coordinator: db.coordinator,
          query: ({ where }) =>
            Query.from('athletes')
              .select({ athletes: count(), heaviest: max('weight') })
              .where(where),
          filterBy: $page,
          filterStable: false,
          coalesceFilterBy: props.coalesce,
        }),
      { initialProps: { coalesce: true } },
    );

    await waitFor(() => {
      expect(hook.result.current.status).toBe('success');
    });
    const coalesced = hook.result.current.client;
    // The coalesced path keeps the client out of the coordinator's filter group.
    expect(db.coordinator.filterGroups.get($page)?.clients.has(coalesced.mosaicClient)).not.toBe(
      true,
    );

    await hook.rerender({ coalesce: false });
    await waitFor(() => {
      expect(hook.result.current.client).not.toBe(coalesced);
      expect(hook.result.current.status).toBe('success');
    });
    expect(coalesced.destroyed).toBe(true);
    const upstream = hook.result.current.client;
    expect(db.coordinator.filterGroups.get($page)?.clients.has(upstream.mosaicClient)).toBe(true);

    // Both paths answer a clause change.
    await interact(() => {
      $page.update({
        source: {},
        value: 'run',
        fields: [],
        predicate: eq('sport', literal('run')),
      });
    });
    await waitFor(() => {
      expect(hook.result.current.values).toEqual({ athletes: 2, heaviest: 65 });
    });

    await hook.unmount();
  });
});

describe('distribution model', () => {
  test('the package entry re-exports the core public API', () => {
    expect(typeof createRowsClient).toBe('function');
    expect(typeof createValuesClient).toBe('function');
  });
});
