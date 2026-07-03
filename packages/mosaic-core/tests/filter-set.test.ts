import { Selection } from '@uwdata/mosaic-core';
import { Query, count, gt } from '@uwdata/mosaic-sql';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  conditionFilterKind,
  createFilterSet,
  createRowsClient,
  subqueryFilterKind,
} from '../src/index';
import type { FilterKind, FilterSpec, Persister } from '../src/index';
import { createAthletesDb, settle, waitFor } from './test-utils';
import type { TestDb } from './test-utils';

interface AthleteRow {
  id: number;
  name: string;
  sport: string;
  weight: number;
}

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

/** SQL of the (single) resolved clause on a Selection, or undefined. */
function predicateSql(sel: Selection, index = 0): string | undefined {
  const clause = sel._resolved[index];
  return clause?.predicate == null ? undefined : String(clause.predicate);
}

describe('built-in kinds → predicate SQL', () => {
  test('point: scalar value and null value', () => {
    const $where = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $where } });

    set.set({ id: 'p', column: 'sport', kind: 'point', value: 'swim' });
    expect(predicateSql($where)).toBe('("sport" IN (\'swim\'))');

    set.set({ id: 'p', column: 'sport', kind: 'point', value: null });
    expect(predicateSql($where)).toBe('("sport" IS NULL)');
    set.destroy();
  });

  test('point: struct-path column produces quoted segments', () => {
    const $where = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $where } });
    set.set({
      id: 'sp',
      column: 'payload.question',
      kind: 'point',
      value: 'why',
    });
    expect(predicateSql($where)).toBe('("payload"."question" IN (\'why\'))');
    set.destroy();
  });

  test('points: scalar array and multi-column tuple envelope', () => {
    const $a = Selection.crossfilter();
    const setA = createFilterSet({ targets: { where: $a } });
    setA.set({
      id: 'ps',
      column: 'sport',
      kind: 'points',
      value: ['swim', 'run'],
    });
    // A single-field points clause resolves to a scalar IN list.
    expect(predicateSql($a)).toContain("'swim'");
    expect(predicateSql($a)).toContain("'run'");
    setA.destroy();

    const $b = Selection.crossfilter();
    const setB = createFilterSet({ targets: { where: $b } });
    setB.set({
      id: 'pt',
      column: 'sport',
      kind: 'points',
      value: {
        columns: ['sport', 'weight'],
        tuples: [
          ['swim', 60],
          ['run', 55],
        ],
      },
    });
    const sql = predicateSql($b);
    expect(sql).toContain('"sport"');
    expect(sql).toContain('"weight"');
    setB.destroy();
  });

  test('interval: closed carries interval meta, half-open carries none', () => {
    const $where = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $where } });

    set.set({ id: 'iv', column: 'weight', kind: 'interval', value: [60, 80] });
    expect(predicateSql($where)).toBe('("weight" BETWEEN 60 AND 80)');
    expect($where._resolved[0]?.meta).toEqual({ type: 'interval' });

    // Half-open: only a lower bound → `>=`, no meta.
    set.set({
      id: 'iv',
      column: 'weight',
      kind: 'interval',
      value: 60,
      valueTo: null,
    });
    expect(predicateSql($where)).toBe('("weight" >= 60)');
    expect($where._resolved[0]?.meta).toBeUndefined();
    set.destroy();
  });

  test('match: contains and prefix methods', () => {
    const $where = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $where } });

    set.set({ id: 'm', column: 'name', kind: 'match', value: 'a' });
    expect(predicateSql($where)).toBe('contains(lower("name"), lower(\'a\'))');
    expect($where._resolved[0]?.meta).toEqual({
      type: 'match',
      method: 'contains',
    });

    set.set({
      id: 'm',
      column: 'name',
      kind: 'match',
      operator: 'prefix',
      value: 'A',
    });
    expect(predicateSql($where)).toBe(
      'starts_with(lower("name"), lower(\'A\'))',
    );
    set.destroy();
  });

  describe('condition operator matrix', () => {
    const cases: Array<{
      name: string;
      spec: Omit<FilterSpec, 'id' | 'kind'>;
      expected: string;
      arrayKind?: boolean;
    }> = [
      {
        name: 'eq',
        spec: { column: 'name', operator: 'eq', value: 'Ada' },
        expected: '("name" = \'Ada\')',
      },
      {
        name: 'neq',
        spec: { column: 'name', operator: 'neq', value: 'Ada' },
        expected: '"name" != \'Ada\'',
      },
      {
        name: 'gt (numeric coercion)',
        spec: { column: 'weight', operator: 'gt', value: 70 },
        expected: '(TRY_CAST("weight" AS DOUBLE) > 70)',
      },
      {
        name: 'between half-open (from only)',
        spec: { column: 'weight', operator: 'between', value: 70 },
        expected: '(TRY_CAST("weight" AS DOUBLE) >= 70)',
      },
      {
        name: 'in',
        spec: { column: 'sport', operator: 'in', value: ['swim', 'run'] },
        expected: "\"sport\" IN ('swim', 'run')",
      },
      {
        name: 'not_in',
        spec: { column: 'sport', operator: 'not_in', value: ['swim'] },
        expected: '"sport" NOT IN (\'swim\')',
      },
      {
        name: 'contains',
        spec: { column: 'name', operator: 'contains', value: 'd' },
        expected: "\"name\" ILIKE '%d%' ESCAPE '\\'",
      },
      {
        name: 'starts_with',
        spec: { column: 'name', operator: 'starts_with', value: 'A' },
        expected: "\"name\" ILIKE 'A%' ESCAPE '\\'",
      },
      {
        name: 'is_null',
        spec: { column: 'name', operator: 'is_null' },
        expected: '"name" IS NULL',
      },
    ];

    for (const c of cases) {
      test(c.name, () => {
        const $where = Selection.crossfilter();
        const set = createFilterSet({ targets: { where: $where } });
        set.set({ id: 'c', kind: 'condition', ...c.spec });
        expect(predicateSql($where)).toContain(c.expected);
        set.destroy();
      });
    }

    test('list_has_any via conditionFilterKind({columnType:array})', () => {
      const $where = Selection.crossfilter();
      const set = createFilterSet({
        targets: { where: $where },
        kinds: { conditionArray: conditionFilterKind({ columnType: 'array' }) },
      });
      set.set({
        id: 'la',
        column: 'tags',
        kind: 'conditionArray',
        operator: 'list_has_any',
        value: ['x', 'y'],
      });
      expect(predicateSql($where)).toContain(
        "list_has_any(\"tags\", ['x', 'y'])",
      );
      set.destroy();
    });
  });
});

