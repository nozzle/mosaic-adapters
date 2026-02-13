import { describe, expect, test } from 'vitest';
import * as mSql from '@uwdata/mosaic-sql';
import {
  buildGroupedLevelQuery,
  buildLeafRowsQuery,
  buildGroupedSelectionPredicate,
  buildGroupedMultiSelectionPredicate,
} from '../src/grouped/query-builder';
import type { GroupLevel, GroupMetric, LeafColumn } from '../src/grouped/types';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const GROUP_BY: Array<GroupLevel> = [
  { column: 'country' },
  { column: 'sport' },
  { column: 'gender' },
];

const METRICS: Array<GroupMetric> = [
  { id: 'count', expression: mSql.count(), label: 'Count' },
  { id: 'total_gold', expression: mSql.sum('gold'), label: 'Gold' },
];

const LEAF_COLUMNS: Array<LeafColumn> = [
  { column: 'name', label: 'Name' },
  { column: 'height', label: 'Height' },
  { column: 'weight', label: 'Weight' },
];

// ---------------------------------------------------------------------------
// buildGroupedLevelQuery
// ---------------------------------------------------------------------------

describe('buildGroupedLevelQuery', () => {
  test('root level (depth=0): correct GROUP BY, SELECT, ORDER BY DESC, LIMIT 200', () => {
    const sql = buildGroupedLevelQuery({
      table: 'athletes',
      groupBy: GROUP_BY,
      depth: 0,
      metrics: METRICS,
      parentConstraints: {},
    }).toString();

    expect(sql).toContain('FROM "athletes"');
    expect(sql).toContain('"country"');
    expect(sql).toContain('GROUP BY');
    expect(sql).toContain('ORDER BY');
    expect(sql).toContain('DESC');
    expect(sql).toContain('LIMIT 200');
  });

  test('child level (depth=1): includes parent constraint in WHERE', () => {
    const sql = buildGroupedLevelQuery({
      table: 'athletes',
      groupBy: GROUP_BY,
      depth: 1,
      metrics: METRICS,
      parentConstraints: { country: 'USA' },
    }).toString();

    expect(sql).toContain('"sport"');
    expect(sql).toContain('GROUP BY');
    expect(sql).toContain("'USA'");
    expect(sql).toContain('WHERE');
  });

  test('applies filterPredicate to WHERE', () => {
    const filter = mSql.eq(mSql.column('sex'), mSql.literal('M'));
    const sql = buildGroupedLevelQuery({
      table: 'athletes',
      groupBy: GROUP_BY,
      depth: 0,
      metrics: METRICS,
      parentConstraints: {},
      filterPredicate: filter,
    }).toString();

    expect(sql).toContain('WHERE');
    expect(sql).toContain("'M'");
  });

  test('applies additionalWhere to WHERE', () => {
    const extra = mSql.isNotNull(mSql.column('country'));
    const sql = buildGroupedLevelQuery({
      table: 'athletes',
      groupBy: GROUP_BY,
      depth: 0,
      metrics: METRICS,
      parentConstraints: {},
      additionalWhere: extra,
    }).toString();

    expect(sql).toContain('WHERE');
    expect(sql).toContain('IS NOT NULL');
  });

  test('combines multiple WHERE clauses with AND', () => {
    const filter = mSql.eq(mSql.column('sex'), mSql.literal('M'));
    const extra = mSql.isNotNull(mSql.column('country'));
    const sql = buildGroupedLevelQuery({
      table: 'athletes',
      groupBy: GROUP_BY,
      depth: 1,
      metrics: METRICS,
      parentConstraints: { country: 'USA' },
      filterPredicate: filter,
      additionalWhere: extra,
    }).toString();

    expect(sql).toContain('AND');
    expect(sql).toContain("'USA'");
    expect(sql).toContain("'M'");
    expect(sql).toContain('IS NOT NULL');
  });

  test('respects custom limit', () => {
    const sql = buildGroupedLevelQuery({
      table: 'athletes',
      groupBy: GROUP_BY,
      depth: 0,
      metrics: METRICS,
      parentConstraints: {},
      limit: 50,
    }).toString();

    expect(sql).toContain('LIMIT 50');
  });

  test('respects custom orderByMetric', () => {
    const sql = buildGroupedLevelQuery({
      table: 'athletes',
      groupBy: GROUP_BY,
      depth: 0,
      metrics: METRICS,
      parentConstraints: {},
      orderByMetric: 'total_gold',
    }).toString();

    expect(sql).toContain('"total_gold"');
    expect(sql).toContain('DESC');
  });

  test('throws for depth < 0', () => {
    expect(() =>
      buildGroupedLevelQuery({
        table: 'athletes',
        groupBy: GROUP_BY,
        depth: -1,
        metrics: METRICS,
        parentConstraints: {},
      }),
    ).toThrow('depth -1 out of range');
  });

  test('throws for depth >= groupBy.length', () => {
    expect(() =>
      buildGroupedLevelQuery({
        table: 'athletes',
        groupBy: GROUP_BY,
        depth: 3,
        metrics: METRICS,
        parentConstraints: {},
      }),
    ).toThrow('depth 3 out of range');
  });

  test('multiple metrics appear in SELECT', () => {
    const sql = buildGroupedLevelQuery({
      table: 'athletes',
      groupBy: GROUP_BY,
      depth: 0,
      metrics: METRICS,
      parentConstraints: {},
    }).toString();

    expect(sql).toContain('"count"');
    expect(sql).toContain('"total_gold"');
  });
});

