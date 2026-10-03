/**
 * Tests for {@link emitFilterSpec} / {@link filterSpecPredicate}: the pure
 * spec → clause resolution FilterSet publishes through. The load-bearing
 * property is parity — what these functions compute is exactly what the set
 * publishes for the same spec.
 */
import { Selection } from '@uwdata/mosaic-core';
import type { SelectionClause } from '@uwdata/mosaic-core';
import { Query, gt, literal } from '@uwdata/mosaic-sql';
import type { ExprNode } from '@uwdata/mosaic-sql';
import { describe, expect, test, vi } from 'vitest';

import {
  conditionFilterKind,
  createFilterSet,
  emitFilterSpec,
  filterSpecPredicate,
  subqueryFilterKind,
} from '../src/index';
import type { FilterKind, FilterSpec } from '../src/index';

function sql(node: ExprNode | null | undefined): string | null {
  return node == null ? null : String(node);
}

/** A kind emitting a WHERE clause and a HAVING clause (fields: []). */
const twoTarget: FilterKind = {
  emit: (args) => [
    {
      target: 'having',
      clause: { predicate: gt(literal(1), literal(0)), fields: [] },
    },
    {
      target: 'where',
      clause: { predicate: gt(args.column, literal(args.spec.value)), value: 'v' },
    },
  ],
};

const PARITY_SPECS: Array<FilterSpec> = [
  { id: 'point', column: 'sport', kind: 'point', value: 'swim' },
  { id: 'point-null', column: 'sport', kind: 'point', value: null },
  { id: 'points', column: 'sport', kind: 'points', value: ['swim', 'run'] },
  {
    id: 'tuples',
    column: 'sport',
    kind: 'points',
    value: {
      columns: ['sport', 'weight'],
      tuples: [
        ['swim', 60],
        ['run', 55],
      ],
    },
  },
  { id: 'interval', column: 'weight', kind: 'interval', value: [50, 70] },
  { id: 'half-open', column: 'weight', kind: 'interval', value: 50 },
  { id: 'match', column: 'name', kind: 'match', operator: 'prefix', value: 'A' },
  { id: 'between', column: 'weight', kind: 'condition', operator: 'between', value: 1, valueTo: 9 },
  { id: 'in', column: 'sport', kind: 'condition', operator: 'in', value: ['swim'] },
  { id: 'struct', column: 'payload.question', kind: 'point', value: 'why' },
  {
    id: 'literal',
    column: 'meta.country',
    columnPaths: 'literal',
    kind: 'point',
    value: 'NZ',
  },
  { id: 'tags', column: 'tags', kind: 'tags', value: ['a', 'b'] },
  { id: 'two', column: 'weight', kind: 'twoTarget', value: 3 },
];

describe('emitFilterSpec ↔ FilterSet parity', () => {
  test.each(PARITY_SPECS)('$id: the computed clauses equal the published ones', (spec) => {
    const $where = Selection.crossfilter();
    const $having = Selection.intersect();
    const kinds = { tags: conditionFilterKind({ columnType: 'array' }), twoTarget };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const set = createFilterSet({ targets: { where: $where, having: $having }, kinds });

    set.set(spec);
    const emissions = emitFilterSpec(spec, { kinds: set.kinds });

    const published: Record<string, SelectionClause | undefined> = {
      where: $where._resolved[0],
      having: $having._resolved[0],
    };
    expect(emissions.length).toBeGreaterThan(0);
    for (const emission of emissions) {
      const clause = published[emission.target];
      expect(clause).toBeDefined();
      expect(sql(emission.predicate)).toBe(sql(clause?.predicate));
      expect(emission.value).toEqual(clause?.value);
      expect(emission.meta).toEqual(clause?.meta);
      expect(emission.fields.map((field) => String(field))).toEqual(
        (clause?.fields ?? []).map((field) => String(field)),
      );
    }
    // Every published clause is accounted for by an emission.
    const publishedTargets = Object.entries(published)
      .filter(([, clause]) => clause !== undefined)
      .map(([target]) => target);
    expect(emissions.map((emission) => emission.target).sort()).toEqual(publishedTargets.sort());

    warn.mockRestore();
    set.destroy();
  });
});

