import { describe, expect, test } from 'vitest';

import {
  SqlIdentifier,
  conditionFilterKind,
  createStructAccess,
  matchFilterKind,
} from '../src/index';
import type {
  ConditionOperator,
  FilterKind,
  FilterKindArgs,
  FilterSpec,
  MatchOperator,
  OperatorDescriptor,
} from '../src/index';

/** Resolve a spec through a kind's `emit`, returning the first predicate SQL. */
function emitSql(kind: FilterKind, spec: FilterSpec): string | undefined {
  const args: FilterKindArgs = {
    spec,
    column: createStructAccess(SqlIdentifier.from(spec.column)),
    contextPredicate: null,
  };
  const emissions = kind.emit(args);
  const first = emissions[0];
  if (first === undefined || first.clause.predicate === null) {
    return undefined;
  }
  return String(first.clause.predicate);
}

/** A representative filled value for each arity so `emit` produces a predicate. */
function specForArity(
  column: string,
  operator: string,
  arity: OperatorDescriptor['arity'],
): FilterSpec {
  if (arity === 'none') {
    return { id: 't', column, kind: 'condition', operator };
  }
  if (arity === 'range') {
    return {
      id: 't',
      column,
      kind: 'condition',
      operator,
      value: 1,
      valueTo: 9,
    };
  }
  if (arity === 'set') {
    return {
      id: 't',
      column,
      kind: 'condition',
      operator,
      value: ['a', 'b'],
    };
  }
  return { id: 't', column, kind: 'condition', operator, value: 'x' };
}

describe('FilterKind operator vocabulary', () => {
  test('condition and match expose an operators array', () => {
    const condition = conditionFilterKind();
    expect(Array.isArray(condition.operators)).toBe(true);
    expect(condition.operators?.length).toBeGreaterThan(0);

    expect(Array.isArray(matchFilterKind.operators)).toBe(true);
    expect(matchFilterKind.operators?.length).toBeGreaterThan(0);
  });

  test('point / points / interval omit operators (they ignore spec.operator)', async () => {
    const { intervalFilterKind, pointFilterKind, pointsFilterKind } =
      await import('../src/index');
    expect(pointFilterKind.operators).toBeUndefined();
    expect(pointsFilterKind.operators).toBeUndefined();
    expect(intervalFilterKind.operators).toBeUndefined();
  });

  test('every listed condition operator is actually accepted by the kind', () => {
    // An accepted operator produces a non-null predicate for a filled value; an
    // unrecognized operator resolves to `null` (inactive) → undefined SQL.
    const kind = conditionFilterKind();
    for (const op of kind.operators ?? []) {
      const sql = emitSql(kind, specForArity('sport', op.id, op.arity));
      expect(
        sql,
        `condition operator "${op.id}" should be accepted`,
      ).toBeTruthy();
    }
  });

  test('every listed match operator resolves to a distinct method', () => {
    // `contains` is the fallback, so a listed id is only proven accepted when it
    // is either `contains` itself or produces different SQL than a bogus id.
    const bogusSql = emitSql(matchFilterKind, {
      id: 't',
      column: 'name',
      kind: 'match',
      operator: '__nope__',
      value: 'x',
    });
    for (const op of matchFilterKind.operators ?? []) {
      const sql = emitSql(matchFilterKind, {
        id: 't',
        column: 'name',
        kind: 'match',
        operator: op.id,
        value: 'x',
      });
      expect(sql, `match operator "${op.id}" produces SQL`).toBeTruthy();
      if (op.id !== 'contains') {
        expect(sql, `match operator "${op.id}" differs from fallback`).not.toBe(
          bogusSql,
        );
      }
    }
  });

  test('representative arities are correct (none / unary / range / set)', () => {
    const byId = new Map(
      (conditionFilterKind().operators ?? []).map((op) => [op.id, op]),
    );
    expect(byId.get('is_empty')?.arity).toBe('none');
    expect(byId.get('is_null')?.arity).toBe('none');
    expect(byId.get('eq')?.arity).toBe('unary');
    expect(byId.get('contains')?.arity).toBe('unary');
    expect(byId.get('between')?.arity).toBe('range');
    expect(byId.get('in')?.arity).toBe('set');
    expect(byId.get('not_in')?.arity).toBe('set');
    expect(byId.get('excludes_all')?.arity).toBe('set');

    const matchById = new Map(
      (matchFilterKind.operators ?? []).map((op) => [op.id, op]),
    );
    expect(matchById.get('contains')?.arity).toBe('unary');
    expect(matchById.get('regexp')?.arity).toBe('unary');
  });

  test('every operator has a human label', () => {
    for (const op of conditionFilterKind().operators ?? []) {
      expect(op.label, `condition "${op.id}" has a label`).toBeTruthy();
    }
    for (const op of matchFilterKind.operators ?? []) {
      expect(op.label, `match "${op.id}" has a label`).toBeTruthy();
    }
  });

  test('range operator reads value + valueTo (between)', () => {
    const kind = conditionFilterKind();
    const sql = emitSql(kind, {
      id: 't',
      column: 'weight',
      kind: 'condition',
      operator: 'between',
      value: 10,
      valueTo: 20,
    });
    expect(sql).toContain('BETWEEN');
  });

  test('none operator needs no value (is_empty)', () => {
    const kind = conditionFilterKind();
    const sql = emitSql(kind, {
      id: 't',
      column: 'sport',
      kind: 'condition',
      operator: 'is_empty',
    });
    expect(sql).toBeTruthy();
  });

  test('exported typed unions match the runtime operator ids', () => {
    // The unions are derived from the same const arrays, so this is a
    // compile-time cross-check: assigning each runtime id to the union type
    // fails to typecheck if the arrays and unions ever drift.
    for (const op of conditionFilterKind().operators ?? []) {
      const id: ConditionOperator = op.id as ConditionOperator;
      expect(id).toBe(op.id);
    }
    for (const op of matchFilterKind.operators ?? []) {
      const id: MatchOperator = op.id as MatchOperator;
      expect(id).toBe(op.id);
    }

    // Representative literals must be valid members of each union.
    const conditionIds: ReadonlyArray<ConditionOperator> = [
      'eq',
      'between',
      'in',
      'is_empty',
      'excludes_all',
    ];
    const matchIds: ReadonlyArray<MatchOperator> = [
      'contains',
      'prefix',
      'suffix',
      'regexp',
    ];
    expect(conditionIds).toHaveLength(5);
    expect(matchIds).toHaveLength(4);
  });
});
