/**
 * Dedicated SQL validation test suite.
 *
 * Exercises edge cases that the grouped-query-builder tests don't cover,
 * validating that every generated SQL string is parseable DuckDB SQL.
 */

import { describe, expect, test } from 'vitest';
import * as mSql from '@uwdata/mosaic-sql';
import {
  buildGroupedLevelQuery,
  buildLeafRowsQuery,
  buildGroupedSelectionPredicate,
  buildGroupedMultiSelectionPredicate,
} from '../src/grouped/query-builder';
import type { GroupLevel, GroupMetric, LeafColumn } from '../src/grouped/types';
import { analyzeSql, expectValidSql } from './utils/sql-validator';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LEVELS: Array<GroupLevel> = [
  { column: 'region' },
  { column: 'city' },
  { column: 'district' },
  { column: 'block' },
  { column: 'unit' },
];

const SINGLE_METRIC: Array<GroupMetric> = [
  { id: 'cnt', expression: mSql.count(), label: 'Count' },
];

const LEAF_COLS: Array<LeafColumn> = [
  { column: 'id', label: 'ID' },
  { column: 'value', label: 'Value' },
];

// ---------------------------------------------------------------------------
// Grouped Level Query Edge Cases
// ---------------------------------------------------------------------------

describe('SQL validation: buildGroupedLevelQuery edge cases', () => {
  test('single metric produces valid SQL', () => {
    const sql = buildGroupedLevelQuery({
      table: 'data',
      groupBy: [{ column: 'category' }],
      depth: 0,
      metrics: SINGLE_METRIC,
      parentConstraints: {},
    }).toString();

    expectValidSql(sql);
  });

  test('deeply nested parent constraints (5 levels) produce valid SQL', () => {
    const sql = buildGroupedLevelQuery({
      table: 'data',
      groupBy: LEVELS,
      depth: 4,
      metrics: SINGLE_METRIC,
      parentConstraints: {
        region: 'North',
        city: 'Portland',
        district: 'Downtown',
        block: 'A1',
      },
    }).toString();

    expectValidSql(sql);
    expect(sql).toContain("'North'");
    expect(sql).toContain("'Portland'");
    expect(sql).toContain("'Downtown'");
    expect(sql).toContain("'A1'");
  });

  test('special characters in literal values produce valid SQL', () => {
    const sql = buildGroupedLevelQuery({
      table: 'data',
      groupBy: [{ column: 'category' }, { column: 'sub' }],
      depth: 1,
      metrics: SINGLE_METRIC,
      parentConstraints: { category: "O'Brien & Co." },
    }).toString();

    expectValidSql(sql);
  });

  test('filter predicate + additional WHERE + parent constraint combined', () => {
    const filter = mSql.gt(mSql.column('score'), mSql.literal(50));
    const extra = mSql.isNotNull(mSql.column('region'));

    const sql = buildGroupedLevelQuery({
      table: 'data',
      groupBy: LEVELS,
      depth: 1,
      metrics: SINGLE_METRIC,
      parentConstraints: { region: 'East' },
      filterPredicate: filter,
      additionalWhere: extra,
    }).toString();

    expectValidSql(sql);
  });

  test('limit=0 omits LIMIT clause and produces valid SQL', () => {
    const sql = buildGroupedLevelQuery({
      table: 'data',
      groupBy: [{ column: 'x' }],
      depth: 0,
      metrics: SINGLE_METRIC,
      parentConstraints: {},
      limit: 0,
    }).toString();

    expectValidSql(sql);
    expect(sql).not.toContain('LIMIT');
  });
});

// ---------------------------------------------------------------------------
// Leaf Query Edge Cases
// ---------------------------------------------------------------------------

describe('SQL validation: buildLeafRowsQuery edge cases', () => {
  test('selectAll regex hack produces valid SQL with WHERE and ORDER BY', () => {
    const sql = buildLeafRowsQuery({
      table: 'data',
      leafColumns: LEAF_COLS,
      parentConstraints: { region: 'West', city: 'Seattle' },
      selectAll: true,
      orderBy: 'value',
      orderDir: 'asc',
      limit: 50,
    }).toString();

    expectValidSql(sql);
    expect(sql).toContain('SELECT *');
    expect(sql).toContain('ASC');
  });

  test('single parent constraint (no AND needed) produces valid SQL', () => {
    const sql = buildLeafRowsQuery({
      table: 'data',
      leafColumns: LEAF_COLS,
      parentConstraints: { region: 'South' },
    }).toString();

    expectValidSql(sql);
  });

  test('many parent constraints produce valid SQL', () => {
    const sql = buildLeafRowsQuery({
      table: 'data',
      leafColumns: LEAF_COLS,
      parentConstraints: {
        region: 'North',
        city: 'Portland',
        district: 'Downtown',
        block: 'B2',
      },
    }).toString();

    expectValidSql(sql);
  });

  test('limit=0 omits LIMIT clause and produces valid SQL', () => {
    const sql = buildLeafRowsQuery({
      table: 'data',
      leafColumns: LEAF_COLS,
      parentConstraints: {},
      limit: 0,
    }).toString();

    expectValidSql(sql);
    expect(sql).not.toContain('LIMIT');
  });
});

// ---------------------------------------------------------------------------
// Selection Predicate Edge Cases
// ---------------------------------------------------------------------------