describe('emitFilterSpec', () => {
  test('applies the set defaults: target, value and fields', () => {
    const [emission, ...rest] = emitFilterSpec({
      id: 'p',
      column: 'sport',
      kind: 'point',
      value: 'swim',
    });
    expect(rest).toHaveLength(0);
    expect(emission?.target).toBe('where');
    expect(sql(emission?.predicate)).toBe('("sport" IN (\'swim\'))');
    expect(emission?.value).toBe('swim');
    expect(emission?.fields.map((field) => String(field))).toEqual(['"sport"']);
    expect(emission?.meta).toEqual({ type: 'point' });
  });

  test('resolves targets as emission.target ?? spec.target ?? defaultTarget', () => {
    const spec: FilterSpec = { id: 'p', column: 'sport', kind: 'point', value: 'swim' };
    expect(emitFilterSpec(spec)[0]?.target).toBe('where');
    expect(emitFilterSpec(spec, { defaultTarget: 'members' })[0]?.target).toBe('members');
    expect(
      emitFilterSpec({ ...spec, target: 'scope' }, { defaultTarget: 'members' })[0]?.target,
    ).toBe('scope');
    const emissions = emitFilterSpec(
      { id: 't', column: 'weight', kind: 'twoTarget', value: 3, target: 'scope' },
      { kinds: { twoTarget } },
    );
    expect(emissions.map((emission) => emission.target)).toEqual(['having', 'where']);
  });

  test('reads a dotted column as one identifier under columnPaths: literal', () => {
    const spec: FilterSpec = { id: 'c', column: 'meta.country', kind: 'point', value: 'NZ' };
    const [structEmission] = emitFilterSpec(spec);
    const [literalEmission] = emitFilterSpec({ ...spec, columnPaths: 'literal' });
    expect(structEmission?.fields.map((field) => String(field))).toEqual(['"meta"."country"']);
    expect(literalEmission?.fields.map((field) => String(field))).toEqual(['"meta.country"']);
    expect(sql(literalEmission?.predicate)).toBe('("meta.country" IN (\'NZ\'))');
  });

  test('omits meta for predicates that carry none and defaults fields to the column', () => {
    const [emission] = emitFilterSpec({
      id: 'c',
      column: 'weight',
      kind: 'condition',
      operator: 'gt',
      value: 60,
    });
    expect(emission).toBeDefined();
    expect(emission !== undefined && 'meta' in emission).toBe(false);
    expect(emission?.fields.map((field) => String(field))).toEqual(['"weight"']);
  });

  test('groups emissions by target: last wins, first position kept', () => {
    const repeated: FilterKind = {
      emit: () => [
        { target: 'a', clause: { predicate: literal(1), fields: [] } },
        { target: 'b', clause: { predicate: literal(2), fields: [] } },
        { target: 'a', clause: { predicate: literal(3), fields: [] } },
      ],
    };
    const emissions = emitFilterSpec(
      { id: 'r', column: 'x', kind: 'repeated' },
      { kinds: { repeated } },
    );
    expect(emissions.map((emission) => [emission.target, sql(emission.predicate)])).toEqual([
      ['a', '3'],
      ['b', '2'],
    ]);
  });

  test('an inactive spec yields no emissions, or null-predicate emissions', () => {
    expect(emitFilterSpec({ id: 'p', column: 'sport', kind: 'point' })).toEqual([]);
    const inactive: FilterKind = {
      emit: () => [{ target: 'where', clause: { predicate: null } }],
    };
    const emissions = emitFilterSpec(
      { id: 'i', column: 'sport', kind: 'inactive', value: 'x' },
      { kinds: { inactive } },
    );
    expect(emissions).toHaveLength(1);
    expect(emissions[0]?.predicate).toBeNull();
    expect(emissions[0]?.value).toBe('x');
  });

  test('returns emissions to targets no set declares (no warnings here)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const emissions = emitFilterSpec({
      id: 'p',
      column: 'sport',
      kind: 'point',
      value: 'swim',
      target: 'nowhere',
    });
    expect(emissions[0]?.target).toBe('nowhere');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('hands contextPredicate to the kind (null by default)', () => {
    const membership = subqueryFilterKind((args) => {
      const query = Query.from('athletes').select('id');
      if (args.contextPredicate != null) {
        query.where(args.contextPredicate);
      }
      return query;
    });
    const spec: FilterSpec = { id: 's', column: 'id', kind: 'membership', value: null };

    const withoutContext = sql(emitFilterSpec(spec, { kinds: { membership } })[0]?.predicate);
    expect(withoutContext).toContain('IN (SELECT');
    expect(withoutContext).not.toContain('WHERE');

    const withContext = sql(
      emitFilterSpec(spec, {
        kinds: { membership },
        contextPredicate: gt('weight', literal(70)),
      })[0]?.predicate,
    );
    expect(withContext).toContain('WHERE');
    expect(withContext).toContain('"weight"');
  });

  test('custom kinds merge over the built-ins; unknown kinds throw', () => {
    const spec: FilterSpec = { id: 'p', column: 'sport', kind: 'point', value: 'swim' };
    // Built-ins remain available alongside custom kinds.
    expect(emitFilterSpec(spec, { kinds: { twoTarget } })).toHaveLength(1);
    expect(() => emitFilterSpec({ ...spec, kind: 'nope' })).toThrow(
      /emitFilterSpec received an unknown kind 'nope'/,
    );
  });

  test('is pure: it never touches a set or its targets', () => {
    const $where = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $where } });
    emitFilterSpec(
      { id: 'p', column: 'sport', kind: 'point', value: 'swim' },
      { kinds: set.kinds, defaultTarget: set.defaultTarget },
    );
    expect($where._resolved).toHaveLength(0);
    expect(set.store.state.specs).toHaveLength(0);
    set.destroy();
  });
});

