import { createFilterSet } from '@nozzleio/mosaic-core';
import {
  createAthletesDb,
  interact,
  renderHook,
  settle,
  waitFor,
} from '@nozzleio/test-support/react';
import type { TestDb } from '@nozzleio/test-support/react';
import { Selection } from '@uwdata/mosaic-core';
import { beforeEach, describe, expect, test } from 'vitest';

import { useMosaicFacet } from '../src/index';

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

describe('useMosaicFacet', () => {
  test('loads options with counts and publishes toggles', async () => {
    const $page = Selection.crossfilter();

    const hook = await renderHook(
      () =>
        useMosaicFacet({
          coordinator: db.coordinator,
          from: 'athletes',
          column: 'sport',
          filterBy: $page,
          publish: { as: $page },
        }),
      { initialProps: {} },
    );

    await waitFor(() => {
      expect(hook.result.current.options).toEqual([
        { value: 'swim', count: 4 },
        { value: 'run', count: 2 },
      ]);
    });

    await interact(() => hook.result.current.client.toggle('run'));
    await waitFor(() => {
      expect(hook.result.current.selected).toEqual(['run']);
    });
    expect($page.clauses).toHaveLength(1);

    await hook.unmount();
    // Unmount clears the published clause (Selection events are async).
    await waitFor(() => {
      expect($page.clauses).toHaveLength(0);
    });
    expect(db.coordinator.clients.size).toBe(0);
  });

  test('enabled gates the option query (dropdown-open pattern)', async () => {
    const hook = await renderHook(
      (props: { open: boolean }) =>
        useMosaicFacet({
          coordinator: db.coordinator,
          from: 'athletes',
          column: 'sport',
          enabled: props.open,
        }),
      { initialProps: { open: false } },
    );

    await settle();
    expect(hook.result.current.status).toBe('idle');
    expect(db.clientQueries).toHaveLength(0);

    await hook.rerender({ open: true });
    await waitFor(() => {
      expect(hook.result.current.options).toHaveLength(2);
    });

    await hook.unmount();
  });

  test('search input is value-diffed', async () => {
    const hook = await renderHook(
      (props: { search: string }) =>
        useMosaicFacet({
          coordinator: db.coordinator,
          from: 'athletes',
          column: 'name',
          sort: 'alpha',
          inputs: { search: props.search },
        }),
      { initialProps: { search: '' } },
    );

    await waitFor(() => {
      expect(hook.result.current.options).toHaveLength(6);
    });
    const queriesAfterInit = db.clientQueries.length;

    // Same value, new object identity: no query.
    await hook.rerender({ search: '' });
    await settle();
    expect(db.clientQueries.length).toBe(queriesAfterInit);

    await hook.rerender({ search: 'a' });
    await waitFor(() => {
      expect(hook.result.current.options.map((o) => o.value)).toEqual(['Ada']);
    });
    expect(db.clientQueries.length).toBe(queriesAfterInit + 1);

    await hook.unmount();
  });

  test('a publish.into target change recreates the client onto the new target', async () => {
    const $where = Selection.crossfilter();
    const $members = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $where, members: $members } });

    const hook = await renderHook(
      (props: { target: string }) =>
        useMosaicFacet({
          coordinator: db.coordinator,
          from: 'athletes',
          column: 'sport',
          publish: { into: set, id: 'sport', target: props.target },
        }),
      { initialProps: { target: 'where' } },
    );
    await waitFor(() => {
      expect(hook.result.current.status).toBe('success');
    });
    const firstClient = hook.result.current.client;

    await hook.rerender({ target: 'members' });
    expect(hook.result.current.client).not.toBe(firstClient);
    await waitFor(() => {
      expect(hook.result.current.status).toBe('success');
    });

    await interact(() => hook.result.current.client.toggle('run'));
    expect(set.store.state.specs[0]?.target).toBe('members');
    expect($members._resolved).toHaveLength(1);
    expect($where._resolved).toHaveLength(0);

    await hook.unmount();
    set.destroy();
  });
});
