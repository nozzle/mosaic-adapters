import { Selection } from '@uwdata/mosaic-core';
import { Query, eq, literal } from '@uwdata/mosaic-sql';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  createAthletesDb,
  interact,
  renderHook,
  settle,
  waitFor,
} from '@nozzleio/test-support/react';
import { useMosaicRows } from '../src/index';
import type { QuerySource, RowsInputs } from '../src/index';
import type { TestDb } from '@nozzleio/test-support/react';

interface AthleteRow {
  id: number;
  name: string;
  sport: string;
  weight: number;
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

describe('status semantics', () => {
  test('enabled hooks never report idle; disabled hooks do', async () => {
    const statuses: Array<string> = [];

    const hook = await renderHook(
      (props: { enabled: boolean }) => {
        const rows = useMosaicRows<AthleteRow>({
          coordinator: db.coordinator,
          query: allAthletes,
          enabled: props.enabled,
        });
        statuses.push(rows.status);
        return rows;
      },
      { initialProps: { enabled: false } },
    );

    await settle();
    expect(hook.result.current.status).toBe('idle');
    expect(db.clientQueries.length).toBe(0);

    await hook.rerender({ enabled: true });
    await waitFor(() => {
      expect(hook.result.current.status).toBe('success');
      expect(hook.result.current.rows).toHaveLength(6);
    });

    // While enabled, the pre-first-query state reads 'pending', never 'idle'
    // (React-Query semantics; the core store itself stays 'idle' until the
    // first queryPending). The first enabled render must already be 'pending'.
    const firstEnabledIndex = statuses.indexOf('pending');
    expect(firstEnabledIndex).toBeGreaterThan(0);
    expect(statuses.slice(0, firstEnabledIndex)).toEqual(
      Array(firstEnabledIndex).fill('idle'),
    );
    expect(statuses.slice(firstEnabledIndex)).not.toContain('idle');

    await hook.unmount();
    expect(db.coordinator.clients.size).toBe(0);
  });
});

describe('latest-ref query and coerce', () => {
  test('new function identities do not recreate the client and do not re-query; the next trigger uses the latest functions', async () => {
    const hook = await renderHook(
      (props: { swimOnly: boolean; upper: boolean; inputs: RowsInputs }) =>
        useMosaicRows<AthleteRow>({
          coordinator: db.coordinator,
          // New closure identities on every render by construction.
          query: ({ where }) =>
            props.swimOnly
              ? athleteQuery().where(eq('sport', literal('swim')), where)
              : athleteQuery().where(where),
          coerce: (raw) => {
            const row = raw as unknown as AthleteRow;
            return props.upper ? { ...row, name: row.name.toUpperCase() } : row;
          },
          inputs: props.inputs,
        }),
      { initialProps: { swimOnly: false, upper: false, inputs: {} } },
    );

    await waitFor(() => {
      expect(hook.result.current.status).toBe('success');
      expect(hook.result.current.rows).toHaveLength(6);
    });
    const client = hook.result.current.client;
    const queriesAfterInit = db.clientQueries.length;

    // Swap both functions (and re-render several times): no client
    // recreation, no re-query, rows untouched.
    await hook.rerender({ swimOnly: true, upper: true, inputs: {} });
    await hook.rerender({ swimOnly: true, upper: true, inputs: {} });
    await settle();
    expect(hook.result.current.client).toBe(client);
    expect(db.clientQueries.length).toBe(queriesAfterInit);
    expect(hook.result.current.rows).toHaveLength(6);
    expect(hook.result.current.rows[0]?.name).toBe('Ada');

    // The next trigger (an inputs change) runs exactly one query built from
    // the latest factory and mapped by the latest coerce.
    await hook.rerender({
      swimOnly: true,
      upper: true,
      inputs: { orderBy: [{ column: 'id' }] },
    });
    await waitFor(() => {
      expect(hook.result.current.rows).toHaveLength(4);
    });
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);
    expect(hook.result.current.client).toBe(client);
    expect(hook.result.current.rows[0]?.name).toBe('ADA');

    await hook.unmount();
  });
});

