import { describe, expect, test } from 'vitest';
import { createTopology } from '@nozzleio/react-mosaic';
import {
  buildSelectionUrlRegistry,
  decodeNumericInterval,
  decodeNumericInterval2D,
  encodeNumericInterval,
  encodeNumericInterval2D,
  validateSelectionUrl,
} from '../src/spec/url-state/selection-url';
import {
  buildSelectionUrlPatch,
  createSelectionWriteState,
  hydratePersistedSelections,
} from '../src/spec/url-state/selection-runtime';
import { toTopologyConfig } from '../src/spec/topology';
import { selectionPersistValueSchema } from '../src/spec/schema';
import { buildDashboardUrlInfo } from '../src/spec/url-state/info';
import { buildVariableUrlRegistry } from '../src/spec/url-state/variable-url';
import type {
  FilterPersistConfig,
  FilterUrlRegistry,
} from '../src/spec/filter-url';
import type { TopologySpec } from '../src/spec/schema';

const EMPTY_FILTERS: FilterUrlRegistry = {
  ids: [],
  get: () => undefined,
};

function selectionTopology(type: 'single' | 'intersect'): TopologySpec {
  return {
    brush: {
      type,
      persist: {
        type: 'url',
        value: {
          type: 'interval',
          column: 'search_volume',
          data_type: 'number',
        },
      },
    },
  };
}

function selection2DTopology(
  x = 'plddt_total',
  y = 'pae_interaction',
): TopologySpec {
  return {
    scatter: {
      type: 'single',
      persist: {
        type: 'url',
        value: {
          type: 'interval',
          columns: { x, y },
          data_type: 'number',
        },
      },
    },
  };
}

describe('numeric interval URL codec', () => {
  test('round-trips finite ascending values', () => {
    expect(encodeNumericInterval([-12.5, 3e4])).toBe('-12.5..30000');
    expect(decodeNumericInterval('-12.5..30000')).toEqual([-12.5, 30_000]);
  });

  test.each([null, [], [1], [2, 1], [1, Number.POSITIVE_INFINITY], ['1', 2]])(
    'rejects non-contract encode value %#',
    (value) => {
      expect(encodeNumericInterval(value)).toBeNull();
    },
  );

  test.each([
    '',
    '1',
    '..',
    '1..',
    '..2',
    '2..1',
    'a..2',
    '1..2..3',
    ' ..2',
    '0x10..20',
  ])('rejects malformed decode value %s', (value) => {
    expect(decodeNumericInterval(value)).toBeNull();
  });

  test('round-trips one atomic rectangular interval', () => {
    expect(
      encodeNumericInterval2D([
        [70, 90],
        [0, 20],
      ]),
    ).toBe('70..90,0..20');
    expect(decodeNumericInterval2D('70..90,0..20')).toEqual([
      [70, 90],
      [0, 20],
    ]);
    expect(
      encodeNumericInterval2D([
        [90, 70],
        [0, 20],
      ]),
    ).toBeNull();
    expect(
      encodeNumericInterval2D([
        [70, 90],
        [0, Number.POSITIVE_INFINITY],
      ]),
    ).toBeNull();
  });

  test.each([
    '',
    '70..90',
    '70..90,',
    ',0..20',
    '90..70,0..20',
    '70..90,20..0',
    '70..90,0..20,1..2',
    '70..90, 0..20',
  ])('rejects malformed rectangular value %s', (value) => {
    expect(decodeNumericInterval2D(value)).toBeNull();
  });
});

