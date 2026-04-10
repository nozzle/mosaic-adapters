import { expect, expectTypeOf, test } from 'vitest';

import * as reactTable from '../src/index';
import * as controllers from '../src/controllers';
import * as debug from '../src/debug';
import * as helpers from '../src/helpers';

import type {
  ArrayMultiselectConditionOperatorId,
  DateConditionOperatorId,
  DateRangeConditionOperatorId,
  FilterBinding,
  FilterDefinition,
  FilterRegistryApi,
  FilterRuntime,
  FilterScope,
  FilterValueKind,
  MosaicHistogramClient,
  MosaicTableFilterMode,
  MosaicTableFilterOptions,
  NumberConditionOperatorId,
  NumberRangeConditionOperatorId,
  ScalarMultiselectConditionOperatorId,
  SelectConditionOperatorId,
  TextConditionOperatorId,
  UseFilterFacetOptions,
  UseMosaicFiltersOptions,
  UseMosaicHistogramResult,
} from '../src/index';

test('publishes the intentional React adapter surface', () => {
  expect(reactTable).toHaveProperty('useMosaicReactTable');
  expect(reactTable).toHaveProperty('useGroupedTableState');
  expect(reactTable).toHaveProperty('useMosaicTableFacetMenu');
  expect(reactTable).toHaveProperty('useMosaicTableFilter');
  expect(reactTable).toHaveProperty('useMosaicFilters');
  expect(reactTable).toHaveProperty('useFilterBinding');
  expect(reactTable).toHaveProperty('useFilterFacet');
  expect(reactTable).toHaveProperty('useMosaicHistogram');
  expect(reactTable).toHaveProperty('TEXT_CONDITIONS');
  expect(reactTable).toHaveProperty('SELECT_CONDITIONS');
  expect(reactTable).toHaveProperty('MULTISELECT_SCALAR_CONDITIONS');
  expect(reactTable).toHaveProperty('MULTISELECT_ARRAY_CONDITIONS');
  expect(reactTable).toHaveProperty('DATE_CONDITIONS');
  expect(reactTable).toHaveProperty('DATE_RANGE_CONDITIONS');
  expect(reactTable).toHaveProperty('NUMBER_CONDITIONS');
  expect(reactTable).toHaveProperty('NUMBER_RANGE_CONDITIONS');
  expect(reactTable).toHaveProperty('MosaicFilterProvider');
  expect(reactTable).toHaveProperty('useFilterRegistry');
  expect(reactTable).toHaveProperty('useActiveFilters');
  expect(reactTable).toHaveProperty('useRegisterFilterSource');
  expect(reactTable.TEXT_CONDITIONS.CONTAINS).toBe('contains');
  expect(reactTable.TEXT_CONDITIONS.DOES_NOT_CONTAIN).toBe('does_not_contain');
  expect(reactTable.SELECT_CONDITIONS.IS).toBe('is');
  expect(reactTable.MULTISELECT_SCALAR_CONDITIONS.IS_ANY_OF).toBe('is_any_of');
  expect(reactTable.MULTISELECT_ARRAY_CONDITIONS.INCLUDES_ALL).toBe(
    'includes_all',
  );
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
  expectTypeOf<
    MosaicTableFilterOptions<'TEXT'>['mode']
  >().toEqualTypeOf<'TEXT'>();
  expectTypeOf<
    MosaicTableFilterOptions<'TEXT'>['column']
  >().toEqualTypeOf<string>();
  expectTypeOf<
    Parameters<FilterRegistryApi['registerGroup']>[0]
  >().toEqualTypeOf<{
    id: string;
    label: string;
    priority: number;
  }>();
  expectTypeOf<
    Parameters<FilterRegistryApi['clearGroup']>[0]
  >().toEqualTypeOf<string>();
  expectTypeOf<UseMosaicHistogramResult['bins']>().toEqualTypeOf<
    Array<{ bin: number; count: number }>
  >();
  expectTypeOf<UseMosaicHistogramResult['loading']>().toEqualTypeOf<boolean>();
  expectTypeOf<
    UseMosaicHistogramResult['error']
  >().toEqualTypeOf<Error | null>();
  expectTypeOf<
    UseMosaicHistogramResult['client']
  >().toEqualTypeOf<MosaicHistogramClient | null>();
  expectTypeOf<FilterValueKind>().toEqualTypeOf<
    | 'text'
    | 'facet-single'
    | 'facet-multi'
    | 'date'
    | 'date-range'
    | 'number'
    | 'number-range'
  >();
  expectTypeOf<UseMosaicFiltersOptions['scopeId']>().toEqualTypeOf<string>();
  expectTypeOf<UseMosaicFiltersOptions['definitions']>().toEqualTypeOf<
    Array<FilterDefinition>
  >();
  expectTypeOf<FilterScope['definitions']>().toEqualTypeOf<
    Array<FilterDefinition>
  >();
  expectTypeOf<FilterRuntime['scopeId']>().toEqualTypeOf<string>();
  expectTypeOf<FilterBinding['operator']>().toEqualTypeOf<string | null>();
  expectTypeOf<
    UseFilterFacetOptions['filter']
  >().toEqualTypeOf<FilterRuntime>();
  expectTypeOf<TextConditionOperatorId>().toEqualTypeOf<
    | 'contains'
    | 'does_not_contain'
    | 'starts_with'
    | 'ends_with'
    | 'is_exactly'
    | 'equals'
    | 'not_equals'
    | 'is_empty'
    | 'is_not_empty'
  >();
  expectTypeOf<SelectConditionOperatorId>().toEqualTypeOf<
    'is' | 'is_not' | 'is_empty' | 'is_not_empty'
  >();
  expectTypeOf<ScalarMultiselectConditionOperatorId>().toEqualTypeOf<
    | 'is_any_of'
    | 'is_not_any_of'
    | 'any_of'
    | 'none_of'
    | 'is_empty'
    | 'is_not_empty'
  >();
  expectTypeOf<ArrayMultiselectConditionOperatorId>().toEqualTypeOf<
    | 'is_any_of'
    | 'is_not_any_of'
    | 'any_of'
    | 'none_of'
    | 'includes_all'
    | 'excludes_all'
    | 'is_empty'
    | 'is_not_empty'
  >();
  expectTypeOf<DateConditionOperatorId>().toEqualTypeOf<
    | 'before'
    | 'after'
    | 'on_or_before'
    | 'on_or_after'
    | 'equals'
    | 'not_equals'
    | 'is_empty'
    | 'is_not_empty'
  >();
  expectTypeOf<DateRangeConditionOperatorId>().toEqualTypeOf<
    | 'between'
    | 'before'
    | 'after'
    | 'on_or_before'
    | 'on_or_after'
    | 'is_empty'
    | 'is_not_empty'
  >();
  expectTypeOf<NumberConditionOperatorId>().toEqualTypeOf<
    | 'eq'
    | 'neq'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'equals'
    | 'not_equals'
    | 'before'
    | 'after'
    | 'on_or_before'
    | 'on_or_after'
    | 'is_empty'
    | 'is_not_empty'
  >();
  expectTypeOf<NumberRangeConditionOperatorId>().toEqualTypeOf<
    | 'between'
    | 'before'
    | 'after'
    | 'on_or_before'
    | 'on_or_after'
    | 'is_empty'
    | 'is_not_empty'
  >();
});
