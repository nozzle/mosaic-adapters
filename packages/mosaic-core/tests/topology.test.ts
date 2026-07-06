/**
 * Tests for {@link createTopology}: the named-Selection-graph primitive.
 *
 * Construction is validation (assert-and-throw), so most cases assert either a
 * successfully resolved Selection graph or the exact `Error` message on the
 * first violation. Clause-level behaviour (reset type-awareness, the annotated
 * active-clause store, and FilterSet-vs-foreign dedup) is exercised with plain
 * point clauses published directly onto Selections — no coordinator required.
 */
import { Selection, clausePoint } from '@uwdata/mosaic-core';
import { Query } from '@uwdata/mosaic-sql';
import { describe, expect, test, vi } from 'vitest';

import { settle, waitFor } from '@nozzleio/test-support/duckdb';
import { createTopology, subqueryFilterKind } from '../src/index';
import type { FilterSpec, Persister } from '../src/index';

/** Publish a point clause from an independent (foreign) source. */
function publishForeign(
  selection: Selection,
  column: string,
  value: string,
  source: object = { column, value },
): object {
  selection.update(clausePoint(column, value, { source }));
  return source;
}

/** Columns of a Selection's resolved (active-predicate) clauses. */
function resolvedColumns(selection: Selection): Array<string> {
  return selection._resolved
    .filter((clause) => clause.predicate != null)
    .map((clause) => String((clause.source as { column?: string }).column));
}

describe('createTopology — happy-path resolution', () => {
  test('standalone types resolve to distinct Selections of the right strategy', () => {
    const topology = createTopology({
      i: { type: 'intersect' },
      u: { type: 'union' },
      s: { type: 'single' },
      x: { type: 'crossfilter' },
    });

    expect(topology.resolve('i')).toBeInstanceOf(Selection);
    expect(topology.resolve('u').single).toBe(false);
    expect(topology.resolve('s').single).toBe(true);
    expect(topology.resolve('x')).toBeInstanceOf(Selection);
    // Distinct instances.
    expect(topology.resolve('i')).not.toBe(topology.resolve('u'));
    topology.destroy();
  });

  test('compose mirrors the union of its included selections', () => {
    const topology = createTopology({
      a: { type: 'crossfilter' },
      b: { type: 'crossfilter' },
      combined: { type: 'compose', include: ['a', 'b'] },
    });

    publishForeign(topology.resolve('a'), 'sport', 'swim');
    publishForeign(topology.resolve('b'), 'name', 'Ada');

    expect(resolvedColumns(topology.resolve('combined')).sort()).toEqual([
      'name',
      'sport',
    ]);
    topology.destroy();
  });

  test('cascading exposes per-key contexts that exclude their own input', () => {
    const topology = createTopology({
      a: { type: 'crossfilter' },
      b: { type: 'crossfilter' },
      cascade: { type: 'cascading', keys: ['a', 'b'] },
    });

    publishForeign(topology.resolve('a'), 'colA', 'x');
    publishForeign(topology.resolve('b'), 'colB', 'y');

    // a's context sees b but never a.
    expect(resolvedColumns(topology.resolve('cascade.a'))).toEqual(['colB']);
    expect(resolvedColumns(topology.resolve('cascade.b'))).toEqual(['colA']);
    topology.destroy();
  });

  test('cascading externals are included in every context', () => {
    const topology = createTopology({
      a: { type: 'crossfilter' },
      b: { type: 'crossfilter' },
      table: { type: 'crossfilter' },
      cascade: { type: 'cascading', keys: ['a', 'b'], externals: ['table'] },
    });

    publishForeign(topology.resolve('table'), 'region', 'eu');

    expect(resolvedColumns(topology.resolve('cascade.a'))).toEqual(['region']);
    expect(resolvedColumns(topology.resolve('cascade.b'))).toEqual(['region']);
    topology.destroy();
  });

  test('filter-set targets resolve as entry.targetName and publish clauses', () => {
    const topology = createTopology({
      filters: {
        type: 'filter-set',
        targets: { where: 'crossfilter', having: 'crossfilter' },
      },
    });

    const filterSet = topology.getFilterSet('filters');
    expect(filterSet).toBeDefined();
    filterSet?.set({ id: 'p', column: 'sport', kind: 'point', value: 'swim' });

    const where = topology.resolve('filters.where');
    expect(String(where._resolved[0]?.predicate)).toContain('"sport"');
    // The other target is untouched.
    expect(topology.resolve('filters.having')._resolved).toHaveLength(0);
    topology.destroy();
  });

  test('filter-set context ref wires the FilterSet subquery context', () => {
    const topology = createTopology({
      ctx: { type: 'crossfilter' },
      filters: {
        type: 'filter-set',
        targets: { where: 'crossfilter' },
        context: 'ctx',
      },
    });
    // Constructing without throwing proves the context ref resolved.
    expect(topology.getFilterSet('filters')).toBeDefined();
    topology.destroy();
  });

  test('external declaration resolves to the supplied instance', () => {
    const brush = Selection.crossfilter();
    const topology = createTopology(
      { brush: { type: 'external' } },
      { selections: { brush } },
    );
    expect(topology.resolve('brush')).toBe(brush);
    topology.destroy();
  });

  test('validNames lists bare simple entries and dotted children only', () => {
    const brush = Selection.crossfilter();
    const topology = createTopology(
      {
        a: { type: 'intersect' },
        b: { type: 'crossfilter' },
        combined: { type: 'compose', include: ['a', 'b'] },
        cascade: { type: 'cascading', keys: ['a', 'b'] },
        filters: {
          type: 'filter-set',
          targets: { where: 'crossfilter' },
        },
        brush: { type: 'external' },
      },
      { selections: { brush } },
    );

    expect([...topology.validNames].sort()).toEqual(
      [
        'a',
        'b',
        'combined',
        'brush',
        'cascade.a',
        'cascade.b',
        'filters.where',
      ].sort(),
    );
    // Compound entries have no bare name.
    expect(topology.validNames.has('cascade')).toBe(false);
    expect(topology.validNames.has('filters')).toBe(false);
    topology.destroy();
  });
});

