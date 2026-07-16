import { Selection } from '@uwdata/mosaic-core';
import { Query, eq, gte, literal } from '@uwdata/mosaic-sql';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  createAthletesDb,
  renderHook,
  settle,
  waitFor,
} from '@nozzleio/test-support/react';
import { useMosaicRows } from '../src/index';
import type { ClauseSource } from '@uwdata/mosaic-core';
import type { QuerySource, RowsInputs } from '../src/index';
import type { TestDb } from '@nozzleio/test-support/react';

interface AthleteRow {
  id: number;
  name: string;
  sport: string;
  weight: number;
}

/**
 * A clause source carrying a string `id` (what `skipSources` matches on).
 * `ClauseSource` is upstream-typed as bare `object`, so the id rides through a
 * cast rather than an object literal (which the excess-property check rejects).
 */
function sourceId(id: string): ClauseSource {
  return { id } as ClauseSource;
}

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

function athleteQuery() {
  return Query.from('athletes').select('id', 'name', 'sport', 'weight');
}

const allAthletes: QuerySource<RowsInputs> = ({ where }) =>
  athleteQuery().where(where);

describe('skipSources structural identity', () => {
  test('a new but value-equal Set does not recreate the client', async () => {
    const hook = await renderHook(
      (props: { skip: ReadonlySet<string> | undefined }) =>
        useMosaicRows<AthleteRow>({
          coordinator: db.coordinator,
          query: allAthletes,
          skipSources: props.skip,
        }),
      { initialProps: { skip: new Set(['a']) } },
    );

    await waitFor(() => {
      expect(hook.result.current.status).toBe('success');
    });
    const client = hook.result.current.client;

    // Fresh Set identity, same members: order-insensitive key is unchanged, so
    // the client is preserved across the re-render.
    await hook.rerender({ skip: new Set(['a']) });
    await settle();
    expect(hook.result.current.client).toBe(client);
    expect(client.destroyed).toBe(false);

    await hook.unmount();
  });

  test('a different Set recreates the client', async () => {
    const hook = await renderHook(
      (props: { skip: ReadonlySet<string> | undefined }) =>
        useMosaicRows<AthleteRow>({
          coordinator: db.coordinator,
          query: allAthletes,
          skipSources: props.skip,
        }),
      { initialProps: { skip: new Set(['a']) } },
    );

    await waitFor(() => {
      expect(hook.result.current.status).toBe('success');
    });
    const client = hook.result.current.client;

    await hook.rerender({ skip: new Set(['b']) });
    await waitFor(() => {
      expect(hook.result.current.client).not.toBe(client);
      expect(hook.result.current.status).toBe('success');
    });
    expect(client.destroyed).toBe(true);
    expect(db.coordinator.clients.size).toBe(1);

    await hook.unmount();
  });

  test('members are separated so a joined id does not collide with two ids', async () => {
    const hook = await renderHook(
      (props: { skip: ReadonlySet<string> | undefined }) =>
        useMosaicRows<AthleteRow>({
          coordinator: db.coordinator,
          query: allAthletes,
          skipSources: props.skip,
        }),
      { initialProps: { skip: new Set(['a b']) } },
    );

    await waitFor(() => {
      expect(hook.result.current.status).toBe('success');
    });
    const client = hook.result.current.client;

    // {'a b'} and {'a','b'} must key differently (NUL separator), so this is a
    // real change and the client is recreated.
    await hook.rerender({ skip: new Set(['a', 'b']) });
    await waitFor(() => {
      expect(hook.result.current.client).not.toBe(client);
      expect(hook.result.current.status).toBe('success');
    });
    expect(client.destroyed).toBe(true);

    await hook.unmount();
  });

  test('undefined and an empty Set share a key: no recreation between them', async () => {
    const hook = await renderHook(
      (props: { skip: ReadonlySet<string> | undefined }) =>
        useMosaicRows<AthleteRow>({
          coordinator: db.coordinator,
          query: allAthletes,
          skipSources: props.skip,
        }),
      {
        initialProps: {
          skip: undefined as ReadonlySet<string> | undefined,
        },
      },
    );

    await waitFor(() => {
      expect(hook.result.current.status).toBe('success');
    });
    const client = hook.result.current.client;

    // undefined → empty set: both normalize to the "no skipping" key.
    await hook.rerender({ skip: new Set<string>() });
    await settle();
    expect(hook.result.current.client).toBe(client);
    expect(client.destroyed).toBe(false);

    await hook.unmount();
  });
});

describe('skipSources resolution through the binding', () => {
  test('naming one of two published clause sources filters by only the other', async () => {
    const $sel = Selection.intersect();
    // Two clauses on a shared Selection, keyed by distinct source ids.
    $sel.update({
      source: sourceId('a'),
      value: 'swim',
      fields: [],
      predicate: eq('sport', literal('swim')),
    });
    $sel.update({
      source: sourceId('b'),
      value: 60,
      fields: [],
      predicate: gte('weight', literal(60)),
    });

    const hook = await renderHook(
      (_props: object) =>
        useMosaicRows<AthleteRow>({
          coordinator: db.coordinator,
          query: allAthletes,
          filterBy: $sel,
          skipSources: new Set(['a']),
        }),
      { initialProps: {} },
    );

    // Only weight >= 60 survives (5 rows); the skipped sport clause (which
    // would drop the count to 4 swimmers) is gone from the WHERE.
    await waitFor(() => {
      expect(hook.result.current.status).toBe('success');
      expect(hook.result.current.rows).toHaveLength(5);
    });
    const sql = hook.result.current.client.store.state.lastQuery;
    expect(sql).toMatch(/"weight" >= 60/);
    expect(sql).not.toMatch(/swim/);

    await hook.unmount();
  });
});
