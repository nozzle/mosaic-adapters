import { describe, expect, test } from 'vitest';

import { paginationToWindow, sortingToOrderBy } from '../src/index';
import type { PaginationState, SortingState } from '@tanstack/table-core';
import type { OrderByItem } from '@nozzleio/mosaic-core';

describe('sortingToOrderBy', () => {
  const cases: Array<{
    name: string;
    sorting: SortingState;
    columnMap?: Record<string, string>;
    expected: Array<OrderByItem>;
  }> = [
    {
      name: 'empty sorting produces an empty orderBy',
      sorting: [],
      expected: [],
    },
    {
      name: 'single ascending column',
      sorting: [{ id: 'name', desc: false }],
      expected: [{ column: 'name', desc: false }],
    },
    {
      name: 'multi-column order is preserved with desc flags',
      sorting: [
        { id: 'sport', desc: true },
        { id: 'weight', desc: false },
      ],
      expected: [
        { column: 'sport', desc: true },
        { column: 'weight', desc: false },
      ],
    },
    {
      name: 'columnMap remaps TanStack ids to SQL columns',
      sorting: [
        { id: 'fullName', desc: false },
        { id: 'weight', desc: true },
      ],
      columnMap: { fullName: 'full_name' },
      expected: [
        { column: 'full_name', desc: false },
        { column: 'weight', desc: true },
      ],
    },
  ];

  test.each(cases)('$name', ({ sorting, columnMap, expected }) => {
    expect(sortingToOrderBy(sorting, columnMap)).toEqual(expected);
  });
});

describe('paginationToWindow', () => {
  const cases: Array<{
    name: string;
    pagination: PaginationState;
    expected: { limit: number; offset: number };
  }> = [
    {
      name: 'first page starts at offset 0',
      pagination: { pageIndex: 0, pageSize: 25 },
      expected: { limit: 25, offset: 0 },
    },
    {
      name: 'later pages multiply the page size',
      pagination: { pageIndex: 3, pageSize: 10 },
      expected: { limit: 10, offset: 30 },
    },
    {
      name: 'page size 1 windows a single row',
      pagination: { pageIndex: 5, pageSize: 1 },
      expected: { limit: 1, offset: 5 },
    },
  ];

  test.each(cases)('$name', ({ pagination, expected }) => {
    expect(paginationToWindow(pagination)).toEqual(expected);
  });
});
