import '../src/table-core';
import * as mSql from '@uwdata/mosaic-sql';
import { describe, expect, test } from 'vitest';

import { defaultFilterStrategies } from '../src/query/filter-factory';
import { extractInternalFilters } from '../src/query/query-builder';
import { ColumnMapper } from '../src/query/column-mapper';
import { StrategyRegistry } from '../src/registry';
import { SqlIdentifier } from '../src/domain/sql-identifier';

import type { TableState } from '@tanstack/table-core';
import type { FilterStrategy } from '../src/query/filter-factory';
import type { MosaicColumnDef, MosaicColumnMapping } from '../src/types';

type Row = {
  question: string;
  name: string;
};

function popularQuestions(threshold: number) {
  return mSql.Query.select('question')
    .from('data')
    .groupby('question')
    .having(mSql.gte(mSql.count(), threshold));
}

const filterRegistry = new StrategyRegistry<Record<string, FilterStrategy>>(
  defaultFilterStrategies,
);

function tableStateWith(
  columnFilters: Array<{ id: string; value: unknown }>,
): TableState {
  return { columnFilters } as unknown as TableState;
}

describe('SUBQUERY filter strategy (defaultFilterStrategies)', () => {
  test('is registered as a default strategy', () => {
    expect(defaultFilterStrategies.SUBQUERY).toBeTypeOf('function');
  });

  const runSubquery = defaultFilterStrategies.SUBQUERY!;

  test('builds a membership predicate from the resolved factory', () => {
    const expr = runSubquery({
      columnAccessor: SqlIdentifier.from('question'),
      input: { mode: 'SUBQUERY', value: 100 },
      columnId: 'question',
      subqueryFactory: (value) => popularQuestions(Number(value)),
    });

    expect(String(expr)).toBe(
      '("question" IN (SELECT "question" FROM "data" GROUP BY "question" HAVING (count(*) >= 100)))',
    );
  });

  test('negates the membership predicate when the factory asks for it', () => {
    const expr = runSubquery({
      columnAccessor: SqlIdentifier.from('question'),
      input: { mode: 'SUBQUERY', value: 3 },
      subqueryFactory: (value) => ({
        query: popularQuestions(Number(value)),
        negate: true,
      }),
    });

    expect(String(expr)).toContain('NOT ("question" IN');
  });

  test('returns undefined when no factory is configured', () => {
    const expr = runSubquery({
      columnAccessor: SqlIdentifier.from('question'),
      input: { mode: 'SUBQUERY', value: 100 },
      columnId: 'question',
    });

    expect(expr).toBeUndefined();
  });

  test('returns undefined when the factory opts out with null', () => {
    const expr = runSubquery({
      columnAccessor: SqlIdentifier.from('question'),
      input: { mode: 'SUBQUERY', value: null },
      subqueryFactory: (value) =>
        value == null ? null : popularQuestions(Number(value)),
    });

    expect(expr).toBeUndefined();
  });

  test('ignores inputs whose mode is not SUBQUERY', () => {
    const expr = runSubquery({
      columnAccessor: SqlIdentifier.from('question'),
      input: { mode: 'TEXT', value: 'anything' },
      subqueryFactory: () => popularQuestions(1),
    });

    expect(expr).toBeUndefined();
  });
});

