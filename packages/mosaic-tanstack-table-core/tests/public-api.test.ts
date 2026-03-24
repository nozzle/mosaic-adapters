import { expect, expectTypeOf, test } from 'vitest';
import { HistogramStrategy } from '../src/facet-strategies';
import { createTypedSidecarClient } from '../src/sidecar';
import * as core from '../src/index';
import * as filterRegistry from '../src/filter-registry';
import * as grouped from '../src/grouped';

import type { RowData } from '@tanstack/table-core';
import type { MosaicDataTable } from '../src/data-table';
import type { MosaicDataTableOptions } from '../src/types';
import type {
  FacetStrategyKeyWithoutInput,
  FacetStrategyMap,
} from '../src/registry';

type ExampleRow = RowData & {
  id: string;
};

test('keeps specialized helpers off the root export surface', () => {
  expect(core).toHaveProperty('MosaicDataTable');
  expect(core).toHaveProperty('createMosaicMapping');
  expect(core).not.toHaveProperty('MosaicFilterRegistry');
  expect(core).not.toHaveProperty('buildGroupedLevelQuery');
  expect(core).not.toHaveProperty('createTypedSidecarClient');

  expect(filterRegistry).toHaveProperty('MosaicFilterRegistry');
  expect(grouped).toHaveProperty('buildGroupedLevelQuery');
  expect(grouped).toHaveProperty('arrowTableToObjects');
});

test('publishes the tightened facet and sidecar type contracts', () => {
  expectTypeOf<
    Parameters<MosaicDataTable<ExampleRow>['requestFacet']>[1]
  >().toEqualTypeOf<FacetStrategyKeyWithoutInput>();

  expectTypeOf<
    NonNullable<MosaicDataTableOptions<ExampleRow>['facetStrategies']>
  >().toEqualTypeOf<Partial<FacetStrategyMap>>();

  const TypedHistogramClient = createTypedSidecarClient(HistogramStrategy);
  expectTypeOf<
    ConstructorParameters<typeof TypedHistogramClient>[0]
  >().toMatchObjectType<{ options: { step: number } }>();
});
