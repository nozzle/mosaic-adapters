/**
 * Context rebuilds of a FilterSet settle when several context-dependent specs
 * feed the set's own context (two aggregate thresholds over a self-referential
 * crossfilter compose): each membership subquery leaves the other
 * context-dependent specs out of its context, instead of embedding the
 * other's latest predicate one level deeper on every rebuild. A context cycle
 * across sets that cannot settle is cut off once the rebuild chain has come
 * back to the same set `MAX_CONTEXT_REBUILDS_PER_CHAIN` times; an acyclic
 * chain of sets of any length is not.
 */
import { Selection } from '@uwdata/mosaic-core';
import { column, count, eq, literal, max } from '@uwdata/mosaic-sql';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { MAX_CONTEXT_REBUILDS_PER_CHAIN } from '../src/filter-set/filter-set';
import {
  aggregateThresholdFilterKind,
  createComposedSelection,
  createFilterSet,
  createTopology,
} from '../src/index';
import type { FilterKind, FilterSet, FilterSpec } from '../src/index';

/** Keeps `sport` groups whose heaviest athlete passes the threshold. */
const heavyKind: FilterKind = aggregateThresholdFilterKind({
  from: 'athletes',
  aggregate: () => max('weight'),
  targets: { having: 'having:sport', members: 'members:sport' },
});

/** Keeps `country` groups with enough athletes. */
const crowdedKind: FilterKind = aggregateThresholdFilterKind({
  from: 'athletes',
  aggregate: () => count(),
  targets: { having: 'having:country', members: 'members:country' },
});

const heavy: FilterSpec = {
  id: 'heavy',
  column: 'sport',
  kind: 'heavy',
  operator: 'gt',
  value: 80,
};
const crowded: FilterSpec = {
  id: 'crowded',
  column: 'country',
  kind: 'crowded',
  operator: 'gte',
  value: 2,
};
const swim: FilterSpec = { id: 'sport', column: 'sport', kind: 'point', value: 'swim' };

/** Counts `value` events on a Selection. */
function countEmits(selection: Selection): { readonly count: number } {
  const counter = { count: 0 };
  selection.addEventListener('value', () => {
    counter.count += 1;
  });
  return counter;
}