describe('createTopology — validation errors', () => {
  test('unknown declaration type throws listing known types', () => {
    expect(() =>
      createTopology({
        // @ts-expect-error intentionally invalid type
        bad: { type: 'nope' },
      }),
    ).toThrow(/unknown declaration type 'nope'/);
  });

  test('dot in an entry name throws', () => {
    expect(() => createTopology({ 'a.b': { type: 'intersect' } })).toThrow(
      /contains a dot/,
    );
  });

  test('dangling ref throws naming the undeclared entry', () => {
    expect(() =>
      createTopology({
        combined: { type: 'compose', include: ['missing'] },
      }),
    ).toThrow(/undeclared entry 'missing'/);
  });

  test('bare ref to a compound (filter-set) entry throws in a declaration', () => {
    expect(() =>
      createTopology({
        filters: { type: 'filter-set', targets: { where: 'crossfilter' } },
        combined: { type: 'compose', include: ['filters'] },
      }),
    ).toThrow(/bare reference to compound entry 'filters'/);
  });

  test('bare ref to a compound (cascading) entry throws in a declaration', () => {
    expect(() =>
      createTopology({
        a: { type: 'crossfilter' },
        b: { type: 'crossfilter' },
        cascade: { type: 'cascading', keys: ['a', 'b'] },
        combined: { type: 'compose', include: ['cascade'] },
      }),
    ).toThrow(/bare reference to compound entry 'cascade'/);
  });

  test('cycle detection reports the path', () => {
    expect(() =>
      createTopology({
        a: { type: 'compose', include: ['b'] },
        b: { type: 'compose', include: ['a'] },
      }),
    ).toThrow(/dependency cycle detected: a → b → a/);
  });

  test('self-cycle reports the path', () => {
    expect(() =>
      createTopology({
        a: { type: 'compose', include: ['a'] },
      }),
    ).toThrow(/dependency cycle detected: a → a/);
  });

  test('external without a supplied instance throws', () => {
    expect(() => createTopology({ brush: { type: 'external' } })).toThrow(
      /declared 'external' but no instance was supplied/,
    );
  });

  test('supplied instance without a declaration throws', () => {
    const brush = Selection.crossfilter();
    expect(() => createTopology({}, { selections: { brush } })).toThrow(
      /no entry 'brush' is declared/,
    );
  });

  test('supplied instance for a non-external declaration throws', () => {
    const sel = Selection.crossfilter();
    expect(() =>
      createTopology({ sel: { type: 'intersect' } }, { selections: { sel } }),
    ).toThrow(/declared as 'intersect', not 'external'/);
  });

  test('unknown ref after construction lists validNames', () => {
    const topology = createTopology({ a: { type: 'intersect' } });
    let message = '';
    try {
      topology.resolve('typo');
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/undeclared entry 'typo'/);
    topology.destroy();
  });

  test('bare ref to a compound entry via resolve() throws', () => {
    const topology = createTopology({
      filters: { type: 'filter-set', targets: { where: 'crossfilter' } },
    });
    expect(() => topology.resolve('filters')).toThrow(
      /bare reference to compound entry 'filters'/,
    );
    topology.destroy();
  });

  test('unknown child ref lists valid children', () => {
    const topology = createTopology({
      filters: { type: 'filter-set', targets: { where: 'crossfilter' } },
    });
    expect(() => topology.resolve('filters.nope')).toThrow(
      /unknown child 'nope'.*Valid children: filters.where/s,
    );
    topology.destroy();
  });
});

