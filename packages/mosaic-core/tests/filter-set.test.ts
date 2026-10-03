import { createAthletesDb, settle, waitFor } from '@nozzleio/test-support/duckdb';
import type { TestDb } from '@nozzleio/test-support/duckdb';
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
    expect(predicateSql($where)).toBe('starts_with(lower("name"), lower(\'A\'))');
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
      expect(predicateSql($where)).toContain("list_has_any(\"tags\", ['x', 'y'])");
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

describe('reset({ keep })', () => {
  function recordingPersister(): {
    persister: Persister<Array<FilterSpec>>;
    writes: Array<{ state: Array<FilterSpec> | null; reason: string }>;
  } {
    const writes: Array<{ state: Array<FilterSpec> | null; reason: string }> = [];
    return {
      writes,
      persister: {
        read: () => null,
        write: (state, ctx) => writes.push({ state, reason: ctx.reason }),
      },
    };
  }

  test('keeps accepted specs untouched and removes the rest with one store sync + one write', () => {
    const $where = Selection.crossfilter();
    const $members = Selection.crossfilter();
    const { persister, writes } = recordingPersister();
    const set = createFilterSet({
      targets: { where: $where, members: $members },
      persist: persister,
    });

    set.set({ id: 'pinned', column: 'sport', kind: 'point', value: 'swim', target: 'members' });
    set.set({ id: 'a', column: 'name', kind: 'match', value: 'a' });
    set.set({ id: 'b', column: 'weight', kind: 'condition', operator: 'gt', value: 60 });
    const pinnedClause = $members._resolved[0];
    expect(pinnedClause).toBeDefined();
    writes.length = 0;

    let storeSyncs = 0;
    const subscription = set.store.subscribe(() => {
      storeSyncs += 1;
    });
    let membersUpdates = 0;
    const onMembers = (): void => {
      membersUpdates += 1;
    };
    $members.addEventListener('value', onMembers);

    set.reset({ keep: (spec) => spec.id === 'pinned' });

    // Removed specs' clauses are cleared; the kept one is never re-published.
    expect($where._resolved).toHaveLength(0);
    expect($members._resolved).toHaveLength(1);
    expect($members._resolved[0]).toBe(pinnedClause);
    expect(membersUpdates).toBe(0);
    expect(set.store.state.specs.map((spec) => spec.id)).toEqual(['pinned']);
    expect(set.store.state.chips.map((chip) => chip.id)).toEqual(['pinned']);
    expect(storeSyncs).toBe(1);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.reason).toBe('update');
    expect(writes[0]?.state?.map((spec) => spec.id)).toEqual(['pinned']);

    // The kept spec is still fully managed afterwards.
    set.remove('pinned');
    expect($members._resolved).toHaveLength(0);

    $members.removeEventListener('value', onMembers);
    subscription.unsubscribe();
    set.destroy();
  });

  test('a keep that accepts nothing behaves like reset(): one (null, clear) write', () => {
    const $where = Selection.crossfilter();
    const { persister, writes } = recordingPersister();
    const set = createFilterSet({ targets: { where: $where }, persist: persister });

    set.set({ id: 'a', column: 'sport', kind: 'point', value: 'swim' });
    set.set({ id: 'b', column: 'name', kind: 'match', value: 'a' });
    writes.length = 0;

    set.reset({ keep: () => false });

    expect($where._resolved).toHaveLength(0);
    expect(set.store.state.specs).toHaveLength(0);
    expect(writes).toEqual([{ state: null, reason: 'clear' }]);
    set.destroy();
  });

  test('a keep that accepts every spec is a no-op (no store sync, no write)', () => {
    const $where = Selection.crossfilter();
    const { persister, writes } = recordingPersister();
    const set = createFilterSet({ targets: { where: $where }, persist: persister });

    set.set({ id: 'a', column: 'sport', kind: 'point', value: 'swim' });
    writes.length = 0;
    let storeSyncs = 0;
    const subscription = set.store.subscribe(() => {
      storeSyncs += 1;
    });

    set.reset({ keep: () => true });

    expect($where._resolved).toHaveLength(1);
    expect(set.store.state.specs.map((spec) => spec.id)).toEqual(['a']);
    expect(storeSyncs).toBe(0);
    expect(writes).toHaveLength(0);
    subscription.unsubscribe();
    set.destroy();
  });

  test('keep sees every spec before anything is removed', () => {
    const $where = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $where } });
    set.set({ id: 'a', column: 'sport', kind: 'point', value: 'swim' });
    set.set({ id: 'b', column: 'name', kind: 'match', value: 'a' });

    const seen: Array<{ id: string; specCount: number }> = [];
    set.reset({
      keep: (spec) => {
        seen.push({ id: spec.id, specCount: set.store.state.specs.length });
        return false;
      },
    });

    expect(seen).toEqual([
      { id: 'a', specCount: 2 },
      { id: 'b', specCount: 2 },
    ]);
    set.destroy();
  });

  test('removing specs shared on one target does not trip external-clear on the kept spec', async () => {
    const $where = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $where } });
    set.set({ id: 'keep', column: 'sport', kind: 'point', value: 'swim' });
    set.set({ id: 'drop', column: 'name', kind: 'match', value: 'a' });

    set.reset({ keep: (spec) => spec.id === 'keep' });
    await settle();

    expect(set.store.state.specs.map((spec) => spec.id)).toEqual(['keep']);
    expect($where._resolved).toHaveLength(1);
    expect(predicateSql($where)).toBe('("sport" IN (\'swim\'))');
    set.destroy();
  });

  test('a destroyed set ignores reset({ keep })', () => {
    const $where = Selection.crossfilter();
    const keep = vi.fn(() => false);
    const set = createFilterSet({ targets: { where: $where } });
    set.set({ id: 'a', column: 'sport', kind: 'point', value: 'swim' });
    set.destroy({ silent: true });

    set.reset({ keep });

    expect(keep).not.toHaveBeenCalled();
    expect($where._resolved).toHaveLength(1);
  });
});