describe('multi-clause kind → two targets', () => {
  test('a custom kind emits one clause on each Selection with the spec sources', () => {
    const $where = Selection.crossfilter();
    const $having = Selection.crossfilter();
    const twoTarget: FilterKind = {
      emit: (args) => [
        {
          target: 'where',
          clause: {
            predicate: gt(args.column, { toString: () => '0' } as never),
          },
        },
        {
          target: 'having',
          clause: {
            predicate: gt(args.column, { toString: () => '1' } as never),
          },
        },
      ],
    };
    const set = createFilterSet({
      targets: { where: $where, having: $having },
      kinds: { twoTarget },
    });
    set.set({ id: 'two', column: 'weight', kind: 'twoTarget', value: 1 });

    expect($where._resolved).toHaveLength(1);
    expect($having._resolved).toHaveLength(1);
    const whereSource = $where._resolved[0]?.source as {
      id?: string;
      target?: string;
    };
    const havingSource = $having._resolved[0]?.source as {
      id?: string;
      target?: string;
    };
    expect(whereSource.id).toBe('two');
    expect(whereSource.target).toBe('where');
    expect(havingSource.id).toBe('two');
    expect(havingSource.target).toBe('having');
    set.destroy();
  });

  test('two specs same column different targets coexist and filter a grouped rows client', async () => {
    const $where = Selection.crossfilter();
    const $having = Selection.crossfilter();
    const set = createFilterSet({
      targets: { where: $where, having: $having },
    });

    // WHERE: only swimmers. HAVING: groups whose count > 1.
    set.set({
      id: 'w',
      column: 'sport',
      kind: 'point',
      value: 'swim',
      target: 'where',
    });
    set.set({
      id: 'h',
      column: 'cnt',
      kind: 'condition',
      operator: 'gt',
      value: 1,
      target: 'having',
    });

    const rows = createRowsClient<{ sport: string; cnt: number }>({
      coordinator: db.coordinator,
      query: ({ where, having }) =>
        Query.from('athletes')
          .select({ sport: 'sport', cnt: count() })
          .where(where)
          .groupby('sport')
          .having(having),
      filterBy: $where,
      havingBy: $having,
      inputs: { orderBy: [{ column: 'sport' }] },
    });

    await waitFor(() => {
      expect(rows.store.state.status).toBe('success');
      // Only the 'swim' group survives WHERE and its count (4) > 1.
      expect(rows.store.state.rows.map((r) => r.sport)).toEqual(['swim']);
      expect(Number(rows.store.state.rows[0]?.cnt)).toBe(4);
    });
    rows.destroy();
    set.destroy();
  });
});