describe('createTopology — reset() type-awareness', () => {
  test('clears standalone and external clauses; skips derived; opt-out honored', () => {
    const brush = Selection.crossfilter();
    const topology = createTopology(
      {
        a: { type: 'crossfilter' },
        keep: { type: 'crossfilter', reset: false },
        combined: { type: 'compose', include: ['a'] },
        brush: { type: 'external' },
      },
      { selections: { brush } },
    );

    publishForeign(topology.resolve('a'), 'sport', 'swim');
    publishForeign(topology.resolve('keep'), 'kept', 'yes');
    publishForeign(brush, 'brushed', 'v');

    topology.reset();

    expect(topology.resolve('a')._resolved).toHaveLength(0);
    // Opt-out entry survives.
    expect(resolvedColumns(topology.resolve('keep'))).toEqual(['kept']);
    // External is owned-for-reset (declared, not reset:false) so it is cleared.
    expect(brush._resolved).toHaveLength(0);
    topology.destroy();
  });

  test('reset delegates filter-set entries to filterSet.reset()', () => {
    const topology = createTopology({
      filters: { type: 'filter-set', targets: { where: 'crossfilter' } },
    });
    const filterSet = topology.getFilterSet('filters');
    filterSet?.set({ id: 'p', column: 'sport', kind: 'point', value: 'swim' });
    expect(filterSet?.store.state.specs).toHaveLength(1);

    topology.reset();

    expect(filterSet?.store.state.specs).toHaveLength(0);
    expect(topology.resolve('filters.where')._resolved).toHaveLength(0);
    topology.destroy();
  });

  test('reset:false on a filter-set entry opts it out', () => {
    const topology = createTopology({
      filters: {
        type: 'filter-set',
        targets: { where: 'crossfilter' },
        reset: false,
      },
    });
    const filterSet = topology.getFilterSet('filters');
    filterSet?.set({ id: 'p', column: 'sport', kind: 'point', value: 'swim' });

    topology.reset();

    expect(filterSet?.store.state.specs).toHaveLength(1);
    topology.destroy();
  });
});

describe('createTopology — active-clause enumeration', () => {
  test('reports foreign clauses annotated by entry/ref/label/meta', async () => {
    const topology = createTopology({
      a: { type: 'crossfilter', label: 'Filter A', meta: { group: 'g1' } },
    });

    publishForeign(topology.resolve('a'), 'sport', 'swim');
    await settle();

    const { clauses } = topology.activeClauses.state;
    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toMatchObject({
      entry: 'a',
      ref: 'a',
      label: 'Filter A',
      meta: { group: 'g1' },
    });
    expect(String(clauses[0]?.clause.predicate)).toContain('"sport"');
    topology.destroy();
  });

  test('excludes clauses sourced by a FilterSet the topology built (dedup)', async () => {
    const topology = createTopology({
      filters: { type: 'filter-set', targets: { where: 'crossfilter' } },
    });
    const filterSet = topology.getFilterSet('filters');

    // FilterSet-owned clause on the shared target: must NOT appear as foreign.
    filterSet?.set({ id: 'p', column: 'sport', kind: 'point', value: 'swim' });
    await settle();
    expect(topology.activeClauses.state.clauses).toHaveLength(0);

    // A genuinely foreign clause on the same target Selection IS reported.
    publishForeign(topology.resolve('filters.where'), 'name', 'Ada');
    await settle();
    const clauses = topology.activeClauses.state.clauses;
    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toMatchObject({
      entry: 'filters',
      ref: 'filters.where',
    });
    expect(String(clauses[0]?.clause.predicate)).toContain('"name"');
    topology.destroy();
  });

  test('does not double-count derived compose/cascading contexts', async () => {
    const topology = createTopology({
      a: { type: 'crossfilter' },
      b: { type: 'crossfilter' },
      combined: { type: 'compose', include: ['a', 'b'] },
      cascade: { type: 'cascading', keys: ['a', 'b'] },
    });

    publishForeign(topology.resolve('a'), 'sport', 'swim');
    await settle();

    // The clause appears once (on `a`), not again via `combined`/`cascade.b`.
    const clauses = topology.activeClauses.state.clauses;
    expect(clauses).toHaveLength(1);
    expect(clauses[0]?.entry).toBe('a');
    topology.destroy();
  });

  test('the store notifies subscribers on clause changes', async () => {
    const topology = createTopology({ a: { type: 'crossfilter' } });
    const listener = vi.fn();
    const { unsubscribe } = topology.activeClauses.subscribe(listener);

    publishForeign(topology.resolve('a'), 'sport', 'swim');
    await settle();
    expect(listener).toHaveBeenCalled();
    expect(topology.activeClauses.state.clauses).toHaveLength(1);

    unsubscribe();
    topology.destroy();
  });

  test('after destroy the store stops updating', async () => {
    const topology = createTopology({ a: { type: 'crossfilter' } });
    const a = topology.resolve('a');
    topology.destroy();

    publishForeign(a, 'sport', 'swim');
    await settle();
    // The listener was detached; the store still reads its last (empty) state.
    expect(topology.activeClauses.state.clauses).toHaveLength(0);
  });
});