describe('defaultTarget', () => {
  test("defaults to 'where'", () => {
    const set = createFilterSet({ targets: { where: Selection.crossfilter() } });
    expect(set.defaultTarget).toBe('where');
    set.destroy();
  });

  test('routes target-less specs to the default target without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const $members = Selection.crossfilter();
    const $having = Selection.intersect();
    const set = createFilterSet({
      targets: { members: $members, having: $having },
      defaultTarget: 'members',
    });

    set.set({ id: 'p', column: 'sport', kind: 'point', value: 'swim' });

    expect(set.defaultTarget).toBe('members');
    expect(predicateSql($members)).toBe('("sport" IN (\'swim\'))');
    expect($having._resolved).toHaveLength(0);
    expect(set.store.state.chips[0]?.target).toBe('members');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    set.destroy();
  });

  test('an explicit defaultTarget that names no target throws', () => {
    expect(() =>
      createFilterSet({
        targets: { members: Selection.crossfilter() },
        defaultTarget: 'member',
      }),
    ).toThrow(/defaultTarget 'member' is not one of its targets \(members\)/);
  });

  test("the implicit 'where' default is not validated at construction", () => {
    const set = createFilterSet({ targets: { members: Selection.crossfilter() } });
    expect(set.defaultTarget).toBe('where');
    set.destroy();
  });

  test('an inactive spec reports the default target on its chip', () => {
    const set = createFilterSet({
      targets: { members: Selection.crossfilter() },
      defaultTarget: 'members',
    });
    set.set({ id: 'p', column: 'sport', kind: 'point' });
    expect(set.store.state.chips[0]?.target).toBe('members');
    set.destroy();
  });

  test('spec.target and emission.target still take precedence', () => {
    const $where = Selection.crossfilter();
    const $members = Selection.crossfilter();
    const $having = Selection.intersect();
    const selfRouting: FilterKind = {
      emit: (args) => [
        {
          target: 'having',
          clause: { predicate: gt(args.column, { toString: () => '1' } as never) },
        },
      ],
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const set = createFilterSet({
      targets: { where: $where, members: $members, having: $having },
      defaultTarget: 'members',
      kinds: { selfRouting },
    });

    set.set({ id: 'w', column: 'sport', kind: 'point', value: 'swim', target: 'where' });
    set.set({ id: 'h', column: 'weight', kind: 'selfRouting', value: 1 });

    expect($where._resolved).toHaveLength(1);
    expect($having._resolved).toHaveLength(1);
    expect($members._resolved).toHaveLength(0);
    warn.mockRestore();
    set.destroy();
  });
});

describe('kinds registry', () => {
  test('exposes the frozen merged registry', () => {
    const custom: FilterKind = { emit: () => [] };
    const set = createFilterSet({
      targets: { where: Selection.crossfilter() },
      kinds: { custom },
    });

    expect(set.kinds.custom).toBe(custom);
    expect(Object.keys(set.kinds)).toEqual(
      expect.arrayContaining(['point', 'points', 'interval', 'match', 'condition', 'custom']),
    );
    expect(Object.isFrozen(set.kinds)).toBe(true);
    set.destroy();
  });

  test('an overriding kind replaces the built-in in the registry', () => {
    const point: FilterKind = { emit: () => [] };
    const set = createFilterSet({
      targets: { where: Selection.crossfilter() },
      kinds: { point },
    });
    expect(set.kinds.point).toBe(point);
    set.destroy();
  });
});

