import { expect, test } from 'vitest';

import * as reactTable from '../src/index';

test('publishes the table-specific active-filter helpers from the table package', () => {
  expect(reactTable).toHaveProperty('useMosaicReactTable');
  expect(reactTable).toHaveProperty('useMosaicTableFilter');
  expect(reactTable).toHaveProperty('MosaicFilterProvider');
  expect(reactTable).toHaveProperty('useFilterRegistry');
  expect(reactTable).toHaveProperty('useActiveFilters');
  expect(reactTable).toHaveProperty('useRegisterFilterSource');
});