describe('value-diffed inputs', () => {
  test('value-equal re-renders never query; removed keys are cleared (controlled inputs)', async () => {
    const hook = await renderHook(
      (props: { inputs: RowsInputs }) =>
        useMosaicRows<AthleteRow>({
          coordinator: db.coordinator,
          query: allAthletes,
          inputs: props.inputs,
        }),
      {
        initialProps: {
          // Widen to RowsInputs so later rerenders with a subset of keys type-check.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
          inputs: {
            orderBy: [{ column: 'weight', desc: true }],
            limit: 3,
          } as RowsInputs,
        },
      },
    );

    await waitFor(() => {
      expect(hook.result.current.rows.map((r) => r.id)).toEqual([4, 3, 2]);
    });
    const queriesAfterInit = db.clientQueries.length;

    // Fresh object identities, same values: no query.
    await hook.rerender({
      inputs: { orderBy: [{ column: 'weight', desc: true }], limit: 3 },
    });
    await settle();
    expect(db.clientQueries.length).toBe(queriesAfterInit);

    // Dropping the orderBy key clears it (the option owns the inputs), so
    // this is one query with natural order and the new limit.
    await hook.rerender({ inputs: { limit: 2 } });
    await waitFor(() => {
      expect(hook.result.current.rows.map((r) => r.id)).toEqual([1, 2]);
    });
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);

    await hook.unmount();
  });
});

describe('structural identity', () => {
  test('filterBy identity change destroys and recreates the client; nothing dangles after unmount', async () => {
    const selA = Selection.intersect();
    const selB = Selection.intersect();

    const hook = await renderHook(
      (props: { filterBy: Selection }) =>
        useMosaicRows<AthleteRow>({
          coordinator: db.coordinator,
          query: allAthletes,
          filterBy: props.filterBy,
        }),
      { initialProps: { filterBy: selA } },
    );

    await waitFor(() => {
      expect(hook.result.current.status).toBe('success');
    });
    const clientA = hook.result.current.client;
    expect(db.coordinator.clients.has(clientA.mosaicClient)).toBe(true);

    // The new Selection filters to one sport; the recreated client must be
    // wired to it for real.
    await interact(() => {
      selB.update({
        source: {},
        value: 'run',
        fields: [],
        predicate: eq('sport', literal('run')),
      });
    });
    await hook.rerender({ filterBy: selB });

    await waitFor(() => {
      expect(hook.result.current.client).not.toBe(clientA);
      expect(hook.result.current.rows.map((r) => r.sport)).toEqual([
        'run',
        'run',
      ]);
    });
    expect(clientA.destroyed).toBe(true);
    expect(db.coordinator.clients.has(clientA.mosaicClient)).toBe(false);
    expect(db.coordinator.clients.size).toBe(1);

    await hook.unmount();
    expect(hook.result.current.client.destroyed).toBe(true);
    expect(db.coordinator.clients.size).toBe(0);
  });

  test('filterBy updates re-query through the binding', async () => {
    const $page = Selection.crossfilter();

    const hook = await renderHook(
      (_props: object) =>
        useMosaicRows<AthleteRow>({
          coordinator: db.coordinator,
          query: allAthletes,
          filterBy: $page,
        }),
      { initialProps: {} },
    );

    await waitFor(() => {
      expect(hook.result.current.rows).toHaveLength(6);
    });

    await interact(() => {
      $page.update({
        source: {},
        value: 'swim',
        fields: [],
        predicate: eq('sport', literal('swim')),
      });
    });

    await waitFor(() => {
      expect(hook.result.current.rows).toHaveLength(4);
    });

    await hook.unmount();
  });
});

describe('StrictMode', () => {
  test('double-mount keeps connect/disconnect symmetric and settles on one live client', async () => {
    const hook = await renderHook(
      (_props: object) =>
        useMosaicRows<AthleteRow>({
          coordinator: db.coordinator,
          query: allAthletes,
          inputs: { orderBy: [{ column: 'id' }] },
        }),
      { initialProps: {}, reactStrictMode: true },
    );

    await waitFor(() => {
      expect(hook.result.current.status).toBe('success');
      expect(hook.result.current.rows).toHaveLength(6);
    });
    // The simulated unmount destroyed the first client; exactly one live
    // client remains connected.
    expect(db.coordinator.clients.size).toBe(1);
    expect(
      db.coordinator.clients.has(hook.result.current.client.mosaicClient),
    ).toBe(true);

    await hook.unmount();
    expect(db.coordinator.clients.size).toBe(0);
    expect(hook.result.current.client.destroyed).toBe(true);
  });
});