describe('destroy', () => {
  test('default destroy clears every published clause and never writes', () => {
    const $where = Selection.crossfilter();
    const write = vi.fn();
    const set = createFilterSet({
      targets: { where: $where },
      persist: { read: () => null, write },
    });
    set.set({ id: 'a', column: 'sport', kind: 'point', value: 'swim' });
    set.set({ id: 'b', column: 'name', kind: 'match', value: 'a' });
    write.mockClear();

    set.destroy();

    expect(set.destroyed).toBe(true);
    expect($where._resolved).toHaveLength(0);
    expect(write).not.toHaveBeenCalled();
  });

  test('destroy({ silent: true }) leaves clauses in place, emits nothing, and detaches', async () => {
    const $where = Selection.crossfilter();
    const write = vi.fn();
    const set = createFilterSet({
      targets: { where: $where },
      persist: { read: () => null, write },
    });
    set.set({ id: 'a', column: 'sport', kind: 'point', value: 'swim' });
    set.set({ id: 'b', column: 'name', kind: 'match', value: 'a' });
    const listener = vi.fn();
    $where.addEventListener('value', listener);
    await settle();
    listener.mockClear();
    write.mockClear();

    set.destroy({ silent: true });
    await settle();

    expect(set.destroyed).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    expect($where._resolved).toHaveLength(2);
    expect(write).not.toHaveBeenCalled();

    // Listeners were detached: an external drop no longer mirrors into the set.
    $where.reset();
    expect(set.store.state.specs.map((spec) => spec.id)).toEqual(['a', 'b']);
    expect(write).not.toHaveBeenCalled();
    // Further mutations are no-ops after destroy.
    set.set({ id: 'c', column: 'sport', kind: 'point', value: 'run' });
    expect($where._resolved).toHaveLength(0);
  });
});