describe('replace / remove / clear / reset', () => {
  test('replace keeps one clause + same source; remove clears; clear retains spec', () => {
    const $where = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $where } });

    set.set({ id: 'p', column: 'sport', kind: 'point', value: 'swim' });
    expect($where._resolved).toHaveLength(1);
    const source = $where._resolved[0]?.source;

    set.set({ id: 'p', column: 'sport', kind: 'point', value: 'run' });
    expect($where._resolved).toHaveLength(1);
    expect($where._resolved[0]?.source).toBe(source);
    expect(predicateSql($where)).toBe('("sport" IN (\'run\'))');

    // clear retains the spec (chip present) but clears the clause.
    set.clear('p');
    expect($where._resolved).toHaveLength(0);
    expect(set.store.state.specs.map((s) => s.id)).toEqual(['p']);
    expect(set.store.state.chips).toHaveLength(1);

    // remove drops the spec entirely.
    set.set({ id: 'p', column: 'sport', kind: 'point', value: 'swim' });
    set.remove('p');
    expect($where._resolved).toHaveLength(0);
    expect(set.store.state.specs).toHaveLength(0);
    set.destroy();
  });

  test('reset clears all clauses with a single (null, clear) persist write', () => {
    const $where = Selection.crossfilter();
    const writes: Array<{ state: unknown; reason: string }> = [];
    const persister: Persister<Array<FilterSpec>> = {
      read: () => null,
      write: (state, ctx) => writes.push({ state, reason: ctx.reason }),
    };
    const set = createFilterSet({
      targets: { where: $where },
      persist: persister,
    });

    set.set({ id: 'a', column: 'sport', kind: 'point', value: 'swim' });
    set.set({ id: 'b', column: 'name', kind: 'match', value: 'a' });
    writes.length = 0;

    set.reset();
    expect($where._resolved).toHaveLength(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({ state: null, reason: 'clear' });
    set.destroy();
  });
});

describe('external clear mirroring', () => {
  test('an external actor dropping the clause removes the spec with one external write', async () => {
    const $where = Selection.crossfilter();
    const writes: Array<{ state: unknown; reason: string }> = [];
    const persister: Persister<Array<FilterSpec>> = {
      read: () => null,
      write: (state, ctx) => writes.push({ state, reason: ctx.reason }),
    };
    const set = createFilterSet({
      targets: { where: $where },
      persist: persister,
    });

    set.set({ id: 'p', column: 'sport', kind: 'point', value: 'swim' });
    writes.length = 0;

    // Another actor resets the Selection (chip-bar "clear all").
    $where.reset();

    await waitFor(() => {
      expect(set.store.state.specs).toHaveLength(0);
    });
    const external = writes.filter((w) => w.reason === 'external');
    expect(external).toHaveLength(1);
    expect(external[0]?.state).toBeNull();
    set.destroy();
  });
});

describe('subquery context rebuild', () => {
  test('a context change republishes the subquery clause; converged republish does not loop', async () => {
    const $where = Selection.crossfilter();
    const $context = Selection.crossfilter();

    // Membership query embedding the sibling context predicate.
    const membership = subqueryFilterKind((args) => {
      const q = Query.from('athletes').select('id');
      const ctx = args.contextPredicate;
      if (ctx != null) {
        q.where(ctx);
      }
      return q;
    });

    const set = createFilterSet({
      targets: { where: $where },
      kinds: { membership },
      context: $context,
    });
    set.set({ id: 'sq', column: 'id', kind: 'membership', value: null });

    const before = predicateSql($where);
    expect(before).toContain('IN (SELECT');

    const siblingClause = {
      source: { id: 'sibling' },
      value: 70,
      predicate: gt(
        { toString: () => '"weight"' } as never,
        { toString: () => '70' } as never,
      ),
    };

    // Context gains a sibling clause → the subquery must rebuild with new SQL.
    $context.update(siblingClause);

    await waitFor(() => {
      const after = predicateSql($where);
      expect(after).not.toBe(before);
      expect(after).toContain('"weight"');
    });
    // Specs are unchanged by a context rebuild.
    expect(set.store.state.specs.map((s) => s.id)).toEqual(['sq']);

    // Settle fully, then track update count on the target across a converged
    // (identical) context re-dispatch.
    await settle();
    let updates = 0;
    const listener = (): void => {
      updates += 1;
    };
    $where.addEventListener('value', listener);

    // Re-dispatch an unchanged context: the rebuild converges to the same
    // predicate and publishes nothing further (updateClauseIfChanged suppresses).
    $context.update({ ...siblingClause });
    await settle();
    expect(updates).toBe(0);

    $where.removeEventListener('value', listener);
    set.destroy();
  });
});

