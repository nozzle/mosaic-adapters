import { Param, Selection } from '@uwdata/mosaic-core';
import * as mSql from '@uwdata/mosaic-sql';
import { describe, expect, test } from 'vitest';
import { TextInputCore } from '../src/input-core';

type QueryClient = {
  coordinator: FakeCoordinator | null;
  initialize: () => void;
  queryPending: () => unknown;
  queryResult: (data: unknown) => unknown;
};

class FakeCoordinator {
  readonly requests: Array<unknown> = [];

  connect(client: QueryClient) {
    client.coordinator = this;
    client.initialize();
  }

  disconnect(client: { coordinator: FakeCoordinator | null }) {
    client.coordinator = null;
  }

  requestQuery(client: QueryClient, query: unknown) {
    this.requests.push(query);
    client.queryPending();
    return Promise.resolve(query);
  }
}

class ArrowLikeRows {
  constructor(private readonly rows: Array<Record<string, unknown>>) {}

  toArray() {
    return [...this.rows];
  }
}

async function flushParam<TValue>(param: Param<TValue>) {
  await param.pending('value');
}

async function flushActivate(selection: Selection) {
  await selection.pending('activate');
}

async function flushFrame() {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe('TextInputCore', () => {
  test('publishes scalar Param output as raw strings and null for empty values', async () => {
    const output = Param.value<string | null>(null);
    const core = new TextInputCore({ as: output });

    core.setValue('rowing');
    await flushParam(output);

    expect(output.value).toBe('rowing');
    expect(core.store.state.value).toBe('rowing');

    core.setValue('');
    await flushParam(output);

    expect(output.value).toBeNull();
    expect(core.store.state.value).toBe('');
  });

  test('publishes Selection output as a text match clause sourced from the core', () => {
    const selection = Selection.intersect();
    const core = new TextInputCore({
      as: selection,
      field: 'sport',
      match: 'prefix',
    });

    core.setValue('row');

    expect(selection.active.source).toBe(core);
    expect(selection.active.value).toBe('row');
    expect(selection.active.meta).toEqual({
      type: 'match',
      method: 'prefix',
    });
    expect(selection.active.predicate?.toString()).toContain('starts_with');
  });

  test('clears the active Selection predicate for empty strings', () => {
    const selection = Selection.intersect();
    const core = new TextInputCore({
      as: selection,
      field: 'sport',
    });

    core.setValue('cycling');
    core.setValue('');

    expect(selection.active.source).toBe(core);
    expect(selection.active.value).toBeNull();
    expect(selection.active.predicate).toBeNull();
    expect(selection.clauses).toHaveLength(0);
  });

  test('subscribes to external scalar Param changes and updates Store value', async () => {
    const output = Param.value<string | null>('initial');
    const core = new TextInputCore({ as: output });

    output.update('external');
    await flushParam(output);

    expect(core.store.state.value).toBe('external');

    output.update(null);
    await flushParam(output);

    expect(core.store.state.value).toBe('');
  });

  test('activation emits a selection preview clause without changing selection value', async () => {
    const selection = Selection.intersect();
    const core = new TextInputCore({
      as: selection,
      field: 'sport',
      value: 'current',
    });
    const activations: Array<unknown> = [];

    selection.addEventListener('activate', (clause) => {
      activations.push(clause);
    });

    core.activate('preview');
    await flushActivate(selection);

    expect(activations).toHaveLength(1);
    expect(selection.value).toBeUndefined();
    expect(core.store.state.value).toBe('current');
  });

  test('query-backed suggestions include filterBy predicates', () => {
    const output = Param.value<string | null>(null);
    const filterBy = Selection.intersect();
    const source = { id: 'filter-source' };
    filterBy.update({
      source,
      value: 'NZ',
      predicate: mSql.eq(mSql.column('country'), mSql.literal('NZ')),
    });
    const core = new TextInputCore({
      as: output,
      from: 'athletes',
      column: 'sport',
      filterBy,
    });

    const query = core.query();

    expect(query?.toString()).toContain('FROM "athletes"');
    expect(query?.toString()).toContain('SELECT DISTINCT "sport"');
    expect(query?.toString()).toContain('"country" = \'NZ\'');

    core.queryResult(
      new ArrowLikeRows([{ sport: 'cycling' }, { sport: 'rowing' }]),
    );

    expect(core.store.state.suggestions).toEqual(['cycling', 'rowing']);
  });

  test('Param-backed from changes requery while connected', async () => {
    const source = Param.value('athletes');
    const coordinator = new FakeCoordinator();
    const core = new TextInputCore({
      as: Param.value<string | null>(null),
      from: source,
      column: 'sport',
      coordinator: coordinator as never,
    });

    core.connect();
    expect(coordinator.requests.at(-1)?.toString()).toContain(
      'FROM "athletes"',
    );

    source.update('teams');
    await flushParam(source);
    await flushFrame();

    expect(coordinator.requests.at(-1)?.toString()).toContain('FROM "teams"');
  });

  test('rebinds external subscriptions when options change', async () => {
    const first = Param.value<string | null>('first');
    const second = Param.value<string | null>('second');
    const core = new TextInputCore({ as: first });

    core.updateOptions({ as: second });
    first.update('ignored');
    second.update('accepted');
    await flushParam(first);
    await flushParam(second);

    expect(core.store.state.value).toBe('accepted');
  });

  test('records suggestion query errors in state', () => {
    const core = new TextInputCore({ as: Param.value<string | null>(null) });
    const error = new Error('query failed');

    core.queryPending();
    core.queryError(error);

    expect(core.store.state).toMatchObject({
      pending: false,
      error,
    });
  });
});