describe('chip routing target', () => {
  test('a spec with no target produces chips targeting "where"', () => {
    const $where = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $where } });

    set.set({ id: 'p', column: 'sport', kind: 'point', value: 'swim' });

    const chips = set.store.state.chips;
    expect(chips).toHaveLength(1);
    expect(chips[0]?.target).toBe('where');
    set.destroy();
  });

  test('an explicit spec target is reflected on the chip', () => {
    const $where = Selection.crossfilter();
    const $having = Selection.crossfilter();
    const set = createFilterSet({
      targets: { where: $where, 'having:foo': $having },
    });

    set.set({
      id: 'p',
      column: 'sport',
      kind: 'point',
      value: 'swim',
      target: 'having:foo',
    });

    const chips = set.store.state.chips;
    expect(chips).toHaveLength(1);
    expect(chips[0]?.target).toBe('having:foo');
    set.destroy();
  });

  test('exploded chips inherit the parent spec target', () => {
    const $where = Selection.crossfilter();
    const $having = Selection.crossfilter();
    const set = createFilterSet({
      targets: { where: $where, 'having:foo': $having },
    });

    set.set({
      id: 'names',
      column: 'name',
      kind: 'points',
      value: ['Ada', 'Ed'],
      target: 'having:foo',
    });

    const chips = set.store.state.chips;
    expect(chips).toHaveLength(2);
    expect(chips.every((chip) => chip.exploded)).toBe(true);
    expect(chips.every((chip) => chip.target === 'having:foo')).toBe(true);
    set.destroy();
  });

  test('a self-routing kind reports its resolved target, not spec.target', () => {
    const $where = Selection.crossfilter();
    const $havingA = Selection.crossfilter();
    const $membersA = Selection.crossfilter();
    // A kind that ignores spec.target and routes its own emissions to
    // `having:a` (primary) + `members:a` for the same spec.
    const selfRouting: FilterKind = {
      emit: () => [
        { target: 'having:a', clause: { predicate: gt(count(), 1) } },
        { target: 'members:a', clause: { predicate: gt(count(), 1) } },
      ],
    };
    const set = createFilterSet({
      targets: { where: $where, 'having:a': $havingA, 'members:a': $membersA },
      kinds: { metric: selfRouting },
    });

    // Decorative spec.target that the kind overrides on every emission.
    set.set({
      id: 'm',
      column: 'wins',
      kind: 'metric',
      value: 5,
      target: 'where',
    });

    const chips = set.store.state.chips;
    expect(chips).toHaveLength(1);
    // Primary = first emission's resolved target in declaration order.
    expect(chips[0]?.target).toBe('having:a');
    expect(chips[0]?.target).not.toBe('where');
    set.destroy();
  });

  test('exploded chips of a self-routing kind report the resolved target', () => {
    const $where = Selection.crossfilter();
    const $havingA = Selection.crossfilter();
    // A self-routing kind that also explodes array values.
    const selfRoutingExplode: FilterKind = {
      explodeValues: true,
      emit: () => [{ target: 'having:a', clause: { predicate: gt(count(), 1) } }],
    };
    const set = createFilterSet({
      targets: { where: $where, 'having:a': $havingA },
      kinds: { metricSet: selfRoutingExplode },
    });

    set.set({
      id: 'ms',
      column: 'wins',
      kind: 'metricSet',
      value: [1, 2, 3],
      target: 'where',
    });

    const chips = set.store.state.chips;
    expect(chips).toHaveLength(3);
    expect(chips.every((chip) => chip.exploded)).toBe(true);
    expect(chips.every((chip) => chip.target === 'having:a')).toBe(true);
    set.destroy();
  });

  test('a declared spec.target still resolves for a non-self-routing kind', () => {
    const $where = Selection.crossfilter();
    const $having = Selection.crossfilter();
    // point does not override the target, so the declared spec.target wins.
    const set = createFilterSet({
      targets: { where: $where, 'having:bar': $having },
    });

    set.set({
      id: 'p',
      column: 'sport',
      kind: 'point',
      value: 'swim',
      target: 'having:bar',
    });

    const chips = set.store.state.chips;
    expect(chips).toHaveLength(1);
    expect(chips[0]?.target).toBe('having:bar');
    set.destroy();
  });

  test("a spec's operator is reflected on its chip (undefined when absent)", () => {
    const $where = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $where } });

    set.set({
      id: 'c',
      column: 'domain',
      kind: 'condition',
      operator: 'not_in',
      value: ['reddit.com'],
      label: 'Domain',
    });
    set.set({ id: 'p', column: 'sport', kind: 'point', value: 'swim' });

    const chips = set.store.state.chips;
    const conditionChip = chips.find((chip) => chip.id === 'c');
    const pointChip = chips.find((chip) => chip.id === 'p');
    expect(conditionChip?.operator).toBe('not_in');
    // `point` specs carry no operator, so the chip's operator is undefined.
    expect(pointChip?.operator).toBeUndefined();
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
      fields: [],
      predicate: gt({ toString: () => '"weight"' } as never, { toString: () => '70' } as never),
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

  test('a context change toggling the emitted predicate null↔non-null clears and republishes exactly once each', async () => {
    const $where = Selection.crossfilter();
    const $context = Selection.crossfilter();

    // Emits a membership subquery only while a sibling context predicate
    // exists; opts out (null → the clause is cleared) when the context is
    // empty. This drives the emitted predicate across the null↔non-null
    // boundary purely via context rebuilds.
    const gated = subqueryFilterKind((args) => {
      const ctx = args.contextPredicate;
      if (ctx == null) {
        return null;
      }
      return Query.from('athletes').select('id').where(ctx);
    });

    const set = createFilterSet({
      targets: { where: $where },
      kinds: { gated },
      context: $context,
    });
    set.set({ id: 'sq', column: 'id', kind: 'gated', value: null });

    // Empty context → the kind opts out → nothing is published.
    expect($where._resolved).toHaveLength(0);

    const siblingClause = {
      source: { id: 'sibling' },
      value: 70,
      fields: [],
      predicate: gt({ toString: () => '"weight"' } as never, { toString: () => '70' } as never),
    };
    const clearSibling = { ...siblingClause, value: null, predicate: null };

    let updates = 0;
    const listener = (): void => {
      updates += 1;
    };
    $where.addEventListener('value', listener);

    // null → non-null: context gains a sibling → the clause is published once.
    $context.update(siblingClause);
    await waitFor(() => {
      expect($where._resolved).toHaveLength(1);
    });
    expect(predicateSql($where)).toContain('IN (SELECT');
    expect(updates).toBe(1);

    // non-null → null: context empties → the clause is cleared exactly once.
    $context.update(clearSibling);
    await waitFor(() => {
      expect($where._resolved).toHaveLength(0);
    });
    expect(updates).toBe(2);

    // Converged null: a further empty-context re-dispatch publishes nothing
    // (the source has no active clause → the clear is suppressed).
    await settle();
    $context.update({ ...clearSibling });
    await settle();
    expect(updates).toBe(2);

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

    const persisted = JSON.parse(JSON.stringify(set1.store.state.specs)) as Array<FilterSpec>;
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

    expect(() => set.set({ id: 'x', column: 'sport', kind: 'nope', value: 'swim' })).toThrow(
      /unknown kind/,
    );

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
