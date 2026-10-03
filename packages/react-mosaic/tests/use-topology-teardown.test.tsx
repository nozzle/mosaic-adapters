import { createAthletesDb, render, settle, waitFor } from '@nozzleio/test-support/react';
import type { TestDb } from '@nozzleio/test-support/react';
/**
 * Teardown ordering through React: effect cleanups run parent-first, so when a
 * `useTopology` parent unmounts, its `useMosaicValues` children's clients are
 * still connected to the topology's Selections while the topology is destroyed.
 * The topology must tear down silently so those children issue no query on the
 * way out. `clearOnDestroy: true` restores the clearing teardown (and the
 * per-client query it costs).
 */
import { Query, count } from '@uwdata/mosaic-sql';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  MosaicProvider,
  MosaicTopologyProvider,
  useMosaicSelectionRef,
  useMosaicValues,
  useTopology,
} from '../src/index';
import type { Topology, TopologyConfig } from '../src/index';

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

const config: TopologyConfig = {
  filters: { type: 'filter-set', targets: { where: 'crossfilter' } },
  page: { type: 'compose', include: ['filters.where'] },
  a: { type: 'crossfilter' },
  b: { type: 'crossfilter' },
  cascade: { type: 'cascading', keys: ['a', 'b'], externals: ['filters.where'] },
};

/** Seed an active FilterSet spec so every context carries a clause. */
function initialize(topology: Topology): void {
  topology.getFilterSet('filters')?.set({
    id: 'sport',
    column: 'sport',
    kind: 'point',
    value: 'run',
  });
}

function Kpi(props: { selectionRef: string }) {
  const filterBy = useMosaicSelectionRef(props.selectionRef);
  const { values } = useMosaicValues<{ athletes: number }>({
    query: ({ where }) => Query.from('athletes').select({ athletes: count() }).where(where),
    filterBy,
  });
  return <output data-ref={props.selectionRef}>{values?.athletes ?? ''}</output>;
}

const topologyOptions = { initialize };
const clearingOptions = { initialize, clearOnDestroy: true };

function Page(props: { clearOnDestroy: boolean }) {
  const topology = useTopology(config, props.clearOnDestroy ? clearingOptions : topologyOptions);
  return (
    <MosaicTopologyProvider topology={topology}>
      <Kpi selectionRef="filters.where" />
      <Kpi selectionRef="page" />
      <Kpi selectionRef="cascade.a" />
    </MosaicTopologyProvider>
  );
}

async function mountPage(clearOnDestroy: boolean) {
  const view = await render(
    <MosaicProvider coordinator={db.coordinator}>
      <Page clearOnDestroy={clearOnDestroy} />
    </MosaicProvider>,
  );
  await waitFor(() => {
    const outputs = [...view.container.querySelectorAll('output')];
    expect(outputs.map((output) => output.textContent)).toEqual(['2', '2', '2']);
  });
  await settle();
  expect(db.coordinator.clients.size).toBe(3);
  // Drop the cache so any teardown query would reach the connector.
  db.coordinator.clear({ clients: false, cache: true });
  return view;
}

describe('useTopology teardown with connected children', () => {
  test('unmounting the parent issues no client query and no connector request', async () => {
    const view = await mountPage(false);
    const clientQueriesBefore = db.clientQueries.length;
    const connectorQueriesBefore = db.connectorQueries.length;

    await view.unmount();
    await settle();

    expect(db.clientQueries.length).toBe(clientQueriesBefore);
    expect(db.connectorQueries.length).toBe(connectorQueriesBefore);
    expect(db.coordinator.clients.size).toBe(0);
  });

  test('clearOnDestroy: true makes the still-connected children re-query on unmount', async () => {
    const view = await mountPage(true);
    const clientQueriesBefore = db.clientQueries.length;

    await view.unmount();
    await settle();

    expect(db.clientQueries.length).toBeGreaterThan(clientQueriesBefore);
    expect(db.coordinator.clients.size).toBe(0);
  });
});
