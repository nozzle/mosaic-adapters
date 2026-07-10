import { describe, expect, test } from 'vitest';
import {
  buildSelectionUrlRegistry,
  decodeNumericInterval,
  encodeNumericInterval,
  validateSelectionUrl,
} from '../src/spec/url-state/selection-url';
import { toTopologyConfig } from '../src/spec/topology';
import { selectionPersistValueSchema } from '../src/spec/schema';
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
        column: 'search_volume',
        valueType: 'interval',
        dataType: 'number',
      },
    ]);
    expect(toTopologyConfig(topology)).toEqual({ brush: { type: 'single' } });
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
