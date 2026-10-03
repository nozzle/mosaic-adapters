/**
 * Bookkeeping of the opt-in batch: the deferred-emit engine
 * (`SelectionBatch`), `filterSet.batch()` and `topology.batch()`. Query-level
 * behaviour (request rounds, pre-aggregation) lives in batch-queries.test.ts.
 */
import { Selection, clausePoint } from '@uwdata/mosaic-core';
import type { ClauseSource, SelectionClause } from '@uwdata/mosaic-core';
import { Query, column, eq, literal } from '@uwdata/mosaic-sql';
import { describe, expect, test, vi } from 'vitest';

import { joinFilterSetBatch } from '../src/filter-set/filter-set';
import {
  NESTED_BATCH_ERROR_MESSAGE as PUBLIC_NESTED_BATCH_ERROR_MESSAGE,
  createCascadingContexts,
  createComposedSelection,
  createFilterSet,
  createMappedSelection,
  createSkipProjectedSelection,
  createTopology,
  subqueryFilterKind,
} from '../src/index';
import type {
  FilterKind,
  FilterKindEmission,
  FilterSet,
  FilterSpec,
  Persister,
} from '../src/index';
import {
  NESTED_BATCH_ERROR_MESSAGE,
  SelectionBatch,
  openSelectionBatch,
  runInBatch,
} from '../src/selection-batch';

/** Counts `value` events on a Selection. */
function countEmits(selection: Selection): { readonly count: number } {
  const counter = { count: 0 };
  selection.addEventListener('value', () => {
    counter.count += 1;
  });
  return counter;
}

function point(source: ClauseSource, field: string, value: string): SelectionClause {
  return clausePoint(column(field), value, { source });
}

/**
 * Lets queued `value` dispatches drain. Upstream queues an emit while a
 * previous one is still being dispatched to listeners, so counts are only
 * final after this.
 */
