/**
 * Persistence pass-through for the data-client hooks: `persist` flows from the
 * hook options into the core factory (so hydration and echo suppression are the
 * core's concern — proven in mosaic-core/tests/persistence.test.ts) while the
 * hook layer owns option identity. These tests pin the React-visible contract:
 * hydration on mount is StrictMode-safe (zero writes), a real interaction
 * writes with reason 'update', and `persist` is structural (a new identity
 * recreates the client; a stable identity keeps it).
 */
import { Selection } from '@uwdata/mosaic-core';
import { Query } from '@uwdata/mosaic-sql';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  createAthletesDb,
  interact,
  renderHook,
  waitFor,
} from '@nozzleio/test-support/react';
import { useMosaicFacet, useMosaicRows } from '../src/index';
import type { Persister, QuerySource, RowsInputs } from '../src/index';
import type { TestDb } from '@nozzleio/test-support/react';

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

/** In-memory persister with spies, standing in for consumer storage. */
function memoryPersister<TState>(initial: TState | null = null): {
  persister: Persister<TState>;
  read: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  writes: Array<{ state: TState | null; reason: string }>;
} {
  const writes: Array<{ state: TState | null; reason: string }> = [];
  const read = vi.fn(() => initial);
  const write = vi.fn((state: TState | null, context: { reason: string }) => {
    writes.push({ state, reason: context.reason });
  });
  return { persister: { read, write }, read, write, writes };
}

describe('useMosaicFacet persistence', () => {
  test('hydrates on mount without writing under StrictMode', async () => {
    const $page = Selection.crossfilter();
    const { persister, write } = memoryPersister<Array<unknown>>(['run']);

    const hook = await renderHook(
      () =>
        useMosaicFacet({
          coordinator: db.coordinator,
          from: 'athletes',
          column: 'sport',
          filterBy: $page,
          publish: { as: $page },
          persist: persister,
        }),
      { initialProps: {}, reactStrictMode: true },
    );

    await waitFor(() => {
      expect(hook.result.current.selected).toEqual(['run']);
    });
    // Hydration replays through the publish path but is never written back.
    expect(write).not.toHaveBeenCalled();

    // Destroy (StrictMode unmount included) must not write either.
    await hook.unmount();
    expect(write).not.toHaveBeenCalled();
  });

  test('a user toggle writes with reason update; remount re-hydrates cleanly', async () => {
    const $page = Selection.crossfilter();
    const { persister, writes, write } = memoryPersister<Array<unknown>>(null);

    const hook = await renderHook(
      () =>
        useMosaicFacet({
          coordinator: db.coordinator,
          from: 'athletes',
          column: 'sport',
          filterBy: $page,
          publish: { as: $page },
          persist: persister,
        }),
      { initialProps: {}, reactStrictMode: true },
    );

    await waitFor(() => {
      expect(hook.result.current.options).toHaveLength(2);
    });
    expect(write).not.toHaveBeenCalled();

    await interact(() => hook.result.current.client.toggle('run'));
    await waitFor(() => {
      expect(hook.result.current.selected).toEqual(['run']);
    });
    expect(writes.at(-1)).toEqual({ state: ['run'], reason: 'update' });

    const writesAfterToggle = writes.length;

    // Remount over the same persister (now holding ['run']) re-hydrates to the
    // same state, and hydration adds no extra writes. The persister must be a
    // stable identity — persist is structural, so an inline literal inside the
    // render callback would recreate the client on every render.
    const rehydratingPersister: Persister<Array<unknown>> = {
      read: () => ['run'],
      write: persister.write,
    };
    const remount = await renderHook(
      () =>
        useMosaicFacet({
          coordinator: db.coordinator,
          from: 'athletes',
          column: 'sport',
          filterBy: $page,
          publish: { as: $page },
          persist: rehydratingPersister,
        }),
      { initialProps: {}, reactStrictMode: true },
    );

    await waitFor(() => {
      expect(remount.result.current.selected).toEqual(['run']);
    });
    expect(writes.length).toBe(writesAfterToggle);

    await hook.unmount();
    await remount.unmount();
  });

  test('persist is structural: new identity recreates, same identity keeps', async () => {
    const $page = Selection.crossfilter();
    const persisterA = memoryPersister<Array<unknown>>(null).persister;
    const persisterB = memoryPersister<Array<unknown>>(null).persister;

    const hook = await renderHook(
      (props: { persist: Persister<Array<unknown>> }) =>
        useMosaicFacet({
          coordinator: db.coordinator,
          from: 'athletes',
          column: 'sport',
          filterBy: $page,
          publish: { as: $page },
          persist: props.persist,
        }),
      { initialProps: { persist: persisterA } },
    );

    await waitFor(() => {
      expect(hook.result.current.options).toHaveLength(2);
    });
    const clientA = hook.result.current.client;

    // Same identity: same client.
    await hook.rerender({ persist: persisterA });
    expect(hook.result.current.client).toBe(clientA);
    expect(clientA.destroyed).toBe(false);

    // New identity: recreate, old destroyed.
    await hook.rerender({ persist: persisterB });
    await waitFor(() => {
      expect(hook.result.current.client).not.toBe(clientA);
    });
    expect(clientA.destroyed).toBe(true);

    await hook.unmount();
  });
});

describe('useMosaicRows persistence', () => {
  const allAthletes: QuerySource<RowsInputs> = ({ where }) =>
    Query.from('athletes').select('id', 'name', 'sport', 'weight').where(where);

  test('persisted tuples hydrate through setSelectedValues into the Selection', async () => {
    const $selected = Selection.single();
    const source = {};
    const { persister, write } = memoryPersister<Array<Array<unknown>>>([
      ['Ada'],
    ]);

    const hook = await renderHook(
      () =>
        useMosaicRows<{
          id: number;
          name: string;
          sport: string;
          weight: number;
        }>({
          coordinator: db.coordinator,
          query: allAthletes,
          publish: {
            select: {
              as: $selected,
              columns: ['name'],
              source,
            },
          },
          persist: persister,
        }),
      { initialProps: {}, reactStrictMode: true },
    );

    await waitFor(() => {
      expect(hook.result.current.rows).toHaveLength(6);
    });

    // The persisted tuple lands as a published point clause on the Selection.
    await waitFor(() => {
      expect($selected.clauses).toHaveLength(1);
      expect($selected.clauses[0]?.value).toEqual([['Ada']]);
    });
    // Hydration is never written back, StrictMode double-mount included.
    expect(write).not.toHaveBeenCalled();

    await hook.unmount();
  });
});