/** Lets queued microtask rebuilds and `value` dispatches drain. */
async function drain(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function sql(selection: Selection): Array<string> {
  return selection._resolved.map((clause) => String(clause.predicate));
}

/** The one predicate on a single-clause target. */
function only(selection: Selection): string {
  const all = sql(selection);
  expect(all).toHaveLength(1);
  return all[0] ?? '';
}

/**
 * Destroys `set` once `selection` emits `limit` times, so a rebuild loop that
 * never settles fails the test's assertions instead of hanging it.
 */
function guardLoop(selection: Selection, set: FilterSet, limit = 200): void {
  let emits = 0;
  selection.addEventListener('value', () => {
    emits += 1;
    if (emits === limit) {
      set.destroy({ silent: true });
    }
  });
}

/**
 * The spec-dashboard shape: `where` plus two thresholds' `members` targets
 * composed into a crossfilter `page` that is the set's own context.
 */
function selfReferentialSet(): {
  set: FilterSet;
  where: Selection;
  sportMembers: Selection;
  countryMembers: Selection;
  page: Selection;
  destroy: () => void;
} {
  const where = Selection.crossfilter();
  const sportMembers = Selection.crossfilter();
  const countryMembers = Selection.crossfilter();
  const composed = createComposedSelection([where, sportMembers, countryMembers], {
    as: 'crossfilter',
  });
  const set = createFilterSet({
    targets: {
      where,
      'having:sport': Selection.crossfilter(),
      'members:sport': sportMembers,
      'having:country': Selection.crossfilter(),
      'members:country': countryMembers,
    },
    kinds: { heavy: heavyKind, crowded: crowdedKind },
    context: composed.selection,
  });
  guardLoop(composed.selection, set);
  return {
    set,
    where,
    sportMembers,
    countryMembers,
    page: composed.selection,
    destroy: () => {
      set.destroy();
      composed.destroy();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('two context-dependent specs feeding their own context', () => {
  test('settle, and neither membership subquery embeds the other', async () => {
    const { set, where, sportMembers, countryMembers, page, destroy } = selfReferentialSet();
    const sportEmits = countEmits(sportMembers);
    const countryEmits = countEmits(countryMembers);

    set.set(swim);
    set.set(heavy);
    set.set(crowded);
    await drain();

    expect(set.destroyed).toBe(false);
    const sport = only(sportMembers);
    const country = only(countryMembers);
    // Each subquery scopes its aggregate by the base context (the `where`
    // clause) only.
    expect(sport).toContain('max("weight") > 80');
    expect(sport).toContain(`"sport" IN ('swim')`);
    expect(sport).not.toContain('count(');
    expect(country).toContain('count(*) >= 2');
    expect(country).toContain(`"sport" IN ('swim')`);
    expect(country).not.toContain('max(');
    // The outer intersection still applies every clause.
    expect(sql(page)).toEqual([sql(where)[0], sport, country]);
    // One publish per threshold: the rebuilds the context changes trigger
    // publish nothing new.
    expect(sportEmits.count).toBe(1);
    expect(countryEmits.count).toBe(1);
    destroy();
  });

  test('a base-context change rebuilds both against the new context, once each', async () => {
    const { set, sportMembers, countryMembers, destroy } = selfReferentialSet();
    set.set(heavy);
    set.set(crowded);
    await drain();
    const sportEmits = countEmits(sportMembers);
    const countryEmits = countEmits(countryMembers);

    set.set(swim);
    await drain();

    expect(only(sportMembers)).toContain(`WHERE ("sport" IN ('swim'))`);
    expect(only(countryMembers)).toContain(`WHERE ("sport" IN ('swim'))`);
    expect(only(sportMembers)).not.toContain('count(');
    expect(only(countryMembers)).not.toContain('max(');
    expect(sportEmits.count).toBe(1);
    expect(countryEmits.count).toBe(1);
    destroy();
  });

  test('changing one threshold leaves the other subquery untouched', async () => {
    const { set, sportMembers, countryMembers, destroy } = selfReferentialSet();
    set.set(heavy);
    set.set(crowded);
    await drain();
    const countryBefore = only(countryMembers);
    const countryEmits = countEmits(countryMembers);

    set.set({ ...heavy, value: 90 });
    await drain();

    expect(only(sportMembers)).toContain('max("weight") > 90');
    expect(only(countryMembers)).toBe(countryBefore);
    expect(countryEmits.count).toBe(0);
    destroy();
  });

  test('removing one threshold leaves the other on the base context', async () => {
    const { set, sportMembers, countryMembers, destroy } = selfReferentialSet();
    set.set(swim);
    set.set(heavy);
    set.set(crowded);
    await drain();

    set.remove('heavy');
    await drain();

    expect(sql(sportMembers)).toEqual([]);
    expect(only(countryMembers)).toContain(`WHERE ("sport" IN ('swim'))`);
    expect(only(countryMembers)).not.toContain('max(');
    destroy();
  });

  test('settle inside filterSet.batch(): one emission per membership target', async () => {
    const { set, sportMembers, countryMembers, page, destroy } = selfReferentialSet();
    const sportEmits = countEmits(sportMembers);
    const countryEmits = countEmits(countryMembers);
    const pageEmits = countEmits(page);

    set.batch((tx) => {
      tx.set(heavy);
      tx.set(crowded);
      tx.set(swim);
    });
    await drain();

    expect(set.destroyed).toBe(false);
    expect(only(sportMembers)).toContain(`WHERE ("sport" IN ('swim'))`);
    expect(only(sportMembers)).not.toContain('count(');
    expect(only(countryMembers)).toContain(`WHERE ("sport" IN ('swim'))`);
    expect(only(countryMembers)).not.toContain('max(');
    expect(sportEmits.count).toBe(1);
    expect(countryEmits.count).toBe(1);
    expect(pageEmits.count).toBe(1);
    destroy();
  });

  test('settle inside topology.batch() on a self-referential filter-set context', async () => {
    const topology = createTopology(
      {
        filters: {
          type: 'filter-set',
          targets: {
            where: 'crossfilter',
            'having:sport': 'crossfilter',
            'members:sport': 'crossfilter',
            'having:country': 'crossfilter',
            'members:country': 'crossfilter',
          },
          context: 'page',
        },
        page: {
          type: 'compose',
          as: 'crossfilter',
          include: ['filters.where', 'filters.members:sport', 'filters.members:country'],
        },
      },
      { filterSets: { filters: { kinds: { heavy: heavyKind, crowded: crowdedKind } } } },
    );
    const filters = topology.getFilterSet('filters')!;
    guardLoop(topology.resolve('page'), filters);
    const sportMembers = topology.resolve('filters.members:sport');
    const countryMembers = topology.resolve('filters.members:country');
    const sportEmits = countEmits(sportMembers);
    const countryEmits = countEmits(countryMembers);

    topology.batch(() => {
      filters.set(heavy);
      filters.set(crowded);
      filters.set(swim);
    });
    await drain();

    expect(filters.destroyed).toBe(false);
    expect(only(sportMembers)).toContain(`WHERE ("sport" IN ('swim'))`);
    expect(only(sportMembers)).not.toContain('count(');
    expect(only(countryMembers)).toContain(`WHERE ("sport" IN ('swim'))`);
    expect(only(countryMembers)).not.toContain('max(');
    expect(sportEmits.count).toBe(1);
    expect(countryEmits.count).toBe(1);

    // And unbatched writes on the same topology settle too.
    filters.set({ ...crowded, value: 3 });
    await drain();
    expect(filters.destroyed).toBe(false);
    expect(only(countryMembers)).toContain('count(*) >= 3');
    expect(only(sportMembers)).not.toContain('count(');
    topology.destroy();
  });
});

describe('context-dependent specs that do not feed the context', () => {
  /**
   * `crowded` publishes to targets outside the context; `heavy` feeds it.
   * Nothing loops here, so `crowded` keeps seeing `heavy`'s clause, as before
   * sibling exclusion existed.
   */
  function mixedSet(): {
    set: FilterSet;
    sportMembers: Selection;
    countryMembers: Selection;
    destroy: () => void;
  } {
    const where = Selection.crossfilter();
    const sportMembers = Selection.crossfilter();
    const countryMembers = Selection.crossfilter();
    const composed = createComposedSelection([where, sportMembers], { as: 'crossfilter' });
    const set = createFilterSet({
      targets: {
        where,
        'having:sport': Selection.crossfilter(),
        'members:sport': sportMembers,
        'having:country': Selection.crossfilter(),
        'members:country': countryMembers,
      },
      kinds: { heavy: heavyKind, crowded: crowdedKind },
      context: composed.selection,
    });
    guardLoop(composed.selection, set);
    return {
      set,
      sportMembers,
      countryMembers,
      destroy: () => {
        set.destroy();
        composed.destroy();
      },
    };
  }

  test.each(['feeding-first', 'non-feeding-first'] as const)(
    'a non-feeding spec still embeds a feeding sibling (%s)',
    async (order) => {
      const { set, sportMembers, countryMembers, destroy } = mixedSet();
      const specs = order === 'feeding-first' ? [heavy, crowded] : [crowded, heavy];
      for (const spec of specs) {
        set.set(spec);
        // Settle in between: `crowded` set after `heavy` has settled gets no
        // context rebuild (its own publish does not change the context), so
        // its first publish has to be right.
        await drain();
      }

      expect(set.destroyed).toBe(false);
      // The non-feeding `crowded` subquery sees `heavy`'s membership clause...
      expect(only(countryMembers)).toContain('max("weight") > 80');
      // ...and `heavy`, which feeds the context, never sees `crowded`'s
      // (it is not in the context).
      expect(only(sportMembers)).not.toContain('count(');
      destroy();
    },
  );
});

describe('clause ownership', () => {
  test('a spec id that prefixes another id does not hide that spec from the context', async () => {
    const $where = Selection.intersect();
    const $members = Selection.intersect();
    const composed = createComposedSelection([$where]);
    const membersKind: FilterKind = aggregateThresholdFilterKind({
      from: 'athletes',
      aggregate: () => max('weight'),
      targets: { having: 'having', members: 'members' },
    });
    const set = createFilterSet({
      targets: { where: $where, having: Selection.intersect(), members: $members },
      kinds: { threshold: membersKind },
      context: composed.selection,
    });

    // `a b`'s clause source is keyed `a b where`, which starts with `a `.
    set.set({ id: 'a b', column: 'sport', kind: 'point', value: 'swim' });
    set.set({ id: 'a', column: 'sport', kind: 'threshold', operator: 'gt', value: 80 });
    await drain();

    expect(only($members)).toContain(`WHERE ("sport" IN ('swim'))`);
    set.destroy();
    composed.destroy();
  });
});

describe('context cycle across FilterSets', () => {
  /**
   * Two sets, each reading the other's membership target as its context, with
   * a threshold on each: every rebuild of one changes the other's context,
   * and the subqueries nest one level deeper each time. Exclusion within a
   * set cannot help (the clauses belong to another set), so the depth cap
   * ends the chain.
   */
  test('is cut off at MAX_CONTEXT_REBUILDS_PER_CHAIN with one development warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const leftMembers = Selection.intersect();
    const rightMembers = Selection.intersect();
    const left = createFilterSet({
      targets: { 'having:sport': Selection.intersect(), 'members:sport': leftMembers },
      kinds: { heavy: heavyKind },
      context: rightMembers,
    });
    const right = createFilterSet({
      targets: { 'having:country': Selection.intersect(), 'members:country': rightMembers },
      kinds: { crowded: crowdedKind },
      context: leftMembers,
    });
    guardLoop(leftMembers, left, 10 * MAX_CONTEXT_REBUILDS_PER_CHAIN);
    guardLoop(rightMembers, right, 10 * MAX_CONTEXT_REBUILDS_PER_CHAIN);
    const leftEmits = countEmits(leftMembers);
    const rightEmits = countEmits(rightMembers);

    left.set(heavy);
    right.set(crowded);
    await drain();
    await drain();

    // Stopped by the cap, not by the loop guard.
    expect(left.destroyed).toBe(false);
    expect(right.destroyed).toBe(false);
    const total = leftEmits.count + rightEmits.count;
    // Each of the two sets rebuilds at most the cap's number of times.
    expect(total).toBeGreaterThan(MAX_CONTEXT_REBUILDS_PER_CHAIN);
    expect(total).toBeLessThanOrEqual(2 * MAX_CONTEXT_REBUILDS_PER_CHAIN + 4);
    const capWarnings = warn.mock.calls.filter((call) =>
      String(call[0]).includes('stopped rebuilding'),
    );
    expect(capWarnings).toHaveLength(1);

    // A change that does not come from a rebuild starts a new, bounded chain.
    const before = leftEmits.count + rightEmits.count;
    right.set({ ...crowded, value: 3 });
    await drain();
    await drain();
    const again = leftEmits.count + rightEmits.count - before;
    expect(again).toBeGreaterThan(0);
    expect(again).toBeLessThanOrEqual(2 * MAX_CONTEXT_REBUILDS_PER_CHAIN + 4);
    expect(left.destroyed).toBe(false);
    left.destroy();
    right.destroy();
  });

  test('an acyclic chain of sets is not affected', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // first → second → third: each reads the previous set's membership target.
    const base = Selection.intersect();
    const members = [Selection.intersect(), Selection.intersect(), Selection.intersect()];
    const sets = members.map((target, index) =>
      createFilterSet({
        targets: { 'having:sport': Selection.intersect(), 'members:sport': target },
        kinds: { heavy: heavyKind },
        context: index === 0 ? base : members[index - 1],
      }),
    );
    sets.forEach((set, index) => {
      set.set({ ...heavy, id: `heavy-${index}` });
    });
    await drain();

    const brush = {};
    for (let round = 0; round < 3 * MAX_CONTEXT_REBUILDS_PER_CHAIN; round += 1) {
      base.update({
        source: brush,
        value: round,
        fields: [],
        predicate: eq(column('year'), literal(round)),
      });
      await drain();
    }

    // Each set nests the previous one's subquery around the latest base value.
    const last = only(members[2] ?? base);
    expect(last).toContain(`"year" = ${3 * MAX_CONTEXT_REBUILDS_PER_CHAIN - 1}`);
    expect(
      warn.mock.calls.filter((call) => String(call[0]).includes('stopped rebuilding')),
    ).toHaveLength(0);
    sets.forEach((set) => {
      set.destroy();
    });
  });

  test('an acyclic chain longer than the cap propagates a base change to its last set', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Every set reads the previous set's membership target, so one base change
    // is a chain of one rebuild per set, longer than the cap.
    const length = MAX_CONTEXT_REBUILDS_PER_CHAIN + 2;
    const base = Selection.intersect();
    const members = Array.from({ length }, () => Selection.intersect());
    const sets = members.map((target, index) =>
      createFilterSet({
        targets: { 'having:sport': Selection.intersect(), 'members:sport': target },
        kinds: { heavy: heavyKind },
        context: index === 0 ? base : members[index - 1],
      }),
    );
    sets.forEach((set, index) => {
      set.set({ ...heavy, id: `heavy-${index}` });
    });
    await drain();

    const brush = {};
    for (const year of [2000, 2004]) {
      base.update({
        source: brush,
        value: year,
        fields: [],
        predicate: eq(column('year'), literal(year)),
      });
      await drain();
    }

    // The last set's subquery nests every earlier one around the latest base
    // value; none of them kept a stale predicate.
    for (const target of members) {
      const predicate = only(target);
      expect(predicate).toContain('"year" = 2004');
      expect(predicate).not.toContain('"year" = 2000');
    }
    expect(
      warn.mock.calls.filter((call) => String(call[0]).includes('stopped rebuilding')),
    ).toHaveLength(0);
    sets.forEach((set) => {
      set.destroy();
    });
  });
});