// ---------------------------------------------------------------------------
// buildLeafRowsQuery
// ---------------------------------------------------------------------------

describe('buildLeafRowsQuery', () => {
  test('basic leaf query with named columns + parent constraints', () => {
    const sql = buildLeafRowsQuery({
      table: 'athletes',
      leafColumns: LEAF_COLUMNS,
      parentConstraints: { country: 'USA', sport: 'Swimming' },
    }).toString();

    expect(sql).toContain('"name"');
    expect(sql).toContain('"height"');
    expect(sql).toContain('"weight"');
    expect(sql).toContain("'USA'");
    expect(sql).toContain("'Swimming'");
    expect(sql).toContain('WHERE');
    expect(sql).toContain('LIMIT 100');
  });

  test('respects custom limit, orderBy, orderDir=asc', () => {
    const sql = buildLeafRowsQuery({
      table: 'athletes',
      leafColumns: LEAF_COLUMNS,
      parentConstraints: { country: 'USA' },
      limit: 25,
      orderBy: 'height',
      orderDir: 'asc',
    }).toString();

    expect(sql).toContain('LIMIT 25');
    expect(sql).toContain('"height"');
    expect(sql).toContain('ASC');
  });

  test('selectAll=true replaces columns with SELECT *', () => {
    const sql = buildLeafRowsQuery({
      table: 'athletes',
      leafColumns: LEAF_COLUMNS,
      parentConstraints: { country: 'USA' },
      selectAll: true,
    }).toString();

    expect(sql).toContain('SELECT *');
  });

  test('throws when leafColumns is empty and selectAll is false', () => {
    expect(() =>
      buildLeafRowsQuery({
        table: 'athletes',
        leafColumns: [],
        parentConstraints: {},
      }),
    ).toThrow('leafColumns must not be empty');
  });

  test('applies filterPredicate and additionalWhere', () => {
    const filter = mSql.eq(mSql.column('sex'), mSql.literal('F'));
    const extra = mSql.isNotNull(mSql.column('name'));
    const sql = buildLeafRowsQuery({
      table: 'athletes',
      leafColumns: LEAF_COLUMNS,
      parentConstraints: { country: 'USA' },
      filterPredicate: filter,
      additionalWhere: extra,
    }).toString();

    expect(sql).toContain("'F'");
    expect(sql).toContain('IS NOT NULL');
    expect(sql).toContain('AND');
  });
});

// ---------------------------------------------------------------------------
// buildGroupedSelectionPredicate
// ---------------------------------------------------------------------------

describe('buildGroupedSelectionPredicate', () => {
  test('root-level row: single equality predicate', () => {
    const sql = buildGroupedSelectionPredicate({
      _groupColumn: 'country',
      _groupValue: 'USA',
      _parentValues: {},
    }).toString();

    expect(sql).toContain('"country"');
    expect(sql).toContain("'USA'");
  });

  test('child-level row: AND of parent + own column', () => {
    const sql = buildGroupedSelectionPredicate({
      _groupColumn: 'sport',
      _groupValue: 'Swimming',
      _parentValues: { country: 'USA' },
    }).toString();

    expect(sql).toContain('"country"');
    expect(sql).toContain("'USA'");
    expect(sql).toContain('"sport"');
    expect(sql).toContain("'Swimming'");
    expect(sql).toContain('AND');
  });

  test('deep-level row: chains all 3 ancestor constraints', () => {
    const sql = buildGroupedSelectionPredicate({
      _groupColumn: 'gender',
      _groupValue: 'M',
      _parentValues: { country: 'USA', sport: 'Swimming' },
    }).toString();

    expect(sql).toContain('"country"');
    expect(sql).toContain("'USA'");
    expect(sql).toContain('"sport"');
    expect(sql).toContain("'Swimming'");
    expect(sql).toContain('"gender"');
    expect(sql).toContain("'M'");
  });
});

// ---------------------------------------------------------------------------
// buildGroupedMultiSelectionPredicate
// ---------------------------------------------------------------------------

describe('buildGroupedMultiSelectionPredicate', () => {
  test('empty array returns null', () => {
    expect(buildGroupedMultiSelectionPredicate([])).toBeNull();
  });

  test('single row: returns predicate directly (no OR)', () => {
    const result = buildGroupedMultiSelectionPredicate([
      {
        _groupColumn: 'country',
        _groupValue: 'USA',
        _parentValues: {},
      },
    ]);

    const sql = result!.toString();
    expect(sql).toContain('"country"');
    expect(sql).toContain("'USA'");
    expect(sql).not.toContain('OR');
  });

  test('multiple rows: returns OR of compound predicates', () => {
    const result = buildGroupedMultiSelectionPredicate([
      {
        _groupColumn: 'country',
        _groupValue: 'USA',
        _parentValues: {},
      },
      {
        _groupColumn: 'country',
        _groupValue: 'GBR',
        _parentValues: {},
      },
    ]);

    const sql = result!.toString();
    expect(sql).toContain("'USA'");
    expect(sql).toContain("'GBR'");
    expect(sql).toContain('OR');
  });
});
