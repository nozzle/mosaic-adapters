import { describe, expect, test, vi } from 'vitest';

vi.mock('@uwdata/mosaic-core', () => ({
  isArrowTable: (val: unknown) =>
    val != null &&
    typeof val === 'object' &&
    'numRows' in (val as Record<string, unknown>) &&
    'get' in (val as Record<string, unknown>),
}));

import { arrowTableToObjects } from '../src/grouped/arrow-utils';

// ---------------------------------------------------------------------------
// Helper: build a mock Arrow table from plain objects
// ---------------------------------------------------------------------------

function mockArrowTable(rows: Array<Record<string, unknown>>) {
  return {
    numRows: rows.length,
    get(index: number) {
      return rows[index] ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// arrowTableToObjects
// ---------------------------------------------------------------------------

describe('arrowTableToObjects', () => {
  test('returns [] for non-Arrow input (string, null, number)', () => {
    expect(arrowTableToObjects('hello')).toEqual([]);
    expect(arrowTableToObjects(null)).toEqual([]);
    expect(arrowTableToObjects(42)).toEqual([]);
  });

  test('converts mock Arrow table with number values to plain objects', () => {
    const table = mockArrowTable([
      { country: 'USA', count: 100 },
      { country: 'GBR', count: 50 },
    ]);

    const result = arrowTableToObjects(table);
    expect(result).toEqual([
      { country: 'USA', count: 100 },
      { country: 'GBR', count: 50 },
    ]);
  });

  test('coerces BigInt values to Number', () => {
    const table = mockArrowTable([
      { country: 'USA', count: BigInt(100) },
      { country: 'GBR', count: BigInt(50) },
    ]);

    const result = arrowTableToObjects(table);
    expect(result).toEqual([
      { country: 'USA', count: 100 },
      { country: 'GBR', count: 50 },
    ]);
    expect(typeof result[0]!.count).toBe('number');
  });

  test('skips null rows from get()', () => {
    const table = {
      numRows: 3,
      get(index: number) {
        if (index === 1) return null;
        return { country: index === 0 ? 'USA' : 'GBR', count: 10 };
      },
    };

    const result = arrowTableToObjects(table);
    expect(result).toHaveLength(2);
    expect(result[0]!.country).toBe('USA');
    expect(result[1]!.country).toBe('GBR');
  });

  test('handles empty table (numRows=0) → returns []', () => {
    const table = mockArrowTable([]);
    expect(arrowTableToObjects(table)).toEqual([]);
  });
});