describe('createTopology — destroy()', () => {
  test('destroy does not touch external instances', () => {
    const brush = Selection.crossfilter();
    publishForeign(brush, 'brushed', 'v');
    const topology = createTopology(
      { brush: { type: 'external' } },
      { selections: { brush } },
    );

    topology.destroy();

    // The external instance keeps its clause; the topology never owned it.
    expect(resolvedColumns(brush)).toEqual(['brushed']);
  });

  test('destroy tears down compositions and FilterSets it created', () => {
    const topology = createTopology({
      a: { type: 'crossfilter' },
      combined: { type: 'compose', include: ['a'] },
      filters: { type: 'filter-set', targets: { where: 'crossfilter' } },
    });
    const filterSet = topology.getFilterSet('filters');
    publishForeign(topology.resolve('a'), 'sport', 'swim');
    const combined = topology.resolve('combined');
    expect(resolvedColumns(combined)).toEqual(['sport']);

    topology.destroy();

    expect(topology.destroyed).toBe(true);
    expect(filterSet?.destroyed).toBe(true);
    // The composed context was torn down (seeded clause cleared, relay detached).
    expect(combined._resolved).toHaveLength(0);
    publishForeign(topology.resolve('a'), 'name', 'Ada');
    expect(combined._resolved).toHaveLength(0);
  });

  test('destroy is idempotent', () => {
    const topology = createTopology({ a: { type: 'intersect' } });
    topology.destroy();
    topology.destroy();
    expect(topology.destroyed).toBe(true);
  });
});

