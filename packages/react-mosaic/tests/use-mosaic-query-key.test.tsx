import { createAthletesDb, renderHook, settle, waitFor } from '@nozzleio/test-support/react';
import type { TestDb } from '@nozzleio/test-support/react';
import { Selection } from '@uwdata/mosaic-core';
import { Query, eq, literal, sql } from '@uwdata/mosaic-sql';
import { beforeEach, describe, expect, test } from 'vitest';

import { useMosaicRows, useMosaicValues } from '../src/index';
import type { QuerySource, RowsInputs } from '../src/index';

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

/** A "compiled" query: a new closure per sport, like a column picker or rule set. */
function compileQuery(sport: string | null): QuerySource<RowsInputs> {
  return ({ where }) => {
    const query = Query.from('athletes').select('id', 'name', 'sport', 'weight');
    if (sport === null) {
      return query.where(where);
    }
    return query.where(eq('sport', literal(sport)), where);
  };
}

interface Props {
  sport: string | null;
  inputs: RowsInputs;
  withKey: boolean;
}

function renderRows(initialProps: Props, reactStrictMode = false) {
  return renderHook(
    (props: Props) =>
      useMosaicRows<AthleteRow>({
        coordinator: db.coordinator,
        query: compileQuery(props.sport),
        inputs: props.inputs,
        // A fresh array identity on every render by construction.
        queryKey: props.withKey ? [props.sport] : undefined,
      }),
    { initialProps, reactStrictMode },
  );
}

