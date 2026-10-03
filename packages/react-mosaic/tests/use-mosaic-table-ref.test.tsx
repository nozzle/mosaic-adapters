import { createAthletesDb, renderHook, settle, waitFor } from '@nozzleio/test-support/react';
import type { TestDb } from '@nozzleio/test-support/react';
import { TableRefNode } from '@uwdata/mosaic-sql';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { useMosaicFacet, useMosaicRows } from '../src/index';
import type { FacetClient, QuerySource, RowsInputs } from '../src/index';

let db: TestDb;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  db = await createAthletesDb();
  await db.exec(`
    CREATE SCHEMA archive;
    CREATE TABLE archive.athletes AS SELECT * FROM athletes WHERE sport = 'run';
    CREATE TABLE archive.flat AS SELECT sport AS "info.sport" FROM athletes;
  `);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

function dottedSourceWarnings(): Array<unknown> {
  return warn.mock.calls.filter((call: Array<unknown>) =>
    String(call[0]).includes('contains a dot but is a plain string'),
  );
}

describe('TableRefNode query sources in hooks', () => {
  test('an inline TableRefNode is compared by SQL form: no recreate, no re-query, one instance', async () => {
    const swapped: Array<unknown> = [];
    const hook = await renderHook(
      (props: { schema: string; tick: number }) =>
        useMosaicFacet({
          coordinator: db.coordinator,
          // A fresh node on every render by construction.
          from: new TableRefNode([props.schema, 'athletes']),
          column: 'sport',
          sort: 'alpha',
        }),
      { initialProps: { schema: 'main', tick: 0 } },
    );

    const client: FacetClient = hook.result.current.client;
    const setQuery = client.setQuery.bind(client);
    vi.spyOn(client, 'setQuery').mockImplementation((source) => {
      swapped.push(source);
      setQuery(source);
    });

    await waitFor(() => {
      expect(hook.result.current.status).toBe('success');
    });
    expect(hook.result.current.options.map((option) => option.value)).toEqual(['run', 'swim']);
    expect(hook.result.current.lastQuery).toContain('FROM "main"."athletes"');
    const queriesAfterInit = db.clientQueries.length;

    await hook.rerender({ schema: 'main', tick: 1 });
    await hook.rerender({ schema: 'main', tick: 2 });
    await settle();

    expect(hook.result.current.client).toBe(client);
    expect(db.clientQueries.length).toBe(queriesAfterInit);
    // Every equal-SQL render hands the client the instance it already holds.
    expect(swapped.length).toBeGreaterThanOrEqual(2);
    expect(new Set(swapped).size).toBe(1);

    // A different table is a new source — still latest-ref: swapped in
    // without recreating the client; the next trigger reads it.
    await hook.rerender({ schema: 'archive', tick: 3 });
    expect(hook.result.current.client).toBe(client);
    expect(String(swapped.at(-1))).toBe('"archive"."athletes"');
    await client.refetch();
    await waitFor(() => {
      expect(hook.result.current.options.map((option) => option.value)).toEqual(['run']);
    });
    expect(hook.result.current.lastQuery).toContain('FROM "archive"."athletes"');

    await hook.unmount();
    expect(db.coordinator.clients.size).toBe(0);
  });

  test('a dotted plain-string source warns once per client across re-renders', async () => {
    const query: QuerySource<RowsInputs> = 'archive.athletes';
    const hook = await renderHook(
      (props: { tick: number }) =>
        useMosaicRows({
          coordinator: db.coordinator,
          query,
          rowCount: 'none',
          inputs: { limit: 10 + props.tick },
        }),
      { initialProps: { tick: 0 } },
    );

    await waitFor(() => {
      expect(hook.result.current.status).toBe('error');
    });
    await hook.rerender({ tick: 1 });
    await hook.rerender({ tick: 2 });
    await settle();

    expect(dottedSourceWarnings()).toHaveLength(1);

    await hook.unmount();
  });
});

describe('columnPaths in hooks', () => {
  test('columnPaths is structural: changing it recreates the client', async () => {
    const hook = await renderHook(
      (props: { columnPaths: 'struct' | 'literal' }) =>
        useMosaicFacet({
          coordinator: db.coordinator,
          from: new TableRefNode(['archive', 'flat']),
          column: 'info.sport',
          columnPaths: props.columnPaths,
          sort: 'alpha',
        }),
      { initialProps: { columnPaths: 'literal' } },
    );

    await waitFor(() => {
      expect(hook.result.current.status).toBe('success');
    });
    expect(hook.result.current.options.map((option) => option.value)).toEqual(['run', 'swim']);
    expect(hook.result.current.lastQuery).toContain('"info.sport"');
    const literalClient = hook.result.current.client;

    // Same props: no recreate.
    await hook.rerender({ columnPaths: 'literal' });
    expect(hook.result.current.client).toBe(literalClient);

    // Struct mode reads "info"."sport", which this table does not have.
    await hook.rerender({ columnPaths: 'struct' });
    expect(hook.result.current.client).not.toBe(literalClient);
    await waitFor(() => {
      expect(hook.result.current.status).toBe('error');
    });
    expect(hook.result.current.lastQuery).toContain('"info"."sport"');

    await hook.unmount();
  });
});