async function drain(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function sql(selection: Selection): Array<string> {
  return selection._resolved.map((clause) => String(clause.predicate));
}

function recordingPersister(): {
  persister: Persister<Array<FilterSpec>>;
  writes: Array<{ state: Array<FilterSpec> | null; reason: string }>;
} {
  const writes: Array<{ state: Array<FilterSpec> | null; reason: string }> = [];
  return {
    writes,
    persister: {
      read: () => null,
      write: (state, context) => {
        writes.push({ state, reason: context.reason });
      },
    },
  };
}

const swim: FilterSpec = { id: 'sport', column: 'sport', kind: 'point', value: 'swim' };
const ada: FilterSpec = { id: 'name', column: 'name', kind: 'point', value: 'Ada' };
const heavy: FilterSpec = {
  id: 'weight',
  column: 'weight',
  kind: 'interval',
  value: [60, 90],
};

/** A subquery kind that reads the set's context predicate. */
const membership = subqueryFilterKind((args) => {
  const query = Query.from('athletes').select('id');
  if (args.contextPredicate != null) {
    query.where(args.contextPredicate);
  }
  return query;
});

function memberSpec(id: string): FilterSpec {
  return { id, column: 'id', kind: 'membership', value: null };
}

type PairedOrder = 'members-first' | 'where-first';

/**
 * A kind publishing one spec to two targets: `members` (crossfilter) and
 * `where` (a `Selection.single()` target in these tests), in `order`.
 */
function pairedKind(order: PairedOrder): FilterKind {
  return {
    emit: (args) => {
      const predicate = eq(args.column, literal(String(args.spec.value)));
      const members: FilterKindEmission = { target: 'members', clause: { predicate } };
      const where: FilterKindEmission = { target: 'where', clause: { predicate } };
      return order === 'members-first' ? [members, where] : [where, members];
    },
  };
}

function pairedSpec(id: string, column_: string, value: string): FilterSpec {
  return { id, column: column_, kind: 'paired', value };
}

const pairedSwim = pairedSpec('sport', 'sport', 'swim');
const pairedAda = pairedSpec('name', 'name', 'Ada');
const pairedRun = pairedSpec('id', 'id', 'run');

describe('SelectionBatch', () => {
  test('defers the emit, keeps _resolved current, and emits once with an activation clause', async () => {
    const $sel = Selection.crossfilter();
    const emits = countEmits($sel);
    const a: ClauseSource = {};
    const b: ClauseSource = {};

    const batch = new SelectionBatch();
    batch.update($sel, point(a, 'sport', 'swim'));
    batch.update($sel, point(b, 'name', 'Ada'));

    expect(emits.count).toBe(0);
    expect(sql($sel)).toEqual(['("sport" IN (\'swim\'))', '("name" IN (\'Ada\'))']);
    // The emitted state still lags until the flush.
    expect($sel.clauses).toHaveLength(0);

    batch.flush();
    await drain();
    expect(emits.count).toBe(1);
    expect($sel.clauses).toHaveLength(2);
    // A never-seen source with a null predicate: the coordinator cannot reuse
    // (or build) a pre-aggregated view for this emission.
    const active = $sel.active;
    expect(active.source).not.toBe(a);
    expect(active.source).not.toBe(b);
    expect(active.predicate).toBeNull();
    expect(active.clients).toBeUndefined();
    // `selection.value` still reports the latest written value.
    expect($sel.value).toBe('Ada');
  });

  test('every flush mints a fresh activation source', () => {
    const $sel = Selection.intersect();
    const a: ClauseSource = {};
    const first = new SelectionBatch();
    first.update($sel, point(a, 'sport', 'swim'));
    first.flush();
    const firstSource = $sel.active.source;

    const second = new SelectionBatch();
    second.update($sel, point(a, 'sport', 'run'));
    second.flush();
    expect($sel.active.source).not.toBe(firstSource);
  });

  test('a net-unchanged Selection does not emit', async () => {
    const $sel = Selection.intersect();
    const a: ClauseSource = {};
    $sel.update(point(a, 'sport', 'swim'));
    const emits = countEmits($sel);
    const existing = $sel._resolved[0]!;

    const batch = new SelectionBatch();
    batch.update($sel, { source: a, value: null, predicate: null, fields: [] });
    batch.update($sel, existing);
    batch.flush();
    await drain();

    expect(emits.count).toBe(0);
    expect(sql($sel)).toEqual(['("sport" IN (\'swim\'))']);
  });

  test('compose and cascading contexts each get one combined emission', async () => {
    const $left = Selection.intersect();
    const $right = Selection.intersect();
    const composed = createComposedSelection([$left, $right]);
    const cascading = createCascadingContexts({ left: $left, right: $right });
    const composedEmits = countEmits(composed.selection);
    const leftContextEmits = countEmits(cascading.contexts.left!);
    const rightContextEmits = countEmits(cascading.contexts.right!);

    const batch = new SelectionBatch();
    batch.update($left, point({}, 'sport', 'swim'));
    batch.update($left, point({}, 'id', '1'));
    batch.update($right, point({}, 'name', 'Ada'));
    expect(composed.selection._resolved).toHaveLength(3);
    batch.flush();
    await drain();

    expect(composedEmits.count).toBe(1);
    expect(composed.selection.clauses).toHaveLength(3);
    // Each context mirrors only its peers.
    expect(leftContextEmits.count).toBe(1);
    expect(cascading.contexts.left!.clauses).toHaveLength(1);
    expect(rightContextEmits.count).toBe(1);
    expect(cascading.contexts.right!.clauses).toHaveLength(2);
    composed.destroy();
    cascading.destroy();
  });

  test('a skip projection follows its parent once, and ignores skipped-only batches', async () => {
    const $parent = Selection.intersect();
    const projection = createSkipProjectedSelection($parent, new Set(['skipped']));
    const emits = countEmits(projection.selection);
    const kept = { id: 'kept' } as ClauseSource;
    const skipped = { id: 'skipped' } as ClauseSource;
    const other = { id: 'other' } as ClauseSource;

    const batch = new SelectionBatch();
    batch.update($parent, point(kept, 'sport', 'swim'));
    batch.update($parent, point(skipped, 'name', 'Ada'));
    batch.update($parent, point(other, 'id', '1'));
    batch.flush();
    await drain();

    expect(emits.count).toBe(1);
    expect(sql(projection.selection)).toEqual(['("sport" IN (\'swim\'))', '("id" IN (\'1\'))']);

    const skippedOnly = new SelectionBatch();
    skippedOnly.update($parent, point(skipped, 'name', 'Bo'));
    skippedOnly.flush();
    await drain();
    expect(emits.count).toBe(1);
    projection.destroy();
  });

  test('a mapped Selection cannot be deferred: it is updated (and emits) immediately', async () => {
    const $parent = Selection.intersect();
    const mapped = createMappedSelection($parent, (clause) => clause);
    const emits = countEmits(mapped.selection);
    const kept = { id: 'kept' } as ClauseSource;

    const batch = new SelectionBatch();
    batch.update($parent, point(kept, 'sport', 'swim'));
    await drain();
    expect(emits.count).toBe(1);
    expect(sql(mapped.selection)).toEqual(['("sport" IN (\'swim\'))']);

    batch.flush();
    await drain();
    // The parent's batched emission re-derives the same clause objects.
    expect(emits.count).toBe(1);
    mapped.destroy();
  });

  test('a skip projection relays kept writes to its own derived Selections', async () => {
    const $parent = Selection.intersect();
    const outer = createSkipProjectedSelection($parent, new Set(['skipped']));
    const inner = createSkipProjectedSelection(outer.selection, new Set(['other']));
    const composed = createComposedSelection([outer.selection]);
    const innerComposed = createComposedSelection([inner.selection]);
    const outerEmits = countEmits(outer.selection);
    const composedEmits = countEmits(composed.selection);
    const innerComposedEmits = countEmits(innerComposed.selection);
    const kept = { id: 'kept' } as ClauseSource;
    const skipped = { id: 'skipped' } as ClauseSource;
    const other = { id: 'other' } as ClauseSource;

    const batch = new SelectionBatch();
    batch.update($parent, point(kept, 'sport', 'swim'));
    batch.update($parent, point(skipped, 'name', 'Ada'));
    batch.update($parent, point(other, 'id', '1'));
    batch.flush();
    await drain();

    expect($parent._resolved).toHaveLength(3);
    expect(sql(outer.selection)).toEqual(['("sport" IN (\'swim\'))', '("id" IN (\'1\'))']);
    expect(sql(composed.selection)).toEqual(sql(outer.selection));
    expect(sql(inner.selection)).toEqual(['("sport" IN (\'swim\'))']);
    expect(sql(innerComposed.selection)).toEqual(sql(inner.selection));
    expect(composed.selection.clauses).toHaveLength(2);
    expect(outerEmits.count).toBe(1);
    expect(composedEmits.count).toBe(1);
    expect(innerComposedEmits.count).toBe(1);

    // A second batch keeps the chain in step.
    const second = new SelectionBatch();
    second.update($parent, point(kept, 'sport', 'run'));
    second.update($parent, point(skipped, 'name', 'Bo'));
    second.flush();
    await drain();
    expect(sql(composed.selection)).toEqual(['("id" IN (\'1\'))', '("sport" IN (\'run\'))']);
    expect(sql(innerComposed.selection)).toEqual(['("sport" IN (\'run\'))']);
    expect(composedEmits.count).toBe(2);
    expect(innerComposedEmits.count).toBe(2);

    innerComposed.destroy();
    composed.destroy();
    inner.destroy();
    outer.destroy();
  });

  test('a reset reaches a skip projection and its derived Selections once', async () => {
    const $parent = Selection.intersect();
    const projection = createSkipProjectedSelection($parent, new Set(['skipped']));
    const composed = createComposedSelection([projection.selection]);
    $parent.update(point({ id: 'kept' } as ClauseSource, 'sport', 'swim'));
    $parent.update(point({ id: 'skipped' } as ClauseSource, 'name', 'Ada'));
    await drain();
    expect(composed.selection._resolved).toHaveLength(1);
    const projectionEmits = countEmits(projection.selection);
    const composedEmits = countEmits(composed.selection);

    const batch = new SelectionBatch();
    batch.reset($parent);
    expect(projection.selection._resolved).toHaveLength(0);
    expect(composed.selection._resolved).toHaveLength(0);
    batch.flush();
    await drain();

    expect(projectionEmits.count).toBe(1);
    expect(composedEmits.count).toBe(1);
    expect(composed.selection.clauses).toHaveLength(0);
    composed.destroy();
    projection.destroy();
  });

  test('older queued parent deliveries do not overwrite a skip projection after a batch', async () => {
    const $parent = Selection.crossfilter();
    const projection = createSkipProjectedSelection($parent, new Set(['skipped']));
    const composed = createComposedSelection([projection.selection]);
    // Hold the parent's first delivery (as a re-querying client does), so the
    // next ordinary update and the batched emission queue behind it.
    let release: (() => void) | undefined;
    $parent.addEventListener('value', () => {
      if (release !== undefined) {
        return undefined;
      }
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const sport = { id: 'sport' } as ClauseSource;
    const name = { id: 'name' } as ClauseSource;
    $parent.update(point(sport, 'sport', 'run'));
    $parent.update(point(name, 'name', 'Bo'));
    expect(sql(projection.selection)).toEqual(['("sport" IN (\'run\'))', '("name" IN (\'Bo\'))']);
    await drain();
    const projectionStates: Array<Array<string>> = [];
    projection.selection.addEventListener('value', () => {
      projectionStates.push(sql(projection.selection));
    });
    const composedEmits = countEmits(composed.selection);

    const batch = new SelectionBatch();
    batch.reset($parent);
    batch.update($parent, point(sport, 'sport', 'swim'));
    batch.flush();
    await drain();
    const final = ['("sport" IN (\'swim\'))'];
    expect(projectionStates).toEqual([final]);

    release?.();
    await drain();
    await $parent.pending('value');
    await drain();

    expect($parent.clauses).toBe($parent._resolved);
    expect(sql(projection.selection)).toEqual(final);
    expect(projection.selection.clauses).toBe(projection.selection._resolved);
    expect(projectionStates).toEqual([final]);
    expect(sql(composed.selection)).toEqual(final);
    expect(composedEmits.count).toBe(1);
    composed.destroy();
    projection.destroy();
  });

  test('a Selection subclass overriding update is written immediately', () => {
    class Tracking extends Selection {
      override update(clause: SelectionClause): this {
        return super.update(clause);
      }
    }
    const $sel = new Tracking();
    const emits = countEmits($sel);

    const batch = new SelectionBatch();
    batch.update($sel, point({}, 'sport', 'swim'));
    expect(emits.count).toBe(1);
    batch.flush();
    expect(emits.count).toBe(1);
  });

  test('reset invokes each source reset, relays, and emits once', async () => {
    const $sel = Selection.intersect();
    const composed = createComposedSelection([$sel]);
    const reset = vi.fn();
    const source: ClauseSource = { reset };
    $sel.update(point(source, 'sport', 'swim'));
    $sel.update(point({}, 'name', 'Ada'));
    await drain();
    const emits = countEmits($sel);
    const composedEmits = countEmits(composed.selection);

    const batch = new SelectionBatch();
    batch.reset($sel);
    expect($sel._resolved).toHaveLength(0);
    expect(composed.selection._resolved).toHaveLength(0);
    batch.flush();
    await drain();

    expect(reset).toHaveBeenCalled();
    expect(emits.count).toBe(1);
    expect(composedEmits.count).toBe(1);
    expect($sel.clauses).toHaveLength(0);
    composed.destroy();
  });

  test('writes after the flush apply immediately', () => {
    const $sel = Selection.intersect();
    const emits = countEmits($sel);
    const batch = new SelectionBatch();
    batch.flush();
    batch.update($sel, point({}, 'sport', 'swim'));
    expect(emits.count).toBe(1);
  });

  test('reset tolerates a clause without a source, as upstream does', () => {
    const $sel = Selection.intersect();
    const sourceless = { ...point({}, 'sport', 'swim'), source: undefined };
    // Hand-built clause that violates the declared type, as upstream allows.
    $sel._resolved = [sourceless as unknown as SelectionClause];
    const batch = new SelectionBatch();
    expect(() => {
      batch.reset($sel);
    }).not.toThrow();
    batch.flush();
    expect($sel.clauses).toHaveLength(0);
  });
});

describe('filterSet.batch', () => {
  test('several writes: one emit per target, one store sync, one persist write', async () => {
    const $where = Selection.crossfilter();
    const { persister, writes } = recordingPersister();
    const set = createFilterSet({ targets: { where: $where }, persist: persister });
    set.set(swim);
    await drain();
    writes.length = 0;
    const emits = countEmits($where);
    let syncs = 0;
    const unsubscribe = set.store.subscribe(() => {
      syncs += 1;
    });

    set.batch((tx) => {
      tx.remove('sport');
      tx.set(ada);
      tx.set(heavy);
      // Resolved clauses are current inside the batch; the store is not.
      expect($where._resolved).toHaveLength(2);
      expect(set.store.state.specs.map((spec) => spec.id)).toEqual(['sport']);
    });
    await drain();

    expect(emits.count).toBe(1);
    expect(syncs).toBe(1);
    expect(set.store.state.specs.map((spec) => spec.id)).toEqual(['name', 'weight']);
    expect(writes).toEqual([{ state: [ada, heavy], reason: 'update' }]);
    unsubscribe.unsubscribe();
    set.destroy();
  });

  test('outside a batch a write still emits immediately with its own clause active', () => {
    const $where = Selection.intersect();
    const set = createFilterSet({ targets: { where: $where } });
    const emits = countEmits($where);
    set.set(swim);
    expect(emits.count).toBe(1);
    expect($where.active).toBe($where._resolved[0]);
    set.destroy();
  });

  test('a batch that empties the set writes (null, clear) once', () => {
    const $where = Selection.intersect();
    const { persister, writes } = recordingPersister();
    const set = createFilterSet({ targets: { where: $where }, persist: persister });
    set.set(swim);
    set.set(ada);
    writes.length = 0;

    set.batch((tx) => {
      tx.remove('sport');
      tx.remove('name');
    });
    expect(writes).toEqual([{ state: null, reason: 'clear' }]);
    set.destroy();
  });

  test('reset({ keep }) and a set combine into one update', async () => {
    const $where = Selection.intersect();
    const set = createFilterSet({ targets: { where: $where } });
    set.set(swim);
    set.set(ada);
    await drain();
    const emits = countEmits($where);

    set.batch((tx) => {
      tx.reset({ keep: (spec) => spec.id === 'sport' });
      tx.set(heavy);
    });
    await drain();

    expect(emits.count).toBe(1);
    expect(set.store.state.specs.map((spec) => spec.id)).toEqual(['sport', 'weight']);
    set.destroy();
  });

  test('a nested batch flushes once, at the outer end', async () => {
    const $where = Selection.intersect();
    const set = createFilterSet({ targets: { where: $where } });
    const emits = countEmits($where);

    set.batch((tx) => {
      tx.set(swim);
      set.batch((inner) => {
        inner.set(ada);
      });
      expect(emits.count).toBe(0);
      // The set's own mutators are batched too.
      set.set(heavy);
    });
    await drain();

    expect(emits.count).toBe(1);
    expect($where.clauses).toHaveLength(3);
    set.destroy();
  });

  test('a throwing callback still applies and emits earlier writes, then rethrows', async () => {
    const $where = Selection.intersect();
    const set = createFilterSet({ targets: { where: $where } });
    const emits = countEmits($where);

    expect(() => {
      set.batch((tx) => {
        tx.set(swim);
        throw new Error('boom');
      });
    }).toThrow('boom');

    expect(emits.count).toBe(1);
    expect(set.store.state.specs.map((spec) => spec.id)).toEqual(['sport']);
    // The batch is closed: later writes are immediate again.
    await drain();
    set.set(ada);
    expect(emits.count).toBe(2);
    set.destroy();
  });

  test('a callback error wins over a listener error thrown while closing', () => {
    const $where = Selection.intersect();
    const set = createFilterSet({ targets: { where: $where } });
    $where.addEventListener('value', () => {
      throw new Error('listener');
    });

    expect(() => {
      set.batch((tx) => {
        tx.set(swim);
        throw new Error('callback');
      });
    }).toThrow('callback');
    expect($where.clauses).toHaveLength(1);
    set.destroy({ silent: true });
  });

  test('a batch does not trip the external-clear listener', async () => {
    const $where = Selection.crossfilter();
    const set = createFilterSet({ targets: { where: $where } });
    set.set(swim);

    set.batch((tx) => {
      tx.set({ ...swim, value: 'run' });
      tx.set(ada);
    });
    await drain();

    expect(set.store.state.specs.map((spec) => spec.id)).toEqual(['sport', 'name']);
    expect($where.clauses).toHaveLength(2);
    set.destroy();
  });

  describe('a Selection.single() target', () => {
    /**
     * A single resolver keeps only the latest clause, so the batched emission
     * drops the earlier spec's clause. The set's external-clear listener sees
     * that drop when the batch emits (or later, when Mosaic queued the
     * emission); its store sync and persist write must fold into the batch's
     * one each.
     */
    async function runSingleTargetBatch(options: { pendingDispatch: boolean }): Promise<{
      syncs: number;
      writes: Array<{ state: Array<FilterSpec> | null; reason: string }>;
      emits: number;
      specIds: Array<string>;
    }> {
      const $where = Selection.single();
      const { persister, writes } = recordingPersister();
      const set = createFilterSet({ targets: { where: $where }, persist: persister });
      if (options.pendingDispatch) {
        // An earlier write whose dispatch is still settling: the batched
        // emission is queued behind it and its listeners run after the batch.
        set.set(heavy);
      }
      writes.length = 0;
      const emits = countEmits($where);
      let syncs = 0;
      const unsubscribe = set.store.subscribe(() => {
        syncs += 1;
      });

      set.batch((tx) => {
        tx.set(swim);
        tx.set(ada);
      });
      await drain();

      const result = {
        syncs,
        writes: [...writes],
        emits: emits.count,
        specIds: set.store.state.specs.map((spec) => spec.id),
      };
      unsubscribe.unsubscribe();
      set.destroy();
      return result;
    }

    test('two sets for different specs sync the store and persist once', async () => {
      const result = await runSingleTargetBatch({ pendingDispatch: false });

      expect(result.emits).toBe(1);
      expect(result.syncs).toBe(1);
      // The single resolver dropped `sport`; the set mirrors it.
      expect(result.specIds).toEqual(['name']);
      expect(result.writes).toEqual([{ state: [ada], reason: 'update' }]);
    });

    test('still once each when Mosaic queues the batched emission', async () => {
      const result = await runSingleTargetBatch({ pendingDispatch: true });

      expect(result.syncs).toBe(1);
      expect(result.specIds).toEqual(['name']);
      expect(result.writes).toEqual([{ state: [ada], reason: 'update' }]);
    });

    test('outside a batch the external-clear behaviour is unchanged', async () => {
      const $where = Selection.single();
      const { persister, writes } = recordingPersister();
      const set = createFilterSet({ targets: { where: $where }, persist: persister });
      let syncs = 0;
      const unsubscribe = set.store.subscribe(() => {
        syncs += 1;
      });

      set.set(swim);
      set.set(ada);
      await drain();

      // Each write syncs and persists; the second emission (queued behind the
      // first) reaches the listener unfenced and drops `sport` externally.
      expect(syncs).toBe(3);
      expect(writes.map((write) => write.reason)).toEqual(['update', 'update', 'external']);
      expect(set.store.state.specs.map((spec) => spec.id)).toEqual(['name']);
      unsubscribe.unsubscribe();
      set.destroy();
    });

    test('an external clear the batch picks up first is persisted as external', async () => {
      const $where = Selection.single();
      const { persister, writes } = recordingPersister();
      const set = createFilterSet({ targets: { where: $where }, persist: persister });
      // Hold the first delivery, so the external clear below stays queued.
      let release: (() => void) | undefined;
      $where.addEventListener('value', () => {
        if (release !== undefined) {
          return undefined;
        }
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      });
      set.set(swim);
      const source = $where._resolved[0]!.source;
      $where.update({ source, value: null, predicate: null, fields: [] } as SelectionClause);
      writes.length = 0;

      // No writes: the batch's settle notices the dropped clause before Mosaic
      // delivers it, and the set ends up empty.
      set.batch(() => {});
      expect(set.store.state.specs).toEqual([]);
      expect(writes).toEqual([{ state: null, reason: 'external' }]);

      release?.();
      await drain();
      await $where.pending('value');
      expect(writes).toHaveLength(1);
      set.destroy();
    });

    describe('with a skip projection that skips the later spec', () => {
      interface ProjectionRun {
        where: Array<string>;
        projection: Array<string>;
        /** An intersect Selection composed from the projection. */
        composed: Array<string>;
        /** A single Selection including the projection. */
        included: Array<string>;
        /** The emitted (`clauses`) lists, which is what clients query. */
        emitted: Array<Array<string>>;
        emits: { projection: number; composed: number; included: number };
        specIds: Array<string>;
      }

      /**
       * `sport` (kept) and then `name` (skipped) on a single target: the
       * target ends up with `name` alone, so the projection and everything
       * derived from it must end up with no clause. `before` is written,
       * unbatched, ahead of the measured writes.
       */
      async function runProjection(options: {
        batched: boolean;
        before: Array<FilterSpec>;
        writes: Array<FilterSpec>;
      }): Promise<ProjectionRun> {
        const $where = Selection.single();
        const set = createFilterSet({ targets: { where: $where } });
        const projection = createSkipProjectedSelection($where, new Set(['name']));
        const composed = createComposedSelection([projection.selection]);
        const included = Selection.single({ include: projection.selection });
        for (const spec of options.before) {
          set.set(spec);
        }
        await drain();
        const projectionEmits = countEmits(projection.selection);
        const composedEmits = countEmits(composed.selection);
        const includedEmits = countEmits(included);

        if (options.batched) {
          set.batch((tx) => {
            for (const spec of options.writes) {
              tx.set(spec);
            }
          });
        } else {
          for (const spec of options.writes) {
            set.set(spec);
          }
        }
        await drain();
        await drain();

        const emittedSql = (selection: Selection) =>
          selection.clauses.map((clause) => String(clause.predicate));
        const result: ProjectionRun = {
          where: sql($where),
          projection: sql(projection.selection),
          composed: sql(composed.selection),
          included: sql(included),
          emitted: [projection.selection, composed.selection, included].map(emittedSql),
          emits: {
            projection: projectionEmits.count,
            composed: composedEmits.count,
            included: includedEmits.count,
          },
          specIds: set.store.state.specs.map((spec) => spec.id),
        };
        composed.destroy();
        projection.destroy();
        set.destroy();
        return result;
      }

      test('a skipped write drops the kept clause it displaced from derived Selections', async () => {
        const result = await runProjection({ batched: true, before: [], writes: [swim, ada] });

        expect(result.where).toEqual(['("name" IN (\'Ada\'))']);
        expect(result.specIds).toEqual(['name']);
        expect(result.projection).toEqual([]);
        expect(result.composed).toEqual([]);
        expect(result.included).toEqual([]);
        expect(result.emitted).toEqual([[], [], []]);
        // Each started and ended the batch with no clause: nothing to emit.
        expect(result.emits).toEqual({ projection: 0, composed: 0, included: 0 });
      });

      test('a kept clause from before the batch is dropped with one emission each', async () => {
        const result = await runProjection({ batched: true, before: [swim], writes: [ada] });

        expect(result.where).toEqual(['("name" IN (\'Ada\'))']);
        expect(result.specIds).toEqual(['name']);
        expect(result.projection).toEqual([]);
        expect(result.composed).toEqual([]);
        expect(result.included).toEqual([]);
        expect(result.emitted).toEqual([[], [], []]);
        expect(result.emits).toEqual({ projection: 1, composed: 1, included: 1 });
      });

      test('the Selections end in the same state as the same writes without a batch', async () => {
        for (const before of [[], [swim]]) {
          const writes = before.length === 0 ? [swim, ada] : [ada];
          const batched = await runProjection({ batched: true, before, writes });
          const plain = await runProjection({ batched: false, before, writes });

          expect(batched.where).toEqual(plain.where);
          expect(batched.projection).toEqual(plain.projection);
          expect(batched.composed).toEqual(plain.composed);
          expect(batched.included).toEqual(plain.included);
          expect(batched.emitted).toEqual(plain.emitted);
          // Not `specIds`: without a batch the set notices the displaced spec
          // only once a target emission reaches it unfenced, which a lone
          // synchronous write's own emission does not.
        }
      });
    });
  });

  describe('a single target next to a sibling target of the same spec', () => {
    interface PairedRun {
      whereEmits: number;
      membersEmits: number;
      pageEmits: number;
      syncs: number;
      writes: Array<{ state: Array<FilterSpec> | null; reason: string }>;
      specIds: Array<string>;
      where: Array<string>;
      members: Array<string>;
      /** The derived context's emitted clauses (what its clients query). */
      page: Array<string>;
      membersActivePredicate: unknown;
      /** Whether `members.active` is one of the set's own clauses. */
      membersActiveOwned: boolean;
    }

    /**
     * Two specs of a kind publishing to `members` (crossfilter) and `where`
     * (single). The second write displaces the first spec's `where` clause,
     * so the set drops the first spec and clears its `members` clause. In a
     * batch that clear must land inside the batch: each Selection emits once,
     * with the state the same writes reach without a batch.
     */
    async function runPaired(options: {
      order: PairedOrder;
      pendingDispatch: boolean;
      batched: boolean;
    }): Promise<PairedRun> {
      const $where = Selection.single();
      const $members = Selection.crossfilter();
      const composed = createComposedSelection([$where, $members]);
      const { persister, writes } = recordingPersister();
      const set = createFilterSet({
        targets: { where: $where, members: $members },
        kinds: { paired: pairedKind(options.order) },
        persist: persister,
      });
      if (options.pendingDispatch) {
        // An unbatched write still dispatching on both targets: the batched
        // emissions are queued behind it.
        set.set(pairedRun);
      }
      writes.length = 0;
      const whereEmits = countEmits($where);
      const membersEmits = countEmits($members);
      const pageEmits = countEmits(composed.selection);
      let syncs = 0;
      const unsubscribe = set.store.subscribe(() => {
        syncs += 1;
      });

      if (options.batched) {
        set.batch((tx) => {
          tx.set(pairedSwim);
          tx.set(pairedAda);
        });
      } else {
        set.set(pairedSwim);
        set.set(pairedAda);
      }
      await drain();

      const run: PairedRun = {
        whereEmits: whereEmits.count,
        membersEmits: membersEmits.count,
        pageEmits: pageEmits.count,
        syncs,
        writes: [...writes],
        specIds: set.store.state.specs.map((spec) => spec.id),
        where: $where.clauses.map((clause) => String(clause.predicate)),
        members: $members.clauses.map((clause) => String(clause.predicate)),
        page: composed.selection.clauses.map((clause) => String(clause.predicate)).sort(),
        membersActivePredicate: $members.active.predicate,
        membersActiveOwned: set.ownsClauseSource($members.active.source),
      };
      unsubscribe.unsubscribe();
      set.destroy();
      composed.destroy();
      return run;
    }

    test.each([
      { order: 'members-first' as const, pendingDispatch: false },
      { order: 'where-first' as const, pendingDispatch: false },
      { order: 'members-first' as const, pendingDispatch: true },
      { order: 'where-first' as const, pendingDispatch: true },
    ])(
      '$order, pending dispatch $pendingDispatch: each Selection emits once with the final state',
      async ({ order, pendingDispatch }) => {
        const batched = await runPaired({ order, pendingDispatch, batched: true });
        const unbatched = await runPaired({ order, pendingDispatch, batched: false });

        expect(batched.whereEmits).toBe(1);
        expect(batched.membersEmits).toBe(1);
        expect(batched.pageEmits).toBe(1);
        // The emitted clauses (what clients query) match the unbatched result.
        expect(batched.where).toEqual(['("name" = \'Ada\')']);
        expect(batched.members).toEqual(['("name" = \'Ada\')']);
        expect(batched.where).toEqual(unbatched.where);
        expect(batched.members).toEqual(unbatched.members);
        expect(batched.page).toEqual(unbatched.page);
        // Emitted with the synthetic active clause, not a clear clause of the
        // dropped spec (which would let pre-aggregation reuse a stale view).
        expect(batched.membersActivePredicate).toBeNull();
        expect(batched.membersActiveOwned).toBe(false);
        expect(batched.syncs).toBe(1);
        expect(batched.specIds).toEqual(['name']);
        expect(batched.specIds).toEqual(unbatched.specIds);
        expect(batched.writes).toEqual([{ state: [pairedAda], reason: 'update' }]);
      },
    );
  });

  test('a destroyed set runs the callback without writing', () => {
    const $where = Selection.intersect();
    const set = createFilterSet({ targets: { where: $where } });
    set.destroy();
    const callback = vi.fn((tx: { set: (spec: FilterSpec) => void }) => {
      tx.set(swim);
    });

    set.batch(callback);
    expect(callback).toHaveBeenCalledTimes(1);
    expect($where._resolved).toHaveLength(0);
  });

  test('a context-dependent spec written before its siblings is rebuilt inside the batch', async () => {
    const $where = Selection.intersect();
    const $members = Selection.intersect();
    const set = createFilterSet({
      targets: { where: $where, members: $members },
      kinds: { membership },
      context: $where,
    });
    const memberEmits = countEmits($members);

    set.batch((tx) => {
      tx.set({ id: 'sq', column: 'id', kind: 'membership', value: null, target: 'members' });
      tx.set(swim);
    });

    // One emission, already carrying the sibling `sport` clause.
    expect(memberEmits.count).toBe(1);
    expect(sql($members)[0]).toContain('"sport"');
    // The post-batch context rebuild finds nothing left to change.
    await drain();
    expect(memberEmits.count).toBe(1);
    set.destroy();
  });
});

describe('batch members', () => {
  test('chained contexts reach the final state whatever order the sets joined in', async () => {
    const $c = Selection.intersect();
    const $b = Selection.intersect();
    const $a = Selection.intersect();
    const c = createFilterSet({ targets: { where: $c } });
    const b = createFilterSet({ targets: { where: $b }, kinds: { membership }, context: $c });
    const a = createFilterSet({ targets: { where: $a }, kinds: { membership }, context: $b });
    b.set(memberSpec('bsq'));
    a.set(memberSpec('asq'));
    await drain();
    const aEmits = countEmits($a);

    const batch = openSelectionBatch();
    // `a` joins (and so settles) first, before `b` has rebuilt against `c`.
    joinFilterSetBatch(a, batch);
    joinFilterSetBatch(b, batch);
    joinFilterSetBatch(c, batch);
    runInBatch(batch, () => {
      c.set(swim);
      b.set(ada);
    });

    // One emission, already carrying c's filter (through b's subquery).
    expect(aEmits.count).toBe(1);
    expect(sql($a)[0]).toContain('"sport"');
    expect(sql($a)[0]).toContain('"name"');
    // The post-batch context rebuilds find nothing left to change.
    await drain();
    expect(aEmits.count).toBe(1);
    a.destroy();
    b.destroy();
    c.destroy();
  });

  test('a batch that is open blocks opening another until it closes', () => {
    const batch = openSelectionBatch();
    expect(() => openSelectionBatch()).toThrow(NESTED_BATCH_ERROR_MESSAGE);
    batch.close();
    const next = openSelectionBatch();
    next.close();
  });

  test('a filter kind cannot open another batch while the members settle', async () => {
    // `a` and `b` share a crossfilter Selection. `a`'s context-dependent spec
    // is rebuilt while the batch settles; its kind tries to open a batch on
    // `b` from there. That batch would flush first and emit `$shared` with
    // `a`'s pre-settle state, so it must be rejected.
    const $shared = Selection.crossfilter();
    const $members = Selection.intersect();
    const innerCallback = vi.fn();
    const attempt: { armed: boolean; error: unknown } = { armed: false, error: undefined };
    let b: FilterSet | null = null;
    const sneaky = subqueryFilterKind((args) => {
      if (attempt.armed && b !== null) {
        attempt.armed = false;
        const other = b;
        try {
          other.batch((tx) => {
            innerCallback();
            tx.set(ada);
          });
        } catch (error) {
          attempt.error = error;
        }
      }
      const query = Query.from('athletes').select('id');
      if (args.contextPredicate != null) {
        query.where(args.contextPredicate);
      }
      return query;
    });
    const a = createFilterSet({
      targets: { where: $shared, members: $members },
      kinds: { sneaky },
      context: $shared,
    });
    b = createFilterSet({ targets: { where: $shared } });
    const sharedValues: Array<Array<string>> = [];
    $shared.addEventListener('value', () => {
      sharedValues.push(sql($shared));
    });
    const memberEmits = countEmits($members);

    a.batch((tx) => {
      tx.set({ id: 'sq', column: 'id', kind: 'sneaky', value: null, target: 'members' });
      // The next build of `sneaky` is the settle-time rebuild.
      attempt.armed = true;
      tx.set(swim);
    });

    expect(innerCallback).not.toHaveBeenCalled();
    expect(attempt.error).toBeInstanceOf(Error);
    expect((attempt.error as Error).message).toBe(NESTED_BATCH_ERROR_MESSAGE);
    // The outer batch still flushed its writes, once each, with the settled
    // context-dependent predicate.
    expect(sharedValues).toHaveLength(1);
    expect(sharedValues[0]).toHaveLength(1);
    expect(sharedValues[0]?.[0]).toContain('"sport"');
    expect(memberEmits.count).toBe(1);
    expect(sql($members)[0]).toContain('"sport"');
    await drain();
    expect(sharedValues).toHaveLength(1);
    expect(memberEmits.count).toBe(1);
    // The batch released its registration: new batches open normally.
    b.batch((tx) => {
      tx.set(ada);
    });
    expect(sql($shared).some((predicate) => predicate.includes('"name"'))).toBe(true);
    a.destroy();
    b.destroy();
  });

  test('a value listener cannot open another batch while the batch flushes', async () => {
    const $where = Selection.intersect();
    const $other = Selection.intersect();
    const a = createFilterSet({ targets: { where: $where } });
    const b = createFilterSet({ targets: { where: $other } });
    const innerCallback = vi.fn();
    const errors: Array<unknown> = [];
    $where.addEventListener('value', () => {
      try {
        b.batch(innerCallback);
      } catch (error) {
        errors.push(error);
      }
    });

    a.batch((tx) => {
      tx.set(swim);
    });

    expect(innerCallback).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
    // The message is exported from the package entry for programmatic checks.
    expect(PUBLIC_NESTED_BATCH_ERROR_MESSAGE).toBe(NESTED_BATCH_ERROR_MESSAGE);
    expect((errors[0] as Error).message).toBe(PUBLIC_NESTED_BATCH_ERROR_MESSAGE);
    expect(sql($where)).toHaveLength(1);
    await drain();
    // Released after the flush: on an unbatched write the same listener
    // opens its batch.
    a.set(ada);
    expect(innerCallback).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(1);
    a.destroy();
    b.destroy();
  });

  test('a batch releases its registration when settling and the flush throw', () => {
    const batch = openSelectionBatch();
    const commit = vi.fn();
    batch.join({
      settle: () => {
        throw new Error('settle failed');
      },
      detach: () => {},
      commit,
    });
    expect(() => {
      batch.close();
    }).toThrow('settle failed');
    expect(commit).toHaveBeenCalledTimes(1);
    const next = openSelectionBatch();
    next.close();
  });

  test('a filter kind calling batch() on its own set while it settles joins the batch', () => {
    const $shared = Selection.crossfilter();
    const $members = Selection.intersect();
    const innerCallback = vi.fn();
    const attempt: { armed: boolean; error: unknown } = { armed: false, error: undefined };
    let self: FilterSet | null = null;
    const reentrant = subqueryFilterKind((args) => {
      if (attempt.armed && self !== null) {
        attempt.armed = false;
        try {
          self.batch(innerCallback);
        } catch (error) {
          attempt.error = error;
        }
      }
      const query = Query.from('athletes').select('id');
      if (args.contextPredicate != null) {
        query.where(args.contextPredicate);
      }
      return query;
    });
    const set = createFilterSet({
      targets: { where: $shared, members: $members },
      kinds: { reentrant },
      context: $shared,
    });
    self = set;
    const sharedEmits = countEmits($shared);
    const memberEmits = countEmits($members);

    set.batch((tx) => {
      tx.set({ id: 'rq', column: 'id', kind: 'reentrant', value: null, target: 'members' });
      // The next build of `reentrant` is the settle-time rebuild.
      attempt.armed = true;
      tx.set(swim);
    });

    // The set is still writing into the open batch, so its batch() runs the
    // callback inline instead of throwing.
    expect(attempt.error).toBeUndefined();
    expect(innerCallback).toHaveBeenCalledTimes(1);
    expect(sharedEmits.count).toBe(1);
    expect(memberEmits.count).toBe(1);
    set.destroy();
  });

  test('a write a skip projection drops does not cost the settle loop a round', () => {
    const $parent = Selection.intersect();
    const projection = createSkipProjectedSelection($parent, new Set(['skipped']));
    const skipped = { id: 'skipped' } as ClauseSource;
    const batch = openSelectionBatch();
    let rounds = 0;
    batch.join({
      settle: () => {
        rounds += 1;
        batch.update(projection.selection, point(skipped, 'name', 'Ada'));
      },
      detach: () => {},
      commit: () => {},
    });

    batch.close();

    expect(rounds).toBe(1);
    expect(projection.selection._resolved).toHaveLength(0);
    projection.destroy();
  });
});

describe('topology.batch', () => {
  test('two filter sets, a compose and cascading contexts: one emission each', async () => {
    const topology = createTopology({
      left: { type: 'filter-set', targets: { where: 'crossfilter' } },
      right: { type: 'filter-set', targets: { where: 'intersect' } },
      page: { type: 'compose', include: ['left.where', 'right.where'] },
      peers: { type: 'cascading', keys: ['brush', 'chips'] },
      brush: { type: 'intersect' },
      chips: { type: 'intersect' },
    });
    const left = topology.getFilterSet('left')!;
    const right = topology.getFilterSet('right')!;
    const page = countEmits(topology.resolve('page'));
    const leftWhere = countEmits(topology.resolve('left.where'));
    const rightWhere = countEmits(topology.resolve('right.where'));
    let leftSyncs = 0;
    const unsubscribe = left.store.subscribe(() => {
      leftSyncs += 1;
    });

    topology.batch(() => {
      left.set(swim);
      left.set(heavy);
      right.set(ada);
      // A nested filterSet.batch joins the topology batch.
      right.batch((tx) => {
        tx.set({ id: 'id', column: 'id', kind: 'point', value: '1' });
      });
    });
    await drain();

    expect(page.count).toBe(1);
    expect(leftWhere.count).toBe(1);
    expect(rightWhere.count).toBe(1);
    expect(leftSyncs).toBe(1);
    expect(topology.resolve('page').clauses).toHaveLength(4);
    unsubscribe.unsubscribe();
    topology.destroy();
  });

  test('reset() and filter-set writes inside a batch emit once per Selection', async () => {
    const topology = createTopology({
      brush: { type: 'crossfilter' },
      filters: { type: 'filter-set', targets: { where: 'intersect' } },
      page: { type: 'compose', include: ['brush', 'filters.where'] },
    });
    const $brush = topology.resolve('brush');
    const sourceReset = vi.fn();
    $brush.update(point({ reset: sourceReset }, 'sport', 'swim'));
    const filters = topology.getFilterSet('filters')!;
    filters.set(ada);
    await drain();
    const brush = countEmits($brush);
    const page = countEmits(topology.resolve('page'));
    const where = countEmits(topology.resolve('filters.where'));

    topology.batch(() => {
      topology.reset();
      filters.set(heavy);
    });
    await drain();

    expect(sourceReset).toHaveBeenCalled();
    expect(brush.count).toBe(1);
    expect(where.count).toBe(1);
    expect(page.count).toBe(1);
    expect(sql(topology.resolve('page'))).toEqual(['("weight" BETWEEN 60 AND 90)']);
    expect(filters.store.state.specs.map((spec) => spec.id)).toEqual(['weight']);
    topology.destroy();
  });

  test('a single target dropping an earlier spec still syncs and persists the set once', async () => {
    const { persister, writes } = recordingPersister();
    const topology = createTopology(
      { filters: { type: 'filter-set', targets: { where: 'single' } } },
      { filterSets: { filters: { persist: persister } } },
    );
    const filters = topology.getFilterSet('filters')!;
    let syncs = 0;
    const unsubscribe = filters.store.subscribe(() => {
      syncs += 1;
    });

    topology.batch(() => {
      filters.set(swim);
      filters.set(ada);
    });
    await drain();

    expect(syncs).toBe(1);
    expect(filters.store.state.specs.map((spec) => spec.id)).toEqual(['name']);
    expect(writes).toEqual([{ state: [ada], reason: 'update' }]);
    unsubscribe.unsubscribe();
    topology.destroy();
  });

  test.each(['members-first', 'where-first'] as const)(
    'a single target dropping a spec clears its sibling clause inside the batch (%s)',
    async (order) => {
      const { persister, writes } = recordingPersister();
      const topology = createTopology(
        {
          filters: { type: 'filter-set', targets: { where: 'single', members: 'crossfilter' } },
          page: { type: 'compose', include: ['filters.where', 'filters.members'] },
          // Reads `page` as its context, so its membership subquery is rebuilt
          // from the derived context's final state.
          peers: { type: 'filter-set', targets: { where: 'intersect' }, context: 'page' },
        },
        {
          filterSets: {
            filters: { kinds: { paired: pairedKind(order) }, persist: persister },
            peers: { kinds: { membership } },
          },
        },
      );
      const filters = topology.getFilterSet('filters')!;
      const peers = topology.getFilterSet('peers')!;
      peers.set(memberSpec('peer'));
      await drain();
      const members = countEmits(topology.resolve('filters.members'));
      const page = countEmits(topology.resolve('page'));
      const peersWhere = countEmits(topology.resolve('peers.where'));
      let syncs = 0;
      const unsubscribe = filters.store.subscribe(() => {
        syncs += 1;
      });

      topology.batch(() => {
        filters.set(pairedSwim);
        filters.set(pairedAda);
      });
      await drain();

      expect(members.count).toBe(1);
      expect(page.count).toBe(1);
      expect(peersWhere.count).toBe(1);
      expect(sql(topology.resolve('filters.members'))).toEqual(['("name" = \'Ada\')']);
      // The dropped spec's `members` clause left `page` inside the batch, so
      // `peers` was rebuilt from the final context before anything emitted.
      const pageMembers = topology
        .resolve('page')
        .clauses.filter((clause) => (clause.source as { target?: string }).target === 'members')
        .map((clause) => String(clause.predicate));
      expect(pageMembers).toEqual(['("name" = \'Ada\')']);
      expect(sql(topology.resolve('peers.where'))[0]).toContain('"name"');
      expect(syncs).toBe(1);
      expect(filters.store.state.specs.map((spec) => spec.id)).toEqual(['name']);
      expect(writes).toEqual([{ state: [pairedAda], reason: 'update' }]);
      unsubscribe.unsubscribe();
      topology.destroy();
    },
  );

  test('activeClauses refreshes once, after the batch', () => {
    const topology = createTopology({
      brush: { type: 'intersect' },
      filters: { type: 'filter-set', targets: { where: 'intersect' } },
    });
    let refreshes = 0;
    const unsubscribe = topology.activeClauses.subscribe(() => {
      refreshes += 1;
    });

    topology.batch(() => {
      topology.reset();
      topology.getFilterSet('filters')!.set(swim);
      topology.getFilterSet('filters')!.set(ada);
    });

    expect(refreshes).toBe(1);
    unsubscribe.unsubscribe();
    topology.destroy();
  });

  test('topology.batch inside an owned filterSet.batch throws; the outer batch still emits once', async () => {
    const topology = createTopology({
      a: { type: 'filter-set', targets: { where: 'intersect' } },
      b: { type: 'filter-set', targets: { where: 'intersect' } },
      page: { type: 'compose', include: ['a.where', 'b.where'] },
    });
    const a = topology.getFilterSet('a')!;
    const b = topology.getFilterSet('b')!;
    const page = countEmits(topology.resolve('page'));
    const inner = vi.fn(() => {
      b.set(ada);
    });

    expect(() => {
      a.batch((tx) => {
        tx.set(swim);
        topology.batch(inner);
      });
    }).toThrow(NESTED_BATCH_ERROR_MESSAGE);
    await drain();

    expect(inner).not.toHaveBeenCalled();
    // a's batch closed normally: its write emitted once.
    expect(page.count).toBe(1);
    expect(sql(topology.resolve('page'))).toEqual(['("sport" IN (\'swim\'))']);
    // Nothing is left open: a fresh topology batch works.
    topology.batch(() => {
      b.set(ada);
    });
    await drain();
    expect(page.count).toBe(2);
    topology.destroy();
  });

  test('a filterSet.batch on another set inside a filterSet.batch throws', async () => {
    const $where = Selection.intersect();
    const a = createFilterSet({ targets: { where: $where } });
    const b = createFilterSet({ targets: { where: $where } });
    const emits = countEmits($where);

    expect(() => {
      a.batch((tx) => {
        tx.set(swim);
        b.batch((inner) => {
          inner.set(ada);
        });
      });
    }).toThrow(NESTED_BATCH_ERROR_MESSAGE);
    await drain();

    expect(emits.count).toBe(1);
    expect(b.store.state.specs).toEqual([]);
    a.destroy();
    b.destroy();
  });

  test('a batch on a set or topology outside this topology throws inside topology.batch', () => {
    const topology = createTopology({
      a: { type: 'filter-set', targets: { where: 'intersect' } },
    });
    const other = createTopology({
      b: { type: 'filter-set', targets: { where: 'intersect' } },
    });
    const standalone = createFilterSet({ targets: { where: Selection.intersect() } });

    expect(() => {
      topology.batch(() => {
        standalone.batch(() => {});
      });
    }).toThrow(NESTED_BATCH_ERROR_MESSAGE);
    expect(() => {
      topology.batch(() => {
        other.batch(() => {});
      });
    }).toThrow(NESTED_BATCH_ERROR_MESSAGE);
    expect(() => {
      topology.batch(() => {
        other.getFilterSet('b')!.batch(() => {});
      });
    }).toThrow(NESTED_BATCH_ERROR_MESSAGE);

    standalone.destroy();
    other.destroy();
    topology.destroy();
  });

  test('chained filter-set contexts settle in one emission each', async () => {
    const topology = createTopology(
      {
        c: { type: 'filter-set', targets: { where: 'intersect' } },
        b: { type: 'filter-set', targets: { where: 'intersect' }, context: 'c.where' },
        a: { type: 'filter-set', targets: { where: 'intersect' }, context: 'b.where' },
      },
      {
        filterSets: { a: { kinds: { membership } }, b: { kinds: { membership } } },
      },
    );
    const a = topology.getFilterSet('a')!;
    const b = topology.getFilterSet('b')!;
    const c = topology.getFilterSet('c')!;
    b.set(memberSpec('bsq'));
    a.set(memberSpec('asq'));
    await drain();
    const aEmits = countEmits(topology.resolve('a.where'));

    topology.batch(() => {
      c.set(swim);
      b.set(ada);
    });

    expect(aEmits.count).toBe(1);
    expect(sql(topology.resolve('a.where'))[0]).toContain('"sport"');
    expect(sql(topology.resolve('a.where'))[0]).toContain('"name"');
    await drain();
    expect(aEmits.count).toBe(1);
    topology.destroy();
  });

  test('filterSet.batch inside topology.batch defers every set until the outer end', async () => {
    const topology = createTopology({
      a: { type: 'filter-set', targets: { where: 'crossfilter' } },
      b: { type: 'filter-set', targets: { where: 'intersect' } },
      page: { type: 'compose', include: ['a.where', 'b.where'] },
    });
    const a = topology.getFilterSet('a')!;
    const b = topology.getFilterSet('b')!;
    const page = countEmits(topology.resolve('page'));

    topology.batch(() => {
      a.batch((tx) => {
        tx.set(swim);
      });
      b.batch((tx) => {
        tx.set(ada);
      });
      expect(page.count).toBe(0);
      a.set(heavy);
    });
    await drain();

    expect(page.count).toBe(1);
    expect(topology.resolve('page').clauses).toHaveLength(3);
    topology.destroy();
  });

  test('activeClauses refreshes once with the final state when batched emissions are queued', async () => {
    const topology = createTopology({
      brush: { type: 'intersect' },
      a: { type: 'filter-set', targets: { where: 'intersect' } },
      b: { type: 'filter-set', targets: { where: 'intersect' } },
    });
    const a = topology.getFilterSet('a')!;
    const b = topology.getFilterSet('b')!;
    // Ordinary writes right before the batch: their dispatches are still
    // pending, so the batched emissions on these Selections are queued.
    topology.resolve('brush').update(point({}, 'sport', 'run'));
    a.set(swim);
    expect(topology.activeClauses.state.clauses).toHaveLength(1);
    const states: Array<number> = [];
    const unsubscribe = topology.activeClauses.subscribe(() => {
      states.push(topology.activeClauses.state.clauses.length);
    });

    topology.batch(() => {
      topology.reset();
      a.set(ada);
      b.set(heavy);
    });
    expect(states).toEqual([0]);

    await drain();
    expect(states).toEqual([0]);
    // Later ordinary writes refresh as usual.
    topology.resolve('brush').update(point({}, 'sport', 'swim'));
    expect(states).toEqual([0, 1]);
    unsubscribe.unsubscribe();
    topology.destroy();
  });

  test('activeClauses refreshes once when a crossfilter queue holds earlier ordinary updates', async () => {
    const topology = createTopology({
      brush: { type: 'crossfilter' },
      other: { type: 'crossfilter' },
      filters: { type: 'filter-set', targets: { where: 'crossfilter' } },
    });
    const $brush = topology.resolve('brush');
    const $other = topology.resolve('other');
    // Several ordinary writes from different clause sources right before the
    // batch: the first dispatches, the rest stay queued (a crossfilter queue
    // keeps one entry per source), and the batched emission queues after them.
    $brush.update(point({}, 'sport', 'run'));
    $brush.update(point({}, 'name', 'Ada'));
    $brush.update(point({}, 'id', '1'));
    $other.update(point({}, 'sport', 'swim'));
    $other.update(point({}, 'name', 'Bo'));
    let refreshes = 0;
    const unsubscribe = topology.activeClauses.subscribe(() => {
      refreshes += 1;
    });

    topology.batch(() => {
      topology.reset();
      topology.getFilterSet('filters')!.set(swim);
    });
    expect(refreshes).toBe(1);
    expect(topology.activeClauses.state.clauses).toHaveLength(0);

    await drain();
    expect(refreshes).toBe(1);
    expect(topology.activeClauses.state.clauses).toHaveLength(0);
    // Later ordinary writes refresh as usual.
    $brush.update(point({}, 'sport', 'swim'));
    expect(refreshes).toBe(2);
    expect(topology.activeClauses.state.clauses).toHaveLength(1);
    unsubscribe.unsubscribe();
    topology.destroy();
  });

  test.each(['crossfilter', 'intersect'] as const)(
    'a %s write right after a batch with queued emissions still refreshes activeClauses',
    async (type) => {
      const topology = createTopology({ brush: { type } });
      const $brush = topology.resolve('brush');
      $brush.update(point({}, 'sport', 'run'));
      $brush.update(point({}, 'name', 'Ada'));
      const states: Array<number> = [];
      const unsubscribe = topology.activeClauses.subscribe(() => {
        states.push(topology.activeClauses.state.clauses.length);
      });

      topology.batch(() => {
        topology.reset();
      });
      // Queued behind the batched emission (crossfilter), or replacing it in
      // the queue (intersect).
      $brush.update(point({}, 'id', '1'));
      expect(states).toEqual([0]);

      await drain();
      expect(states.at(-1)).toBe(1);
      expect(topology.activeClauses.state.clauses).toHaveLength(1);
      unsubscribe.unsubscribe();
      topology.destroy();
    },
  );

  describe('a Param still dispatching an earlier update', () => {
    // A Param listener that returns a Promise keeps the Param dispatching
    // until it settles (as a client re-query does); Mosaic queues any update
    // made meanwhile, and `param.value` stays the old value until delivery.
    function heldParamTopology() {
      const topology = createTopology({
        filters: { type: 'filter-set', targets: { where: 'intersect' } },
        minWeight: { type: 'param', default: 0 },
      });
      const $minWeight = topology.resolveParam<number>('minWeight');
      let release: () => void = () => {};
      let held = false;
      $minWeight.addEventListener('value', () => {
        if (held) {
          return undefined;
        }
        held = true;
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      });
      // The Selection listener records the Param value a re-query would read.
      const seen: Array<number | undefined> = [];
      topology.resolve('filters.where').addEventListener('value', () => {
        seen.push($minWeight.value);
      });
      return { topology, $minWeight, seen, release: () => release() };
    }

    test('a Param write inside the batch is queued, so the Selections emit first', async () => {
      const { topology, $minWeight, seen, release } = heldParamTopology();
      $minWeight.update(10);

      topology.batch(() => {
        topology.getFilterSet('filters')!.set(swim);
        $minWeight.update(60);
      });
      // Same as without a batch: the Selection does not wait for the Param.
      expect(seen).toEqual([10]);
      expect($minWeight.value).toBe(10);

      release();
      await drain();
      expect($minWeight.value).toBe(60);
      expect(seen).toEqual([10]);
      topology.destroy();
    });

    test('awaiting param.pending("value") before the batch lets the Selections read the final value', async () => {
      const { topology, $minWeight, seen, release } = heldParamTopology();
      $minWeight.update(10);
      $minWeight.update(60);
      setTimeout(release, 0);

      await $minWeight.pending('value');
      topology.batch(() => {
        topology.getFilterSet('filters')!.set(swim);
      });

      expect(seen).toEqual([60]);
      topology.destroy();
    });
  });

  test('direct Selection writes inside a batch are not deferred', () => {
    const topology = createTopology({ brush: { type: 'intersect' } });
    const $brush = topology.resolve('brush');
    const emits = countEmits($brush);

    topology.batch(() => {
      $brush.update(point({}, 'sport', 'swim'));
      expect(emits.count).toBe(1);
    });
    expect(emits.count).toBe(1);
    topology.destroy();
  });

  test('a destroyed topology runs the callback', () => {
    const topology = createTopology({
      filters: { type: 'filter-set', targets: { where: 'intersect' } },
    });
    const filters = topology.getFilterSet('filters')!;
    topology.destroy();
    const callback = vi.fn(() => {
      filters.set(swim);
    });

    topology.batch(callback);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(filters.store.state.specs).toHaveLength(0);
  });
});
