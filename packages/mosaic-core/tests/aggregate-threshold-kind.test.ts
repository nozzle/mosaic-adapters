/**
 * Tests for {@link aggregateThresholdFilterKind}: the two-target "groups whose
 * aggregate passes a threshold" kind. SQL shape, node identity and option
 * validation are checked on the emitted AST; the semantics run on DuckDB.
 */
import { createAthletesDb, waitFor } from '@nozzleio/test-support/duckdb';
import { Selection } from '@uwdata/mosaic-core';
import { InOpNode, Query, TableRefNode, column, count, gt, literal, max } from '@uwdata/mosaic-sql';
import type { ExprNode } from '@uwdata/mosaic-sql';
import { describe, expect, test, vi } from 'vitest';

import {
  THRESHOLD_OPERATORS,
  aggregateThresholdFilterKind,
  createFilterSet,
  emitFilterSpec,
} from '../src/index';
import type { FilterKind, FilterSpec, ThresholdOperator } from '../src/index';

const TARGETS = { having: 'having', members: 'members' } as const;

/** Narrows an optional test value, failing loudly when it is missing. */
function defined<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('expected a value');
  }
  return value;
}

function thresholdKind(
  overrides: Partial<Parameters<typeof aggregateThresholdFilterKind>[0]> = {},
): FilterKind {
  return aggregateThresholdFilterKind({
    from: 'athletes',
    aggregate: () => max('weight'),
    targets: TARGETS,
    ...overrides,
  });
}

function spec(overrides: Partial<FilterSpec> = {}): FilterSpec {
  return {
    id: 'heavy',
    column: 'sport',
    kind: 'threshold',
    operator: 'gte',
    value: 85,
    ...overrides,
  };
}

function emit(kind: FilterKind, input: FilterSpec, contextPredicate?: ExprNode | null) {
  return emitFilterSpec(input, { kinds: { threshold: kind }, contextPredicate });
}

describe('aggregateThresholdFilterKind emissions', () => {
  test('emits a HAVING comparison and a membership subquery on the spec column', () => {
    const [having, members] = emit(thresholdKind(), spec());

    expect(having?.target).toBe('having');
    expect(String(having?.predicate)).toBe('(max("weight") >= 85)');
    expect(having?.fields).toEqual([]);
    expect(having?.value).toBe(85);

    expect(members?.target).toBe('members');
    expect(String(members?.predicate)).toBe(
      '("sport" IN (SELECT "sport" FROM "athletes" GROUP BY "sport" HAVING (max("weight") >= 85)))',
    );
    expect(members?.value).toBe(85);
  });

  test('the members `fields` entry is the exact outer column node in the predicate', () => {
    const [, members] = emit(thresholdKind(), spec());
    const predicate = members?.predicate;
    expect(predicate).toBeInstanceOf(InOpNode);
    expect(members?.fields).toHaveLength(1);
    expect(members?.fields[0]).toBe((predicate as InOpNode).expr);
  });

  test('embeds the context predicate in the subquery WHERE', () => {
    const [having, members] = emit(thresholdKind(), spec(), gt(column('weight'), literal(60)));
    expect(String(members?.predicate)).toBe(
      '("sport" IN (SELECT "sport" FROM "athletes" WHERE ("weight" > 60) GROUP BY "sport" HAVING (max("weight") >= 85)))',
    );
    // The HAVING emission runs on the widget's own query; no context there.
    expect(String(having?.predicate)).toBe('(max("weight") >= 85)');
  });

  test('struct-path columns and table refs', () => {
    const kind = thresholdKind({ from: new TableRefNode(['main', 'events']) });
    const [, members] = emit(kind, spec({ column: 'page.domain', operator: 'lt', value: 3 }));
    expect(String(members?.predicate)).toBe(
      '("page"."domain" IN (SELECT "page"."domain" AS "page.domain" FROM "main"."events" GROUP BY "page"."domain" HAVING (max("weight") < 3)))',
    );
  });

  test('columnPaths: literal groups by the dotted name as one identifier', () => {
    const [, members] = emit(
      thresholdKind(),
      spec({ column: 'page.domain', columnPaths: 'literal', operator: 'lt', value: 3 }),
    );
    expect(String(members?.predicate)).toBe(
      '("page.domain" IN (SELECT "page.domain" FROM "athletes" GROUP BY "page.domain" HAVING (max("weight") < 3)))',
    );
    expect(members?.fields.map((field) => String(field))).toEqual(['"page.domain"']);
  });

  test.each<[ThresholdOperator, string]>([
    ['gt', '>'],
    ['gte', '>='],
    ['lt', '<'],
    ['lte', '<='],
  ])('operator %s compares with %s', (operator, sqlOp) => {
    const [having] = emit(thresholdKind(), spec({ operator, value: 7 }));
    expect(String(having?.predicate)).toBe(`(max("weight") ${sqlOp} 7)`);
  });

  test('a spec without an operator defaults to gte', () => {
    const [having] = emit(thresholdKind(), spec({ operator: undefined }));
    expect(String(having?.predicate)).toBe('(max("weight") >= 85)');
  });

  test('an unsupported operator or a non-finite / non-number value is inactive', () => {
    const kind = thresholdKind({ operators: ['gt', 'lt'] });
    expect(emit(kind, spec({ operator: 'gte' }))).toEqual([]);
    expect(emit(kind, spec({ operator: undefined }))).toEqual([]);
    expect(emit(kind, spec({ operator: 'between' }))).toEqual([]);
    expect(emit(kind, spec({ operator: 'gt', value: '85' }))).toEqual([]);
    expect(emit(kind, spec({ operator: 'gt', value: Number.NaN }))).toEqual([]);
    expect(emit(kind, spec({ operator: 'gt', value: Number.POSITIVE_INFINITY }))).toEqual([]);
    expect(emit(kind, spec({ operator: 'gt', value: undefined }))).toEqual([]);
  });

  test('negative thresholds are allowed (aggregates such as avg can be negative)', () => {
    const [having] = emit(thresholdKind(), spec({ operator: 'gt', value: -2 }));
    expect(String(having?.predicate)).toBe('(max("weight") > -2)');
  });
});