describe('filterSpecPredicate', () => {
  test('returns the predicate for a named target, or null', () => {
    const spec: FilterSpec = { id: 't', column: 'weight', kind: 'twoTarget', value: 3 };
    expect(sql(filterSpecPredicate(spec, { kinds: { twoTarget }, target: 'where' }))).toBe(
      '("weight" > 3)',
    );
    expect(sql(filterSpecPredicate(spec, { kinds: { twoTarget }, target: 'having' }))).toBe(
      '(1 > 0)',
    );
    expect(filterSpecPredicate(spec, { kinds: { twoTarget }, target: 'scope' })).toBeNull();
  });

  test('defaults to the primary target: the first active emission', () => {
    const laterActive: FilterKind = {
      emit: () => [
        { target: 'a', clause: { predicate: null } },
        { target: 'b', clause: { predicate: literal(2), fields: [] } },
        { target: 'c', clause: { predicate: literal(3), fields: [] } },
      ],
    };
    const predicate = filterSpecPredicate(
      { id: 'l', column: 'x', kind: 'laterActive' },
      { kinds: { laterActive } },
    );
    expect(sql(predicate)).toBe('2');
  });

  test('matches the published primary target reported on the chip', () => {
    const $where = Selection.crossfilter();
    const $having = Selection.intersect();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const set = createFilterSet({
      targets: { where: $where, having: $having },
      kinds: { twoTarget },
    });
    const spec: FilterSpec = { id: 't', column: 'weight', kind: 'twoTarget', value: 3 };
    set.set(spec);

    const chipTarget = set.store.state.chips[0]?.target;
    expect(chipTarget).toBe('having');
    expect(sql(filterSpecPredicate(spec, { kinds: set.kinds }))).toBe(
      sql($having._resolved[0]?.predicate),
    );
    warn.mockRestore();
    set.destroy();
  });

  test('an inactive spec has no predicate', () => {
    expect(filterSpecPredicate({ id: 'p', column: 'sport', kind: 'point' })).toBeNull();
  });
});