describe('queryKey', () => {
  test('omitted: a recompiled query never re-queries on its own (latest-ref unchanged)', async () => {
    const hook = await renderRows({ sport: null, inputs: {}, withKey: false });
    await waitFor(() => {
      expect(hook.result.current.rows).toHaveLength(6);
    });
    const queriesAfterInit = db.clientQueries.length;

    await hook.rerender({ sport: 'swim', inputs: {}, withKey: false });
    await settle();
    expect(db.clientQueries.length).toBe(queriesAfterInit);
    expect(hook.result.current.rows).toHaveLength(6);

    await hook.unmount();
  });

  test('the first render issues only the initial query; an unchanged key never re-queries', async () => {
    const hook = await renderRows({ sport: null, inputs: {}, withKey: true });
    await waitFor(() => {
      expect(hook.result.current.status).toBe('success');
      expect(hook.result.current.rows).toHaveLength(6);
    });
    await settle();
    expect(db.clientQueries).toHaveLength(1);

    // New array identity, same elements (Object.is): no query.
    await hook.rerender({ sport: null, inputs: {}, withKey: true });
    await hook.rerender({ sport: null, inputs: {}, withKey: true });
    await settle();
    expect(db.clientQueries).toHaveLength(1);

    await hook.unmount();
  });

  test('object elements compare by reference (Object.is), not by contents', async () => {
    interface RuleProps {
      rule: { sport: string | null };
    }
    const initialProps: RuleProps = { rule: { sport: null } };
    const hook = await renderHook(
      (props: RuleProps) =>
        useMosaicRows<AthleteRow>({
          coordinator: db.coordinator,
          query: compileQuery(props.rule.sport),
          inputs: {},
          queryKey: [props.rule],
        }),
      { initialProps },
    );
    await waitFor(() => {
      expect(hook.result.current.status).toBe('success');
      expect(hook.result.current.rows).toHaveLength(6);
    });
    await settle();
    const queriesAfterInit = db.clientQueries.length;

    // Same object reference: no query, even though the factory recompiled.
    const swim: RuleProps['rule'] = { sport: 'swim' };
    await hook.rerender({ rule: swim });
    await hook.rerender({ rule: swim });
    await settle();
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);
    await waitFor(() => {
      expect(hook.result.current.rows).toHaveLength(4);
    });

    // New reference with equal contents: re-queries (no deep equality).
    await hook.rerender({ rule: { sport: 'swim' } });
    await waitFor(() => {
      expect(db.clientQueries.length).toBe(queriesAfterInit + 2);
    });
    await settle();
    expect(db.clientQueries.length).toBe(queriesAfterInit + 2);
    expect(hook.result.current.rows).toHaveLength(4);

    await hook.unmount();
  });

  test('a key change re-queries once with the latest factory, without recreating the client', async () => {
    const hook = await renderRows({ sport: null, inputs: {}, withKey: true });
    await waitFor(() => {
      expect(hook.result.current.rows).toHaveLength(6);
    });
    const client = hook.result.current.client;
    const queriesAfterInit = db.clientQueries.length;

    await hook.rerender({ sport: 'swim', inputs: {}, withKey: true });
    await waitFor(() => {
      expect(hook.result.current.status).toBe('success');
      expect(hook.result.current.rows).toHaveLength(4);
    });
    await settle();
    expect(hook.result.current.client).toBe(client);
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);
    expect(db.clientQueries.at(-1)).toContain('swim');
    expect(hook.result.current.settled?.query).toBe(hook.result.current.lastQuery);

    await hook.unmount();
  });

  test('a key change in the same render as an inputs change is one query', async () => {
    const hook = await renderRows({
      sport: null,
      inputs: { orderBy: [{ column: 'id' }], limit: 10 },
      withKey: true,
    });
    await waitFor(() => {
      expect(hook.result.current.rows).toHaveLength(6);
    });
    const queriesAfterInit = db.clientQueries.length;

    await hook.rerender({
      sport: 'swim',
      inputs: { orderBy: [{ column: 'id' }], limit: 2 },
      withKey: true,
    });
    await waitFor(() => {
      expect(hook.result.current.status).toBe('success');
      expect(hook.result.current.rows.map((r) => r.sport)).toEqual(['swim', 'swim']);
    });
    await settle();
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);

    await hook.unmount();
  });

  test('a key that appears or disappears counts as a change', async () => {
    const hook = await renderRows({ sport: null, inputs: {}, withKey: false });
    await waitFor(() => {
      expect(hook.result.current.rows).toHaveLength(6);
    });
    const queriesAfterInit = db.clientQueries.length;

    await hook.rerender({ sport: 'swim', inputs: {}, withKey: true });
    await waitFor(() => {
      expect(hook.result.current.rows).toHaveLength(4);
    });
    await settle();
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);

    await hook.rerender({ sport: 'run', inputs: {}, withKey: false });
    await waitFor(() => {
      expect(hook.result.current.rows).toHaveLength(2);
    });
    await settle();
    expect(db.clientQueries.length).toBe(queriesAfterInit + 2);

    await hook.unmount();
  });

  test('StrictMode: no extra query on mount; a key change still re-queries once', async () => {
    const hook = await renderRows({ sport: null, inputs: {}, withKey: true }, true);
    await waitFor(() => {
      expect(hook.result.current.status).toBe('success');
      expect(hook.result.current.rows).toHaveLength(6);
    });
    await settle();
    const queriesAfterInit = db.clientQueries.length;

    await hook.rerender({ sport: 'swim', inputs: {}, withKey: true });
    await waitFor(() => {
      expect(hook.result.current.rows).toHaveLength(4);
    });
    await settle();
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);

    await hook.unmount();
    expect(db.coordinator.clients.size).toBe(0);
  });

  test('a key change alongside a structural change does not query twice', async () => {
    const first = Selection.intersect();
    const second = Selection.intersect();
    const hook = await renderHook(
      (props: { sport: string | null; filterBy: Selection }) =>
        useMosaicRows<AthleteRow>({
          coordinator: db.coordinator,
          query: compileQuery(props.sport),
          filterBy: props.filterBy,
          queryKey: [props.sport],
        }),
      { initialProps: { sport: null as string | null, filterBy: first } },
    );
    await waitFor(() => {
      expect(hook.result.current.rows).toHaveLength(6);
    });
    const client = hook.result.current.client;
    const queriesAfterInit = db.clientQueries.length;

    // The recreated client's first query already uses the latest factory.
    await hook.rerender({ sport: 'swim', filterBy: second });
    await waitFor(() => {
      expect(hook.result.current.client).not.toBe(client);
      expect(hook.result.current.rows).toHaveLength(4);
    });
    await settle();
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);

    await hook.unmount();
  });

  test('a disabled hook defers the re-query until enabled', async () => {
    const hook = await renderHook(
      (props: { sport: string | null; enabled: boolean }) =>
        useMosaicRows<AthleteRow>({
          coordinator: db.coordinator,
          query: compileQuery(props.sport),
          enabled: props.enabled,
          queryKey: [props.sport],
        }),
      { initialProps: { sport: null as string | null, enabled: true } },
    );
    await waitFor(() => {
      expect(hook.result.current.rows).toHaveLength(6);
    });
    await hook.rerender({ sport: null, enabled: false });
    const queriesWhileEnabled = db.clientQueries.length;

    await hook.rerender({ sport: 'swim', enabled: false });
    await settle();
    expect(db.clientQueries.length).toBe(queriesWhileEnabled);
    expect(hook.result.current.rows).toHaveLength(6);

    await hook.rerender({ sport: 'swim', enabled: true });
    await waitFor(() => {
      expect(hook.result.current.rows).toHaveLength(4);
    });
    await settle();
    expect(db.clientQueries.length).toBe(queriesWhileEnabled + 1);

    await hook.unmount();
  });

  test('is wired through the other data-client hooks (useMosaicValues)', async () => {
    const hook = await renderHook(
      (props: { sport: string }) =>
        useMosaicValues<{ n: number }>({
          coordinator: db.coordinator,
          query: ({ where }) =>
            Query.from('athletes')
              .select({ n: sql`COUNT(*)::INTEGER` })
              .where(eq('sport', literal(props.sport)), where),
          queryKey: [props.sport],
        }),
      { initialProps: { sport: 'swim' } },
    );
    await waitFor(() => {
      expect(hook.result.current.values?.n).toBe(4);
    });
    const queriesAfterInit = db.clientQueries.length;

    await hook.rerender({ sport: 'run' });
    await waitFor(() => {
      expect(hook.result.current.values?.n).toBe(2);
    });
    await settle();
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);
    expect(hook.result.current.settled?.query).toBe(hook.result.current.lastQuery);

    await hook.unmount();
  });
});