describe('aggregateThresholdFilterKind aggregate nodes', () => {
  test('a factory is called once per emission', () => {
    const factory = vi.fn(() => max('weight'));
    emit(thresholdKind({ aggregate: factory }), spec());
    expect(factory).toHaveBeenCalledTimes(2);
  });

  test('a node is deep-cloned per emission, never shared or reused', () => {
    const aggregate = count();
    const kind = thresholdKind({ aggregate });
    const [having, members] = emit(kind, spec());

    const havingAggregate = (defined(having).predicate as unknown as { left: ExprNode }).left;
    const membersQuery = (defined(members).predicate as InOpNode).values as unknown as {
      subquery: { _having: Array<{ left: ExprNode }> };
    };
    const subqueryAggregate = membersQuery.subquery._having[0]?.left;

    expect(String(havingAggregate)).toBe('count(*)');
    expect(String(subqueryAggregate)).toBe('count(*)');
    expect(havingAggregate).not.toBe(aggregate);
    expect(subqueryAggregate).not.toBe(aggregate);
    expect(havingAggregate).not.toBe(subqueryAggregate);
  });
});

describe('aggregateThresholdFilterKind metadata', () => {
  test('THRESHOLD_OPERATORS lists every comparison as unary', () => {
    expect(THRESHOLD_OPERATORS.map((op) => op.id)).toEqual(['gt', 'gte', 'lt', 'lte']);
    for (const op of THRESHOLD_OPERATORS) {
      expect(op.arity).toBe('unary');
      expect(op.label).toBeTruthy();
    }
  });

  test('advertises every operator by default, or the configured subset in order', () => {
    expect(thresholdKind().operators?.map((op) => op.id)).toEqual(['gt', 'gte', 'lt', 'lte']);
    expect(thresholdKind({ operators: ['lt', 'gt', 'lt'] }).operators).toEqual([
      { id: 'lt', label: 'less than', arity: 'unary' },
      { id: 'gt', label: 'greater than', arity: 'unary' },
    ]);
  });

  test('formats chips with the operator glyph', () => {
    const kind = thresholdKind();
    expect(kind.formatValue?.(spec({ operator: 'gt', value: 5 }))).toBe('> 5');
    expect(kind.formatValue?.(spec({ operator: 'lte', value: 5 }))).toBe('≤ 5');
    expect(kind.formatValue?.(spec({ operator: undefined, value: 5 }))).toBe('≥ 5');
    expect(kind.formatValue?.(spec({ operator: 'nope', value: 5 }))).toBe('5');
  });

  test('rejects invalid options', () => {
    expect(() => thresholdKind({ targets: { having: 'same', members: 'same' } })).toThrow(
      /must differ/,
    );
    expect(() => thresholdKind({ targets: { having: '', members: 'members' } })).toThrow(
      /non-empty/,
    );
    expect(() => thresholdKind({ targets: { having: 'having', members: '  ' } })).toThrow(
      /non-empty/,
    );
    expect(() => thresholdKind({ operators: [] })).toThrow(/must not be empty/);
    expect(() => thresholdKind({ operators: ['gt', 'eq' as ThresholdOperator] })).toThrow(
      /unknown operators: eq/,
    );
  });
});