describe('selection URL registry', () => {
  test.each(['   ', ' search_volume', 'search_volume; DROP TABLE data'])(
    'rejects unsafe persisted column %j',
    (column) => {
      expect(
        selectionPersistValueSchema.safeParse({
          type: 'interval',
          column,
          data_type: 'number',
        }).success,
      ).toBe(false);
    },
  );

  test('derives the application parameter and strips persistence from Mosaic config', () => {
    const topology = selectionTopology('single');
    const registry = buildSelectionUrlRegistry(topology);

    expect(registry.entries).toEqual([
      {
        entry: 'brush',
        ref: 'brush',
        param: 's.brush',
        dimensions: 1,
        column: 'search_volume',
        valueType: 'interval',
        dataType: 'number',
      },
    ]);
    expect(toTopologyConfig(topology)).toEqual({ brush: { type: 'single' } });
  });

  test('derives a two-axis descriptor and validates both trusted columns', () => {
    const topology = selection2DTopology();
    expect(buildSelectionUrlRegistry(topology).entries).toEqual([
      {
        entry: 'scatter',
        ref: 'scatter',
        param: 's.scatter',
        dimensions: 2,
        columns: { x: 'plddt_total', y: 'pae_interaction' },
        valueType: 'interval',
        dataType: 'number',
      },
    ]);
    expect(toTopologyConfig(topology)).toEqual({
      scatter: { type: 'single' },
    });

    expect(
      selectionPersistValueSchema.safeParse({
        type: 'interval',
        columns: { x: 'safe', y: 'unsafe; DROP TABLE data' },
        data_type: 'number',
      }).success,
    ).toBe(false);
    expect(
      selectionPersistValueSchema.safeParse({
        type: 'interval',
        columns: { x: 'only_x' },
        data_type: 'number',
      }).success,
    ).toBe(false);
    expect(
      selectionPersistValueSchema.safeParse({
        type: 'interval',
        columns: { x: 'x', y: 'y', z: 'extra' },
        data_type: 'number',
      }).success,
    ).toBe(false);
    expect(
      selectionPersistValueSchema.safeParse({
        type: 'interval',
        columns: { x: 'same', y: 'same' },
        data_type: 'number',
      }).success,
    ).toBe(false);
  });

  test('rejects persistence on a non-single entry', () => {
    const topology = selectionTopology('intersect');
    const registry = buildSelectionUrlRegistry(topology);
    expect(
      validateSelectionUrl(topology, registry, EMPTY_FILTERS, null),
    ).toEqual([
      "topology entry 'brush' declares selection persistence but has type 'intersect'; persisted selections must use type 'single'.",
    ]);
  });

  test('rejects filter prefix and bare-id namespace collisions', () => {
    const topology = selectionTopology('single');
    const registry = buildSelectionUrlRegistry(topology);
    const prefixed: FilterPersistConfig = {
      entryName: 'filters',
      prefix: 's',
    };
    expect(
      validateSelectionUrl(topology, registry, EMPTY_FILTERS, prefixed),
    ).toHaveLength(1);

    const bareFilters: FilterUrlRegistry = {
      ids: ['s.brush'],
      get: (id) =>
        id === 's.brush'
          ? {
              column: 'other',
              kind: 'point',
              label: 'Other',
              encode: () => 'value',
              decode: () => null,
            }
          : undefined,
    };
    expect(
      validateSelectionUrl(topology, registry, bareFilters, {
        entryName: 'filters',
        prefix: undefined,
      }),
    ).toHaveLength(1);
  });
});

