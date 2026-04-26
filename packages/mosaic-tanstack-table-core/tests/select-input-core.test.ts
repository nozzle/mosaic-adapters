import { Param, Selection } from '@uwdata/mosaic-core';
import * as mSql from '@uwdata/mosaic-sql';
import { describe, expect, test } from 'vitest';
import { SelectInputCore } from '../src/input-core';

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

describe('SelectInputCore', () => {
  test('normalizes literal options with explicit labels and an optional All option', () => {
    const core = new SelectInputCore({
      as: Param.value<string | null>(null),
      options: ['cycling', { value: 'rowing', label: 'Rowing' }],
      includeAll: true,
    });

    expect(core.store.state.options).toEqual([
      { value: '', label: 'All' },
      { value: 'cycling', label: 'cycling' },
      { value: 'rowing', label: 'Rowing' },
    ]);
  });

  test('preserves number, boolean, date, and object option values', async () => {
    const date = new Date('2024-01-01T00:00:00.000Z');
    const objectValue = { id: 'object-value' };
    const output = Param.value<unknown>(null);
    const core = new SelectInputCore({
      as: output,
      options: [1, true, date, objectValue],
    });

    core.setValue(objectValue);
    await flushParam(output);

    expect(core.store.state.options.map((option) => option.value)).toEqual([
      1,
      true,
      date,
      objectValue,
    ]);
    expect(output.value).toBe(objectValue);
  });

  test('publishes single-select Param output as raw values and null for All', async () => {
    const output = Param.value<string | null>(null);
    const core = new SelectInputCore<string>({
      as: output,
      options: ['cycling', 'rowing'],
      includeAll: true,
    });

    core.setValue('rowing');
    await flushParam(output);

    expect(output.value).toBe('rowing');
    expect(core.store.state.value).toBe('rowing');

    core.setValue('');
    await flushParam(output);

    expect(output.value).toBeNull();
    expect(core.store.state.value).toBe('');
  });

  test('publishes multi-select Param output as arrays and null for empty arrays', async () => {
    const output = Param.value<Array<string> | null>(null);
    const core = new SelectInputCore<string>({
      as: output,
      multiple: true,
      options: ['cycling', 'rowing'],
    });

    core.setValue(['cycling', 'rowing']);
    await flushParam(output);

    expect(output.value).toEqual(['cycling', 'rowing']);
    expect(core.store.state.value).toEqual(['cycling', 'rowing']);

    core.setValue([]);
    await flushParam(output);

    expect(output.value).toBeNull();
    expect(core.store.state.value).toEqual([]);
  });

  test('publishes single-select Selection output as a point predicate', () => {
    const selection = Selection.intersect();
    const core = new SelectInputCore({
      as: selection,
      field: 'sport',
      options: ['cycling'],
    });

    core.setValue('cycling');

    expect(selection.active.source).toBe(core);
    expect(selection.active.value).toBe('cycling');
    expect(selection.active.meta).toEqual({ type: 'point' });
    expect(selection.active.predicate?.toString()).toContain(
      '"sport" IN (\'cycling\')',
    );
  });

  test('publishes multi-select Selection output as a scalar IN predicate', () => {
    const selection = Selection.intersect();
    const core = new SelectInputCore({
      as: selection,
      field: 'sport',
      multiple: true,
      options: ['cycling', 'rowing'],
    });

    core.setValue(['cycling', 'rowing']);

    expect(selection.active.value).toEqual(['cycling', 'rowing']);
    expect(selection.active.predicate?.toString()).toContain(
      "\"sport\" IN ('cycling', 'rowing')",
    );
  });

  test('publishes list-valued Selection output with list membership semantics', () => {
    const selection = Selection.intersect();
    const core = new SelectInputCore({
      as: selection,
      field: 'tags',
      multiple: true,
      listMatch: 'all',
      options: ['alpha', 'beta'],
    });

    core.setValue(['alpha', 'beta']);

    expect(selection.active.value).toEqual(['alpha', 'beta']);
    expect(selection.active.predicate?.toString()).toContain('list_has_all');
    expect(selection.active.predicate?.toString()).toContain("'alpha'");
    expect(selection.active.predicate?.toString()).toContain("'beta'");
  });

  test('clears the active Selection predicate for All and empty arrays', () => {
    const selection = Selection.intersect();
    const core = new SelectInputCore({
      as: selection,
      field: 'sport',
      multiple: true,
      options: ['cycling'],
    });

    core.setValue(['cycling']);
    core.setValue([]);

    expect(selection.active.source).toBe(core);
    expect(selection.active.value).toBeNull();
    expect(selection.active.predicate).toBeNull();
    expect(selection.clauses).toHaveLength(0);
  });

  test('query-backed options use from, column, filterBy, and list unnesting', () => {
    const output = Param.value<string | null>(null);
    const filterBy = Selection.intersect();
    const source = { id: 'filter-source' };
    filterBy.update({
      source,
      value: 'NZ',
      predicate: mSql.eq(mSql.column('country'), mSql.literal('NZ')),
    });
    const core = new SelectInputCore({
      as: output,
      from: 'athletes',
      column: 'tags',
      filterBy,
      listMatch: 'any',
    });

    const query = core.query();

    expect(query?.toString()).toContain('FROM "athletes"');
    expect(query?.toString()).toContain('SELECT DISTINCT UNNEST("tags")');
    expect(query?.toString()).toContain('"country" = \'NZ\'');

    core.queryResult(
      new ArrowLikeRows([{ value: 'cycling' }, { value: 'rowing' }]),
    );

    expect(core.store.state.options).toEqual([
      { value: '', label: 'All' },
      { value: 'cycling', label: 'cycling' },
      { value: 'rowing', label: 'rowing' },
    ]);
  });

  test('Param-backed from changes requery while connected', async () => {
    const source = Param.value('athletes');
    const coordinator = new FakeCoordinator();
    const core = new SelectInputCore({
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

  test('subscribes to external scalar Param changes and updates Store value', async () => {
    const output = Param.value<string | Array<string> | null>('cycling');
    const core = new SelectInputCore<string>({ as: output, multiple: true });

    output.update(['rowing']);
    await flushParam(output);

    expect(core.store.state.value).toEqual(['rowing']);

    output.update(null);
    await flushParam(output);

    expect(core.store.state.value).toEqual([]);
  });

  test('activation emits a selection preview clause without changing selection value', async () => {
    const selection = Selection.intersect();
    const core = new SelectInputCore({
      as: selection,
      field: 'sport',
      options: ['cycling'],
      value: 'cycling',
    });
    const activations: Array<unknown> = [];

    selection.addEventListener('activate', (clause) => {
      activations.push(clause);
    });

    core.activate('rowing');
    await flushActivate(selection);

    expect(activations).toHaveLength(1);
    expect(selection.value).toBeUndefined();
    expect(core.store.state.value).toBe('cycling');
  });
});