describe('extractInternalFilters — SUBQUERY wiring', () => {
  test('dynamic SUBQUERY mode resolves the factory from mosaic meta', () => {
    const columns: Array<MosaicColumnDef<Row>> = [
      {
        accessorKey: 'question',
        header: 'Question',
        meta: {
          mosaic: { subquery: (value) => popularQuestions(Number(value)) },
        },
      },
    ];
    const mapper = new ColumnMapper<Row>(columns);

    const result = extractInternalFilters({
      tableState: tableStateWith([
        { id: 'question', value: { mode: 'SUBQUERY', value: 100 } },
      ]),
      mapper,
      mapping: undefined,
      filterRegistry,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.target).toBe('where');
    expect(String(result[0]!.predicate)).toContain(
      '"question" IN (SELECT "question"',
    );
    expect(String(result[0]!.predicate)).toContain('count(*) >= 100');
  });

  test('static SUBQUERY filterType resolves the factory from mapping config', () => {
    const columns: Array<MosaicColumnDef<Row>> = [
      { accessorKey: 'question', header: 'Question' },
    ];
    const mapping: MosaicColumnMapping<Row> = {
      question: {
        sqlColumn: 'question',
        type: 'VARCHAR',
        filterType: 'SUBQUERY',
        subquery: (value) => popularQuestions(Number(value)),
      },
    };
    const mapper = new ColumnMapper<Row>(columns, mapping);

    // The stored value is the raw, serializable params (no mode wrapper).
    const result = extractInternalFilters({
      tableState: tableStateWith([{ id: 'question', value: 50 }]),
      mapper,
      mapping,
      filterRegistry,
    });

    expect(result).toHaveLength(1);
    expect(String(result[0]!.predicate)).toContain('count(*) >= 50');
  });

  test('mapping subquery factory takes precedence over mosaic meta', () => {
    const columns: Array<MosaicColumnDef<Row>> = [
      {
        accessorKey: 'question',
        header: 'Question',
        meta: { mosaic: { subquery: () => popularQuestions(999) } },
      },
    ];
    const mapping: MosaicColumnMapping<Row> = {
      question: {
        sqlColumn: 'question',
        type: 'VARCHAR',
        subquery: () => popularQuestions(7),
      },
    };
    const mapper = new ColumnMapper<Row>(columns, mapping);

    const result = extractInternalFilters({
      tableState: tableStateWith([
        { id: 'question', value: { mode: 'SUBQUERY', value: 1 } },
      ]),
      mapper,
      mapping,
      filterRegistry,
    });

    expect(String(result[0]!.predicate)).toContain('count(*) >= 7');
    expect(String(result[0]!.predicate)).not.toContain('999');
  });

  test('a SUBQUERY filter without a configured factory yields no predicate', () => {
    const columns: Array<MosaicColumnDef<Row>> = [
      { accessorKey: 'question', header: 'Question' },
    ];
    const mapper = new ColumnMapper<Row>(columns);

    const result = extractInternalFilters({
      tableState: tableStateWith([
        { id: 'question', value: { mode: 'SUBQUERY', value: 1 } },
      ]),
      mapper,
      mapping: undefined,
      filterRegistry,
    });

    expect(result).toHaveLength(0);
  });

  test('cascading facets exclude the subquery column itself (excludeColumnId)', () => {
    const columns: Array<MosaicColumnDef<Row>> = [
      {
        accessorKey: 'question',
        header: 'Question',
        meta: { mosaic: { subquery: () => popularQuestions(2) } },
      },
    ];
    const mapper = new ColumnMapper<Row>(columns);

    const result = extractInternalFilters({
      tableState: tableStateWith([
        { id: 'question', value: { mode: 'SUBQUERY', value: 1 } },
      ]),
      mapper,
      mapping: undefined,
      filterRegistry,
      excludeColumnId: 'question',
    });

    expect(result).toHaveLength(0);
  });

  test('subquery filters narrow sibling facets (kept when another column is excluded)', () => {
    const columns: Array<MosaicColumnDef<Row>> = [
      {
        accessorKey: 'question',
        header: 'Question',
        meta: { mosaic: { subquery: () => popularQuestions(2) } },
      },
      { accessorKey: 'name', header: 'Name' },
    ];
    const mapping: MosaicColumnMapping<Row> = {
      name: { sqlColumn: 'name', type: 'VARCHAR', filterType: 'PARTIAL_ILIKE' },
    };
    const mapper = new ColumnMapper<Row>(columns, mapping);

    const result = extractInternalFilters({
      tableState: tableStateWith([
        { id: 'question', value: { mode: 'SUBQUERY', value: 1 } },
        { id: 'name', value: 'ali' },
      ]),
      mapper,
      mapping,
      filterRegistry,
      excludeColumnId: 'name',
    });

    expect(result).toHaveLength(1);
    expect(String(result[0]!.predicate)).toContain('"question" IN (SELECT');
  });
});