describe('persistence round-trip', () => {
  const specs: Array<FilterSpec> = [
    { id: 'p', column: 'sport', kind: 'point', value: 'swim' },
    { id: 'ps', column: 'sport', kind: 'points', value: ['swim', 'run'] },
    { id: 'iv', column: 'weight', kind: 'interval', value: [60, 80] },
    { id: 'm', column: 'name', kind: 'match', value: 'a' },
    { id: 'c', column: 'weight', kind: 'condition', operator: 'gt', value: 70 },
  ];

  test('a second set hydrated from persisted state reproduces identical SQL with zero write calls', () => {
    const $where1 = Selection.crossfilter();
    const set1 = createFilterSet({ targets: { where: $where1 } });
    for (const spec of specs) {
      set1.set(spec);
    }
    const sql1 = $where1._resolved.map((c) => String(c.predicate)).sort();

    const persisted = JSON.parse(
      JSON.stringify(set1.store.state.specs),
    ) as Array<FilterSpec>;
    set1.destroy();

    const $where2 = Selection.crossfilter();
    let writeCount = 0;
    const persister: Persister<Array<FilterSpec>> = {
      read: () => persisted,
      write: () => {
        writeCount += 1;
      },
    };
    const set2 = createFilterSet({
      targets: { where: $where2 },
      persist: persister,
    });

    const sql2 = $where2._resolved.map((c) => String(c.predicate)).sort();
    expect(sql2).toEqual(sql1);
    // Hydration must not write back.
    expect(writeCount).toBe(0);
    set2.destroy();

    // Double-hydration (recreate against the same persister) also writes zero.
    const $where3 = Selection.crossfilter();
    const set3 = createFilterSet({
      targets: { where: $where3 },
      persist: persister,
    });
    expect(writeCount).toBe(0);
    set3.destroy();
    expect(writeCount).toBe(0);
  });
});

describe('serializability guard', () => {
  test('JSON round-tripped specs reproduce identical SQL for every built-in kind', () => {
    const specs: Array<FilterSpec> = [
      { id: 'p', column: 'sport', kind: 'point', value: 'swim' },
      { id: 'ps', column: 'sport', kind: 'points', value: ['swim', 'run'] },
      { id: 'iv', column: 'weight', kind: 'interval', value: [60, 80] },
      { id: 'm', column: 'name', kind: 'match', value: 'a' },
      {
        id: 'c',
        column: 'weight',
        kind: 'condition',
        operator: 'gt',
        value: 70,
      },
    ];

    const $a = Selection.crossfilter();
    const setA = createFilterSet({ targets: { where: $a } });
    for (const spec of specs) {
      setA.set(spec);
    }
    const sqlA = $a._resolved.map((c) => String(c.predicate)).sort();
    setA.destroy();

    const roundTripped = JSON.parse(JSON.stringify(specs)) as Array<FilterSpec>;
    const $b = Selection.crossfilter();
    const setB = createFilterSet({ targets: { where: $b } });
    for (const spec of roundTripped) {
      setB.set(spec);
    }
    const sqlB = $b._resolved.map((c) => String(c.predicate)).sort();
    expect(sqlB).toEqual(sqlA);
    setB.destroy();
  });
});

describe('dev warnings', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  test('having-target warns exactly once across two publishes', () => {
    const $where = Selection.crossfilter();
    const $having = Selection.crossfilter();
    const set = createFilterSet({
      targets: { where: $where, having: $having },
    });

    set.set({
      id: 'h1',
      column: 'cnt',
      kind: 'condition',
      operator: 'gt',
      value: 1,
      target: 'having',
    });
    set.set({
      id: 'h2',
      column: 'cnt',
      kind: 'condition',
      operator: 'gt',
      value: 2,
      target: 'having',
    });

    const havingWarnings = warn.mock.calls.filter((call: Array<unknown>) =>
      String(call[0]).includes("'having'-targeted"),
    );
    expect(havingWarnings).toHaveLength(1);
    set.destroy();
  });

  test('unknown kind throws; unknown target warns and skips', () => {
    const $where = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $where } });

    expect(() =>
      set.set({ id: 'x', column: 'sport', kind: 'nope', value: 'swim' }),
    ).toThrow(/unknown kind/);

    // An emission addressed to a target with no Selection is skipped + warned.
    const stray: FilterKind = {
      emit: (args) => [
        {
          target: 'nowhere',
          clause: {
            predicate: gt(args.column, { toString: () => '0' } as never),
          },
        },
      ],
    };
    const set2 = createFilterSet({
      targets: { where: $where },
      kinds: { stray },
    });
    set2.set({ id: 's', column: 'weight', kind: 'stray', value: 1 });
    expect($where._resolved).toHaveLength(0);
    const targetWarnings = warn.mock.calls.filter((call: Array<unknown>) =>
      String(call[0]).includes('unknown target'),
    );
    expect(targetWarnings).toHaveLength(1);
    set.destroy();
    set2.destroy();
  });
});