describe('SQL validation: selection predicates', () => {
  test('deeply nested predicate (4 ancestors) is valid SQL fragment', () => {
    const predicate = buildGroupedSelectionPredicate({
      groupColumn: 'unit',
      groupValue: 'U42',
      parentConstraints: {
        region: 'West',
        city: 'LA',
        district: 'Hollywood',
        block: 'C3',
      },
    });

    // Predicates are fragments — wrap in a SELECT to validate
    const sql = `SELECT * FROM t WHERE ${predicate.toString()}`;
    expectValidSql(sql);
  });

  test('multi-select OR predicate is valid SQL fragment', () => {
    const predicate = buildGroupedMultiSelectionPredicate([
      { groupColumn: 'region', groupValue: 'North', parentConstraints: {} },
      { groupColumn: 'region', groupValue: 'South', parentConstraints: {} },
      { groupColumn: 'region', groupValue: 'East', parentConstraints: {} },
    ]);

    const sql = `SELECT * FROM t WHERE ${predicate!.toString()}`;
    expectValidSql(sql);
  });

  test('multi-select with compound children is valid SQL fragment', () => {
    const predicate = buildGroupedMultiSelectionPredicate([
      {
        groupColumn: 'city',
        groupValue: 'Portland',
        parentConstraints: { region: 'North' },
      },
      {
        groupColumn: 'city',
        groupValue: 'LA',
        parentConstraints: { region: 'West' },
      },
    ]);

    const sql = `SELECT * FROM t WHERE ${predicate!.toString()}`;
    expectValidSql(sql);
  });
});

// ---------------------------------------------------------------------------
// Filter Factory SQL Shapes
// ---------------------------------------------------------------------------

describe('SQL validation: filter operator shapes', () => {
  test('eq operator produces valid SQL', () => {
    const expr = mSql.eq(mSql.column('status'), mSql.literal('active'));
    const sql = `SELECT * FROM t WHERE ${expr.toString()}`;
    expectValidSql(sql);
  });

  test('ILIKE pattern produces valid SQL', () => {
    const expr = mSql.sql`"name" ILIKE ${mSql.literal('%test%')}`;
    const sql = `SELECT * FROM t WHERE ${expr.toString()}`;
    expectValidSql(sql);
  });

  test('NOT ILIKE pattern produces valid SQL', () => {
    const expr = mSql.sql`"name" NOT ILIKE ${mSql.literal('%test%')}`;
    const sql = `SELECT * FROM t WHERE ${expr.toString()}`;
    expectValidSql(sql);
  });

  test('isBetween produces valid SQL', () => {
    const col = mSql.column('price');
    const expr = mSql.isBetween(col, [mSql.literal(10), mSql.literal(100)]);
    const sql = `SELECT * FROM t WHERE ${expr.toString()}`;
    expectValidSql(sql);
  });

  test('isIn produces valid SQL', () => {
    const col = mSql.column('status');
    const expr = mSql.isIn(col, [
      mSql.literal('active'),
      mSql.literal('pending'),
    ]);
    const sql = `SELECT * FROM t WHERE ${expr.toString()}`;
    expectValidSql(sql);
  });

  test('IS NULL produces valid SQL', () => {
    const expr = mSql.sql`"deleted_at" IS NULL`;
    const sql = `SELECT * FROM t WHERE ${expr.toString()}`;
    expectValidSql(sql);
  });

  test('combined AND of multiple operators produces valid SQL', () => {
    const clauses = [
      mSql.eq(mSql.column('status'), mSql.literal('active')),
      mSql.gt(mSql.column('score'), mSql.literal(50)),
      mSql.isNotNull(mSql.column('name')),
    ];
    const combined = mSql.and(...clauses);
    const sql = `SELECT * FROM t WHERE ${combined.toString()}`;
    expectValidSql(sql);
  });

  test('TRY_CAST numeric access produces valid SQL', () => {
    const expr = mSql.sql`TRY_CAST("price" AS DOUBLE)`;
    const sql = `SELECT * FROM t WHERE ${expr.toString()} > 0`;
    expectValidSql(sql);
  });

  test('TRY_CAST timestamp access produces valid SQL', () => {
    const expr = mSql.sql`TRY_CAST("created_at" AS TIMESTAMP)`;
    const sql = `SELECT * FROM t WHERE ${expr.toString()} > '2024-01-01'`;
    expectValidSql(sql);
  });
});

// ---------------------------------------------------------------------------
// analyzeSql structural checks
// ---------------------------------------------------------------------------

describe('analyzeSql structural analysis', () => {
  test('grouped query analysis detects aggregates', () => {
    const sql = buildGroupedLevelQuery({
      table: 'data',
      groupBy: [{ column: 'category' }],
      depth: 0,
      metrics: SINGLE_METRIC,
      parentConstraints: {},
    }).toString();

    const analysis = analyzeSql(sql);
    expect(analysis.valid).toBe(true);
    expect(analysis.formatted).not.toBe('');
  });

  test('leaf query analysis shows no aggregates', () => {
    const sql = buildLeafRowsQuery({
      table: 'data',
      leafColumns: LEAF_COLS,
      parentConstraints: { category: 'A' },
    }).toString();

    const analysis = analyzeSql(sql);
    expect(analysis.valid).toBe(true);
  });

  test('invalid SQL is detected', () => {
    const analysis = analyzeSql('SELECT FROM WHERE ,,, GROUP');
    expect(analysis.valid).toBe(false);
    expect(analysis.error).toBeDefined();
  });
});
