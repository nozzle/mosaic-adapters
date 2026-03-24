import { expect, expectTypeOf, test } from 'vitest';

import * as reactTable from '../src/index';
import * as controllers from '../src/controllers';
import * as debug from '../src/debug';
import * as helpers from '../src/helpers';

import type {
  FilterRegistryApi,
  MosaicHistogramClient,
  MosaicTableFilterMode,
  MosaicTableFilterOptions,
  UseMosaicHistogramResult,
} from '../src/index';

test('publishes the intentional React adapter surface', () => {
  expect(reactTable).toHaveProperty('useMosaicReactTable');
  expect(reactTable).toHaveProperty('useGroupedTableState');
  expect(reactTable).toHaveProperty('useMosaicTableFacetMenu');
  expect(reactTable).toHaveProperty('useMosaicTableFilter');
  expect(reactTable).toHaveProperty('useMosaicHistogram');
  expect(reactTable).toHaveProperty('MosaicFilterProvider');
  expect(reactTable).toHaveProperty('useFilterRegistry');
  expect(reactTable).toHaveProperty('useActiveFilters');
  expect(reactTable).toHaveProperty('useRegisterFilterSource');
  expect(reactTable).not.toHaveProperty('AggregationBridge');
  expect(reactTable).not.toHaveProperty('HistogramController');
  expect(reactTable).not.toHaveProperty('logger');
  expect(reactTable).not.toHaveProperty('createMosaicMapping');
  expect(reactTable).not.toHaveProperty('createMosaicColumnHelper');
  expect(reactTable).not.toHaveProperty('coerceNumber');
  expect(helpers).toHaveProperty('createMosaicMapping');
  expect(helpers).toHaveProperty('coerceNumber');
  expect(controllers).toHaveProperty('AggregationBridge');
  expect(controllers).toHaveProperty('HistogramController');
  expect(debug).toHaveProperty('logger');
});

test('publishes the narrowed adapter hook contracts', () => {
  expectTypeOf<MosaicTableFilterMode>().toEqualTypeOf<
    'TEXT' | 'MATCH' | 'SELECT' | 'DATE_RANGE' | 'RANGE'
  >();
  expectTypeOf<MosaicTableFilterOptions<'TEXT'>['mode']>().toEqualTypeOf<'TEXT'>();
  expectTypeOf<MosaicTableFilterOptions<'TEXT'>['column']>().toEqualTypeOf<string>();
  expectTypeOf<Parameters<FilterRegistryApi['registerGroup']>[0]>().toEqualTypeOf<{
    id: string;
    label: string;
    priority: number;
  }>();
  expectTypeOf<Parameters<FilterRegistryApi['clearGroup']>[0]>().toEqualTypeOf<string>();
  expectTypeOf<UseMosaicHistogramResult['bins']>().toEqualTypeOf<
    Array<{ bin: number; count: number }>
  >();
  expectTypeOf<UseMosaicHistogramResult['loading']>().toEqualTypeOf<boolean>();
  expectTypeOf<UseMosaicHistogramResult['error']>().toEqualTypeOf<Error | null>();
  expectTypeOf<UseMosaicHistogramResult['client']>().toEqualTypeOf<
    MosaicHistogramClient | null
  >();
});