describe('aggregateThresholdFilterKind in a FilterSet', () => {
  test('publishes to both targets and reports the HAVING target on the chip', async () => {
    // The set warns once when a spec first emits to a `having` target.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const $having = Selection.intersect();
    const $members = Selection.intersect();
    const set = createFilterSet({
      targets: { having: $having, members: $members },
      defaultTarget: 'members',
      kinds: { threshold: thresholdKind() },
    });

    set.set(spec());

    expect(String($having.predicate(null))).toContain('max("weight") >= 85');
    expect(String($members.predicate(null))).toContain('"sport" IN (SELECT "sport"');
    expect(set.store.state.chips[0]).toMatchObject({
      target: 'having',
      formattedValue: '≥ 85',
    });

    set.remove('heavy');
    await waitFor(() => {
      expect($having.predicate(null)).toEqual([]);
      expect($members.predicate(null)).toEqual([]);
    });
    set.destroy();
    warn.mockRestore();
  });

  test('rebuilds the membership subquery when the context changes', async () => {
    const $having = Selection.intersect();
    const $members = Selection.intersect();
    const $context = Selection.intersect();
    const set = createFilterSet({
      targets: { having: $having, members: $members },
      kinds: { threshold: thresholdKind() },
      context: $context,
    });

    set.set(spec());
    expect(String($members.predicate(null))).not.toContain('WHERE');

    const sibling = { id: 'sibling' };
    $context.update({
      source: sibling,
      value: 60,
      fields: [],
      predicate: gt(column('weight'), literal(60)),
    });

    await waitFor(() => {
      expect(String($members.predicate(null))).toContain('WHERE ("weight" > 60)');
    });
    set.destroy();
  });
});

describe('aggregateThresholdFilterKind on DuckDB', () => {
  test('HAVING keeps the passing groups; members keeps their rows', async () => {
    const db = await createAthletesDb();
    // swim: max 90, count 4. run: max 65, count 2.
    const [having, members] = emit(thresholdKind(), spec({ operator: 'gte', value: 85 }));

    const groups = await db.coordinator.query(
      Query.from('athletes')
        .select({ sport: column('sport'), heaviest: max('weight') })
        .groupby('sport')
        .having(having?.predicate ?? []),
    );
    expect(groups.toArray().map((row) => row.sport as string)).toEqual(['swim']);

    const rows = await db.coordinator.query(
      Query.from('athletes')
        .select('name')
        .where(members?.predicate ?? [])
        .orderby('name'),
    );
    expect(rows.toArray().map((row) => row.name as string)).toEqual(['Ada', 'Bo', 'Cy', 'Di']);
  });

  test('the context predicate scopes the aggregate inside the subquery', async () => {
    const db = await createAthletesDb();
    // Under `weight < 70`, swim keeps Ada (60) only → count 1; run keeps both.
    const [, members] = emit(
      thresholdKind({ aggregate: () => count() }),
      spec({ operator: 'gt', value: 1 }),
      gt(literal(70), column('weight')),
    );

    const rows = await db.coordinator.query(
      Query.from('athletes')
        .select('name')
        .where(members?.predicate ?? [])
        .orderby('name'),
    );
    expect(rows.toArray().map((row) => row.name as string)).toEqual(['Ed', 'Fi']);
  });
});
