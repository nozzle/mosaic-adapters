/**
 * The hooks' `meta` option: passed to the client at creation and synced by
 * latest-ref afterwards — a new `meta` (identity or content) never recreates
 * the client and never re-queries, and the mirror on the MosaicClient that
 * coordinator-level observers read follows it.
 */
import { createAthletesDb, renderHook, settle, waitFor } from '@nozzleio/test-support/react';
import type { TestDb } from '@nozzleio/test-support/react';
import { Query, count } from '@uwdata/mosaic-sql';
import { beforeEach, describe, expect, test } from 'vitest';

import { getClientMeta, useMosaicRows, useMosaicValues } from '../src/index';
import type { DataClientMeta } from '../src/index';

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

describe('meta', () => {
  test('reaches the rows client at creation and follows rerenders without recreating or re-querying', async () => {
    const initialProps: { meta: DataClientMeta | undefined } = { meta: { widget: 'roster' } };
    const hook = await renderHook(
      (props: { meta: DataClientMeta | undefined }) =>
        useMosaicRows<{ id: number }>({
          coordinator: db.coordinator,
          query: ({ where }) => Query.from('athletes').select('id').where(where),
          // A fresh object identity on every render by construction.
          meta: props.meta === undefined ? undefined : { ...props.meta },
        }),
      { initialProps },
    );
    await waitFor(() => {
      expect(hook.result.current.status).toBe('success');
    });
    await settle();
    const client = hook.result.current.client;
    const queries = db.clientQueries.length;
    expect(client.meta).toEqual({ widget: 'roster' });
    expect(getClientMeta(client.mosaicClient)).toEqual({ widget: 'roster' });

    await hook.rerender({ meta: { widget: 'roster', route: '/team' } });
    await settle();
    expect(hook.result.current.client).toBe(client);
    expect(client.meta).toEqual({ widget: 'roster', route: '/team' });
    expect(getClientMeta(client.mosaicClient)).toEqual({ widget: 'roster', route: '/team' });

    await hook.rerender({ meta: undefined });
    await settle();
    expect(hook.result.current.client).toBe(client);
    expect(client.meta).toBeUndefined();
    expect(db.clientQueries.length).toBe(queries);

    await hook.unmount();
  });

  test('is passed through by the other hooks too', async () => {
    const hook = await renderHook(
      (props: { widget: string }) =>
        useMosaicValues<{ n: number }>({
          coordinator: db.coordinator,
          query: ({ where }) => Query.from('athletes').select({ n: count() }).where(where),
          meta: { widget: props.widget },
        }),
      { initialProps: { widget: 'total' } },
    );
    await waitFor(() => {
      expect(hook.result.current.status).toBe('success');
    });
    const client = hook.result.current.client;
    expect(getClientMeta(client.mosaicClient)).toEqual({ widget: 'total' });

    await hook.rerender({ widget: 'total-2' });
    await settle();
    expect(hook.result.current.client).toBe(client);
    expect(client.meta).toEqual({ widget: 'total-2' });

    await hook.unmount();
  });
});