describe('createTopology — two-phase compose construction', () => {
  test('a filter-set context naming a compose that includes its own targets constructs and sees peer clauses', async () => {
    // The subquery kind embeds the context predicate; the context is a compose
    // that includes the filter-set's own targets — the previously-forbidden
    // self-referential shape. Two-phase construction allows it.
    const membership = subqueryFilterKind((args) => {
      const q = Query.from('data').select('id');
      if (args.contextPredicate != null) {
        q.where(args.contextPredicate);
      }
      return q;
    });

    const topology = createTopology(
      {
        filters: {
          type: 'filter-set',
          targets: { where: 'crossfilter' },
          context: 'page',
        },
        // The compose context includes the filter-set's own target.
        page: { type: 'compose', include: ['filters.where'] },
      },
      { filterSets: { filters: { kinds: { membership } } } },
    );

    // Constructing without throwing proves the self-referential context wired.
    expect(topology.getFilterSet('filters')).toBeDefined();

    const where = topology.resolve('filters.where');
    // A foreign peer clause on the target flows through the compose context, so
    // the subquery predicate rebuilds to embed it.
    const set = topology.getFilterSet('filters');
    set?.set({ id: 'sq', column: 'id', kind: 'membership', value: null });

    const before = String(where._resolved[0]?.predicate);
    expect(before).toContain('IN (SELECT');

    publishForeign(where, 'weight', '70');
    await waitFor(() => {
      const after = String(where._resolved[0]?.predicate);
      expect(after).toContain('"weight"');
    });

    topology.destroy();
  });

  test('publishing into a target with a self-referential compose context terminates and the context carries the clause', async () => {
    const topology = createTopology({
      page: { type: 'compose', include: ['filters.where'] },
      filters: {
        type: 'filter-set',
        targets: { where: 'crossfilter' },
        context: 'page',
      },
    });

    publishForeign(topology.resolve('filters.where'), 'sport', 'swim');
    // No infinite relay: settle resolves rather than hanging.
    await settle();

    expect(resolvedColumns(topology.resolve('page'))).toEqual(['sport']);
    topology.destroy();
  });

  test('nested compose (A includes B) relays clauses regardless of declaration order — A before B', () => {
    const topology = createTopology({
      outer: { type: 'compose', include: ['inner', 'x'] },
      inner: { type: 'compose', include: ['a', 'b'] },
      a: { type: 'crossfilter' },
      b: { type: 'crossfilter' },
      x: { type: 'crossfilter' },
    });

    publishForeign(topology.resolve('a'), 'colA', 'v');
    publishForeign(topology.resolve('x'), 'colX', 'v');

    // outer sees a (via inner) and x directly.
    expect(resolvedColumns(topology.resolve('outer')).sort()).toEqual([
      'colA',
      'colX',
    ]);
    // inner sees a but not x.
    expect(resolvedColumns(topology.resolve('inner'))).toEqual(['colA']);
    topology.destroy();
  });

  test('nested compose relays pre-existing clauses regardless of declaration order — B before A', () => {
    // Same graph, inner declared before outer, AND the inner source already
    // carries a clause at construction — attach-all-then-seed must land it on
    // the outer compose too.
    const a = Selection.crossfilter();
    publishForeign(a, 'preA', 'v');

    const topology = createTopology(
      {
        a: { type: 'external' },
        b: { type: 'crossfilter' },
        inner: { type: 'compose', include: ['a', 'b'] },
        outer: { type: 'compose', include: ['inner'] },
      },
      { selections: { a } },
    );

    // The pre-existing clause on `a` was seeded transitively into inner AND
    // outer at construction.
    expect(resolvedColumns(topology.resolve('inner'))).toEqual(['preA']);
    expect(resolvedColumns(topology.resolve('outer'))).toEqual(['preA']);
    topology.destroy();
  });

  test('compose↔compose cycle still throws with the exact path message', () => {
    expect(() =>
      createTopology({
        a: { type: 'compose', include: ['b'] },
        b: { type: 'compose', include: ['a'] },
      }),
    ).toThrow(/dependency cycle detected: a → b → a/);
  });

  test('compose self-include still throws with the exact path message', () => {
    expect(() =>
      createTopology({
        a: { type: 'compose', include: ['a'] },
      }),
    ).toThrow(/dependency cycle detected: a → a/);
  });

  test('a cascading routing through a compose back to its own child is rejected as a cycle', () => {
    // cascading `wrap` keys off `key`, whose per-key context includes external
    // `combo`; `combo` is a compose that includes `wrap.key` — a genuine mutual
    // relay loop through a compose. The context edge exclusion does NOT apply
    // (this is a compose include + cascading external, both structural).
    expect(() =>
      createTopology({
        key: { type: 'crossfilter' },
        combo: { type: 'compose', include: ['wrap.key'] },
        wrap: { type: 'cascading', keys: ['key'], externals: ['combo'] },
      }),
    ).toThrow(/dependency cycle detected/);
  });

  test('persistence-hydrated clauses appear in a compose that includes the target', () => {
    // FilterSet hydration publishes onto its targets during phase 1 (a
    // synchronous persister read applies immediately); phase-2 seeding reads
    // `.clauses` afterwards, so the hydrated clause must land in the compose
    // that includes the target.
    const persisted: Array<FilterSpec> = [
      { id: 'p', column: 'sport', kind: 'point', value: 'swim' },
    ];
    const persist: Persister<Array<FilterSpec>> = {
      read: () => persisted,
      write: () => {},
    };

    const topology = createTopology(
      {
        filters: {
          type: 'filter-set',
          targets: { where: 'crossfilter' },
        },
        page: { type: 'compose', include: ['filters.where'] },
      },
      { filterSets: { filters: { persist } } },
    );

    // The hydrated point clause on filters.where was seeded into the compose.
    expect(String(topology.resolve('page')._resolved[0]?.predicate)).toContain(
      '"sport"',
    );
    topology.destroy();
  });
});