describe('selection URL runtime', () => {
  test('hydrates a valid interval synchronously into its topology selection', () => {
    const topologySpec = selectionTopology('single');
    const registry = buildSelectionUrlRegistry(topologySpec);
    const topology = createTopology(toTopologyConfig(topologySpec));

    hydratePersistedSelections(topology, registry, {
      's.brush': '100..500',
    });

    expect(topology.activeClauses.state.clauses).toHaveLength(1);
    expect(topology.activeClauses.state.clauses[0]?.clause.value).toEqual([
      100, 500,
    ]);
    expect(
      String(topology.activeClauses.state.clauses[0]?.clause.predicate),
    ).toContain('search_volume');
    topology.destroy();
  });

  test('hydrates dotted persisted columns as struct paths', () => {
    const topologySpec: TopologySpec = {
      brush: {
        type: 'single',
        persist: {
          type: 'url',
          value: {
            type: 'interval',
            column: 'metrics.search_volume',
            data_type: 'number',
          },
        },
      },
    };
    const registry = buildSelectionUrlRegistry(topologySpec);
    const topology = createTopology(toTopologyConfig(topologySpec));

    hydratePersistedSelections(topology, registry, { 's.brush': '100..500' });

    expect(
      String(topology.activeClauses.state.clauses[0]?.clause.predicate),
    ).toContain('"metrics"."search_volume"');
    topology.destroy();
  });

  test('ignores malformed hydration without creating an active clause', () => {
    const topologySpec = selectionTopology('single');
    const registry = buildSelectionUrlRegistry(topologySpec);
    const topology = createTopology(toTopologyConfig(topologySpec));

    hydratePersistedSelections(topology, registry, {
      's.brush': 'not-a-range',
    });

    expect(topology.activeClauses.state.clauses).toEqual([]);
    topology.destroy();
  });

  test('hydrates a rectangular interval against both trusted columns', () => {
    const topologySpec = selection2DTopology();
    const registry = buildSelectionUrlRegistry(topologySpec);
    const topology = createTopology(toTopologyConfig(topologySpec));

    hydratePersistedSelections(topology, registry, {
      's.scatter': '70..90,0..20',
    });

    const clause = topology.activeClauses.state.clauses[0]?.clause;
    expect(clause?.value).toEqual([
      [70, 90],
      [0, 20],
    ]);
    expect(String(clause?.predicate)).toContain('plddt_total');
    expect(String(clause?.predicate)).toContain('pae_interaction');
    topology.destroy();
  });

  test('hydrates rectangular dotted columns as independent struct paths', () => {
    const topologySpec = selection2DTopology('metrics.x', 'metrics.y');
    const registry = buildSelectionUrlRegistry(topologySpec);
    const topology = createTopology(toTopologyConfig(topologySpec));

    hydratePersistedSelections(topology, registry, {
      's.scatter': '70..90,0..20',
    });

    const predicate = String(
      topology.activeClauses.state.clauses[0]?.clause.predicate,
    );
    expect(predicate).toContain('"metrics"."x"');
    expect(predicate).toContain('"metrics"."y"');
    topology.destroy();
  });

  test('leaves malformed rectangular hydration inactive and unclaimed', () => {
    const topologySpec = selection2DTopology();
    const registry = buildSelectionUrlRegistry(topologySpec);
    const topology = createTopology(toTopologyConfig(topologySpec));
    const state = createSelectionWriteState();

    hydratePersistedSelections(topology, registry, {
      's.scatter': '90..70,0..20',
    });

    expect(topology.activeClauses.state.clauses).toEqual([]);
    expect(buildSelectionUrlPatch(registry, [], state)).toEqual({});
    topology.destroy();
  });

  test('encodes and clears one atomic rectangular parameter', () => {
    const registry = buildSelectionUrlRegistry(selection2DTopology());
    const state = createSelectionWriteState();
    const active = [
      {
        entry: 'scatter',
        ref: 'scatter',
        label: undefined,
        meta: undefined,
        clause: {
          source: {},
          value: [
            [70, 90],
            [0, 20],
          ],
          predicate: {} as never,
        },
      },
    ];

    expect(buildSelectionUrlPatch(registry, active, state)).toEqual({
      's.scatter': '70..90,0..20',
    });
    expect(buildSelectionUrlPatch(registry, [], state)).toEqual({
      's.scatter': null,
    });
  });

  test('describes rectangular URL state with its trusted axis names', () => {
    const info = buildDashboardUrlInfo(
      {
        enabled: false,
        prefix: undefined,
        classify: () => 'other',
        describe: () => null,
      },
      buildSelectionUrlRegistry(selection2DTopology()),
      buildVariableUrlRegistry({}),
    );
    expect(info.describe('s.scatter', '70..90,0..20')).toBe(
      'plddt_total: 70 – 90; pae_interaction: 0 – 20',
    );
  });

  test('sets a live value and deletes it after that entry becomes inactive', () => {
    const registry = buildSelectionUrlRegistry(selectionTopology('single'));
    const state = createSelectionWriteState();
    const active = [
      {
        entry: 'brush',
        ref: 'brush',
        label: undefined,
        meta: undefined,
        clause: { source: {}, value: [10, 20], predicate: {} as never },
      },
    ];

    expect(buildSelectionUrlPatch(registry, active, state)).toEqual({
      's.brush': '10..20',
    });
    expect(buildSelectionUrlPatch(registry, [], state)).toEqual({
      's.brush': null,
    });
  });

  test('does not claim an absent entry that has never held a valid value', () => {
    const registry = buildSelectionUrlRegistry(selectionTopology('single'));
    expect(
      buildSelectionUrlPatch(registry, [], createSelectionWriteState()),
    ).toEqual({});
  });
});
