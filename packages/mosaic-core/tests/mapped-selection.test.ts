/**
 * `createMappedSelection`: a derived Selection whose clauses are a function of
 * the parent's. The skip projection is built on it (its own suite covers that
 * special case); this suite covers general maps — rewritten predicates, maps
 * that mint fresh clause objects, maps that read external state.
 */
import { rowsToIPC, settle } from '@nozzleio/test-support/duckdb';
import { Coordinator, Selection, clausePoint } from '@uwdata/mosaic-core';
import type {
  ArrowQueryRequest,
  Connector,
  ExecQueryRequest,
  MosaicClient,
  SelectionClause,
} from '@uwdata/mosaic-core';
import { Query, count } from '@uwdata/mosaic-sql';
import { describe, expect, test } from 'vitest';

import { createMappedSelection, createValuesClient } from '../src/index';
import type { SelectionClauseMap } from '../src/index';

interface CountingDb {
  coordinator: Coordinator;
  queries: Array<string>;
}

function createCountingDb(): CountingDb {
  const queries: Array<string> = [];
  const connector = {
    query(request: ArrowQueryRequest | ExecQueryRequest) {
      queries.push(request.sql);
      return Promise.resolve(rowsToIPC([{ total: 1 }]));
    },
  } as Connector;
  const coordinator = new Coordinator(connector, {
    logger: null,
    consolidate: false,
    cache: false,
    preagg: { enabled: false },
  });
  return { coordinator, queries };
}

interface Totals extends Record<string, unknown> {
  total: number;
}

const sportSource = { id: 'sport' } as object;
const weightSource = { id: 'weight' } as object;

const sport = (value: string | undefined, clients?: Set<MosaicClient>) =>
  clausePoint('sport', value, { source: sportSource, clients });
const weight = (value: number | undefined) =>
  clausePoint('weight', value, { source: weightSource });

/**
 * Rewrites `sport` clauses onto the `discipline` column, minting a fresh
 * clause object per call; passes removals and every other clause through.
 */
const toDiscipline: SelectionClauseMap = (clause) => {
  if (clause.source !== sportSource || !clause.predicate) {
    return clause;
  }
  return clausePoint('discipline', clause.value, {
    source: clause.source,
    clients: clause.clients,
  });
};

function sqlOf(selection: Selection): string {
  return String(selection.predicate(null));
}

function countEmits(selection: Selection): { count: number } {
  const emitted = { count: 0 };
  selection.addEventListener('value', () => {
    emitted.count += 1;
  });
  return emitted;
}

describe('createMappedSelection', () => {
  test('upstream dispatch internals the adoption path reads still exist', () => {
    // `#adopt` reads `_callbacks.get('value').queue.isEmpty()`, an upstream
    // `AsyncDispatch` internal: fail loudly if a Mosaic bump removes it.
    const selection = Selection.intersect();
    selection.addEventListener('value', () => {});
    const entry = selection._callbacks.get('value');
    expect(entry).toBeDefined();
    expect(typeof entry?.queue.isEmpty).toBe('function');
    expect(entry?.queue.isEmpty()).toBe(true);
  });

  test('seeds synchronously from the parent with mapped clauses', () => {
    const parent = Selection.intersect();
    parent.update(sport('swim'));
    const handle = createMappedSelection(parent, toDiscipline);

    expect(handle.selection.clauses).toHaveLength(1);
    expect(sqlOf(handle.selection)).toContain('discipline');
    expect(sqlOf(handle.selection)).not.toContain('"sport"');
    expect(handle.selection.clauses[0]?.source).toBe(sportSource);
    handle.destroy();
  });

  test('relayed updates are mapped; the parent keeps its own clauses', async () => {
    const parent = Selection.intersect();
    const handle = createMappedSelection(parent, toDiscipline);

    parent.update(sport('swim'));
    parent.update(weight(70));
    await parent.pending('value');

    expect(sqlOf(parent)).toContain('"sport"');
    const derived = sqlOf(handle.selection);
    expect(derived).toContain('discipline');
    expect(derived).toContain('swim');
    expect(derived).toContain('"weight"');
    expect(derived).not.toContain('"sport"');
    handle.destroy();
  });

  test('a map that mints fresh objects emits once per parent update', async () => {
    const parent = Selection.intersect();
    const handle = createMappedSelection(parent, toDiscipline);
    const emitted = countEmits(handle.selection);

    parent.update(sport('swim'));
    await parent.pending('value');
    await handle.selection.pending('value');
    expect(emitted.count).toBe(1);

    parent.update(sport('run'));
    await parent.pending('value');
    await handle.selection.pending('value');
    expect(emitted.count).toBe(2);
    expect(sqlOf(handle.selection)).toContain('run');
    handle.destroy();
  });

  test('a removal drops the mapped clause', async () => {
    const parent = Selection.intersect();
    const handle = createMappedSelection(parent, toDiscipline);
    parent.update(sport('swim'));
    await parent.pending('value');

    parent.update(sport(undefined));
    await parent.pending('value');
    expect(handle.selection.clauses).toHaveLength(0);
    handle.destroy();
  });

  test('null drops a clause, and removes a source the map used to keep', async () => {
    let dropSport = false;
    const parent = Selection.intersect();
    const handle = createMappedSelection(parent, (clause) => {
      if (dropSport && clause.source === sportSource) {
        return null;
      }
      return clause;
    });
    const emitted = countEmits(handle.selection);

    parent.update(sport('swim'));
    await parent.pending('value');
    expect(handle.selection.clauses).toHaveLength(1);
    expect(emitted.count).toBe(1);

    dropSport = true;
    parent.update(sport('run'));
    await parent.pending('value');
    await handle.selection.pending('value');
    expect(handle.selection.clauses).toHaveLength(0);
    expect(emitted.count).toBe(2);

    // Dropping a source the derived does not carry is not an event.
    parent.update(sport('bike'));
    await parent.pending('value');
    await settle(0);
    expect(emitted.count).toBe(2);
    handle.destroy();
  });

  test('activate is mapped, and dropped when the map drops the clause', () => {
    const parent = Selection.intersect();
    const handle = createMappedSelection(parent, (clause) => {
      if (clause.source === weightSource) {
        return null;
      }
      return toDiscipline(clause);
    });
    const activated: Array<SelectionClause> = [];
    handle.selection.addEventListener('activate', (clause: unknown) => {
      activated.push(clause as SelectionClause);
    });

    parent.activate(sport('swim'));
    parent.activate(weight(70));
    expect(activated).toHaveLength(1);
    expect(String(activated[0]?.predicate)).toContain('discipline');
    handle.destroy();
  });

  test('a relayed reset removes mapped clauses by source', async () => {
    const parent = Selection.intersect();
    const handle = createMappedSelection(parent, toDiscipline);
    parent.update(sport('swim'));
    parent.update(weight(70));
    await parent.pending('value');
    expect(handle.selection.clauses).toHaveLength(2);

    parent.reset([parent.clauses.find((clause) => clause.source === sportSource)!]);
    await parent.pending('value');
    expect(handle.selection.clauses).toHaveLength(1);
    expect(handle.selection.clauses[0]?.source).toBe(weightSource);

    parent.reset();
    await parent.pending('value');
    expect(handle.selection.clauses).toHaveLength(0);
    handle.destroy();
  });

  test('refresh() re-derives for external map state and emits only on change', async () => {
    let column = 'discipline';
    const parent = Selection.crossfilter();
    const handle = createMappedSelection(parent, (clause) => {
      if (!clause.predicate) {
        return clause;
      }
      return clausePoint(column, clause.value, { source: clause.source, clients: clause.clients });
    });
    parent.update(sport('swim'));
    await parent.pending('value');
    const emitted = countEmits(handle.selection);

    handle.refresh();
    expect(emitted.count).toBe(0);

    column = 'event';
    handle.refresh();
    await handle.selection.pending('value');
    expect(emitted.count).toBe(1);
    expect(sqlOf(handle.selection)).toContain('"event"');
    // No active clause: every consumer re-queries, none short-circuits.
    expect(handle.selection.clauses.active).toBeUndefined();

    handle.destroy();
    column = 'other';
    handle.refresh();
    expect(sqlOf(handle.selection)).toContain('"event"');
  });

  test('the resolver option overrides the parent strategy', async () => {
    const parent = Selection.intersect();
    const handle = createMappedSelection(parent, (clause) => clause, {
      resolver: Selection.union().resolver,
    });
    parent.update(sport('swim'));
    parent.update(weight(70));
    await parent.pending('value');

    expect(sqlOf(parent)).not.toContain(' OR ');
    expect(sqlOf(handle.selection)).toContain(' OR ');
    handle.destroy();
  });

  test('a single resolver override keeps one clause across relays and snapshot follows', async () => {
    const resets: Array<string> = [];
    const sportReset = { id: 'sport', reset: () => resets.push('sport') } as object;
    const weightReset = { id: 'weight', reset: () => resets.push('weight') } as object;
    const parent = Selection.intersect();
    const handle = createMappedSelection(parent, (clause) => clause, {
      resolver: Selection.single().resolver,
    });
    const emitted = countEmits(handle.selection);

    parent.update(clausePoint('sport', 'swim', { source: sportReset }));
    parent.update(clausePoint('weight', 70, { source: weightReset }));
    await parent.pending('value');
    await handle.selection.pending('value');

    expect(parent.clauses).toHaveLength(2);
    expect(handle.selection.clauses).toHaveLength(1);
    expect(handle.selection.clauses[0]?.source).toBe(weightReset);
    expect(sqlOf(handle.selection)).not.toContain('"sport"');
    // The derived never resets sources the parent still holds.
    expect(resets).toEqual([]);

    // Removing the kept clause falls back to the parent's remaining clause,
    // in one emission (no flap through an empty list).
    const before = emitted.count;
    parent.update(clausePoint('weight', undefined, { source: weightReset }));
    await parent.pending('value');
    await handle.selection.pending('value');
    expect(emitted.count).toBe(before + 1);
    expect(handle.selection.clauses).toHaveLength(1);
    expect(handle.selection.clauses[0]?.source).toBe(sportReset);

    // A relayed partial reset re-derives from the parent the same way.
    parent.update(clausePoint('weight', 80, { source: weightReset }));
    await parent.pending('value');
    parent.reset([parent.clauses.find((clause) => clause.source === weightReset)!]);
    await parent.pending('value');
    await handle.selection.pending('value');
    expect(handle.selection.clauses).toHaveLength(1);
    expect(handle.selection.clauses[0]?.source).toBe(sportReset);
    handle.destroy();
  });

  test('a single resolver override seeds from a multi-clause parent', () => {
    const parent = Selection.intersect();
    parent.update(sport('swim'));
    parent.update(weight(70));
    const handle = createMappedSelection(parent, (clause) => clause, {
      resolver: Selection.single().resolver,
    });
    expect(handle.selection.clauses).toHaveLength(1);
    expect(handle.selection.clauses[0]?.source).toBe(weightSource);
    handle.refresh();
    expect(handle.selection.clauses).toHaveLength(1);
    handle.destroy();
  });

  test('passing through a removal for a source the derived never carried is not an event', async () => {
    const parent = Selection.intersect();
    const handle = createMappedSelection(parent, (clause) => {
      if (clause.source === sportSource && clause.predicate) {
        return null;
      }
      return clause;
    });
    const emitted = countEmits(handle.selection);
    parent.update(sport('swim'));
    parent.update(sport(undefined));
    await parent.pending('value');
    await settle(0);
    expect(emitted.count).toBe(0);
    handle.destroy();
  });

  test('a dropped clause that displaces kept clauses on a single parent clears them downstream', async () => {
    const parent = Selection.single();
    const handle = createMappedSelection(parent, (clause) => {
      if (clause.source === sportSource) {
        return null;
      }
      return clause;
    });
    const composed = Selection.intersect({ include: handle.selection });
    const included = Selection.single({ include: handle.selection });
    parent.update(weight(70));
    await parent.pending('value');
    await settle(0);
    expect(composed.clauses).toHaveLength(1);
    expect(included.clauses).toHaveLength(1);
    const emitted = countEmits(handle.selection);
    const composedEmits = countEmits(composed);
    const includedEmits = countEmits(included);

    // The single parent keeps only `sport`, which the map drops.
    parent.update(sport('swim'));
    await parent.pending('value');
    await settle(0);

    expect(parent.clauses).toHaveLength(1);
    expect(handle.selection.clauses).toHaveLength(0);
    expect(composed.clauses).toHaveLength(0);
    expect(included.clauses).toHaveLength(0);
    expect(emitted.count).toBe(1);
    expect(composedEmits.count).toBe(1);
    expect(includedEmits.count).toBe(1);
    handle.destroy();
  });

  test('a removal for an uncarried source on a single parent still drops the displaced clause', async () => {
    const parent = Selection.single();
    const handle = createMappedSelection(parent, (clause) => clause);
    const included = Selection.single({ include: handle.selection });
    parent.update(weight(70));
    await parent.pending('value');
    await settle(0);
    const emitted = countEmits(handle.selection);

    // A single resolver clears its list on any update, removals included.
    parent.update(sport(undefined));
    await parent.pending('value');
    await settle(0);

    expect(parent.clauses).toHaveLength(0);
    expect(handle.selection.clauses).toHaveLength(0);
    expect(included.clauses).toHaveLength(0);
    expect(emitted.count).toBe(1);
    handle.destroy();
  });

  test('a mapped Selection of a mapped Selection follows relayed updates', async () => {
    const parent = Selection.intersect();
    const first = createMappedSelection(parent, toDiscipline);
    const second = createMappedSelection(first.selection, (clause) => clause, {
      resolver: Selection.single().resolver,
    });
    parent.update(sport('swim'));
    parent.update(weight(70));
    await parent.pending('value');
    await first.selection.pending('value');
    await second.selection.pending('value');
    expect(first.selection.clauses).toHaveLength(2);
    expect(second.selection.clauses).toHaveLength(1);
    expect(second.selection.clauses[0]?.source).toBe(weightSource);

    parent.update(weight(undefined));
    await parent.pending('value');
    await first.selection.pending('value');
    await second.selection.pending('value');
    expect(sqlOf(second.selection)).toContain('discipline');
    second.destroy();
    first.destroy();
  });

  test('a snapshot-style parent is followed by content', async () => {
    class SnapshotSelection extends Selection {
      replace(clauses: Array<SelectionClause>): void {
        const next: Selection['clauses'] = [...clauses];
        this._value = next;
        this._resolved = next;
        this.emit('value', next);
      }
    }
    const parent = new SnapshotSelection(Selection.intersect().resolver);
    const handle = createMappedSelection(parent, toDiscipline);
    const emitted = countEmits(handle.selection);

    parent.replace([sport('swim')]);
    await handle.selection.pending('value');
    expect(emitted.count).toBe(1);
    parent.replace([sport('swim')]);
    await settle(0);
    expect(emitted.count).toBe(1);
    parent.replace([sport('run')]);
    await handle.selection.pending('value');
    expect(emitted.count).toBe(2);
    expect(sqlOf(handle.selection)).toContain('run');
    handle.destroy();
  });

  test('a snapshot that replaces a source object with the same id is adopted without re-querying', async () => {
    class SnapshotSelection extends Selection {
      replace(clauses: Array<SelectionClause>): void {
        const next: Selection['clauses'] = [...clauses];
        this._value = next;
        this._resolved = next;
        this.emit('value', next);
      }
    }
    const parent = new SnapshotSelection(Selection.intersect().resolver);
    const handle = createMappedSelection(parent, toDiscipline);
    const firstSource = { id: 'sport' } as object;
    parent.replace([clausePoint('sport', 'swim', { source: firstSource })]);
    await handle.selection.pending('value');
    const emitted = countEmits(handle.selection);

    const nextSource = { id: 'sport' } as object;
    parent.replace([clausePoint('sport', 'swim', { source: nextSource })]);
    await parent.pending('value');
    await settle(0);
    expect(emitted.count).toBe(0);
    expect(handle.selection.clauses[0]?.source).toBe(nextSource);
    expect(handle.selection.valueFor(nextSource)).toBe('swim');
    expect(handle.selection.valueFor(firstSource)).toBeUndefined();

    // refresh() adopts the same way.
    const refreshedSource = { id: 'sport' } as object;
    parent._resolved = [clausePoint('sport', 'swim', { source: refreshedSource })];
    handle.refresh();
    expect(emitted.count).toBe(0);
    expect(handle.selection.valueFor(refreshedSource)).toBe('swim');

    // Removal by the replacement source reaches the derived.
    parent.update(clausePoint('sport', undefined, { source: refreshedSource }));
    await parent.pending('value');
    await handle.selection.pending('value');
    expect(handle.selection.clauses).toHaveLength(0);
    handle.destroy();
  });

  test('source adoption propagates through nested mapped Selections', async () => {
    class SnapshotSelection extends Selection {
      replace(clauses: Array<SelectionClause>): void {
        const next: Selection['clauses'] = [...clauses];
        this._value = next;
        this._resolved = next;
        this.emit('value', next);
      }
    }
    const resets: Array<string> = [];
    const makeSource = (name: string) => ({
      id: 'sport',
      reset: () => {
        resets.push(name);
      },
    });
    const parent = new SnapshotSelection(Selection.intersect().resolver);
    const first = createMappedSelection(parent, toDiscipline);
    // Mints fresh objects too, so adoption cannot ride on shared references.
    const second = createMappedSelection(first.selection, (clause) =>
      clause.predicate ? { ...clause } : clause,
    );
    const originalSource = makeSource('original');
    parent.replace([clausePoint('sport', 'swim', { source: originalSource })]);
    await parent.pending('value');
    await first.selection.pending('value');
    await second.selection.pending('value');
    expect(second.selection.valueFor(originalSource)).toBe('swim');
    const firstEmits = countEmits(first.selection);
    const secondEmits = countEmits(second.selection);

    const replacementSource = makeSource('replacement');
    parent.replace([clausePoint('sport', 'swim', { source: replacementSource })]);
    await parent.pending('value');
    await settle(0);
    expect(firstEmits.count).toBe(0);
    expect(secondEmits.count).toBe(0);
    expect(second.selection.clauses[0]?.source).toBe(replacementSource);
    expect(second.selection.valueFor(replacementSource)).toBe('swim');
    expect(second.selection.valueFor(originalSource)).toBeUndefined();

    // Reset by the replacement clause reaches the nested derived.
    parent.reset([parent._resolved[0]!]);
    await parent.pending('value');
    await first.selection.pending('value');
    await second.selection.pending('value');
    expect(second.selection.clauses).toHaveLength(0);
    expect(resets.every((name) => name === 'replacement')).toBe(true);

    // Removal by a further replacement source reaches it too.
    parent.replace([clausePoint('sport', 'run', { source: originalSource })]);
    await parent.pending('value');
    await first.selection.pending('value');
    await second.selection.pending('value');
    const laterSource = makeSource('later');
    parent.replace([clausePoint('sport', 'run', { source: laterSource })]);
    await parent.pending('value');
    await settle(0);
    expect(second.selection.valueFor(laterSource)).toBe('run');
    parent.update(clausePoint('sport', undefined, { source: laterSource }));
    await parent.pending('value');
    await first.selection.pending('value');
    await second.selection.pending('value');
    expect(second.selection.clauses).toHaveLength(0);
    second.destroy();
    first.destroy();
  });

  test('a nested map whose result changes for an adopted source publishes the change', async () => {
    class SnapshotSelection extends Selection {
      replace(clauses: Array<SelectionClause>): void {
        const next: Selection['clauses'] = [...clauses];
        this._value = next;
        this._resolved = next;
        this.emit('value', next);
      }
    }
    interface ColumnSource {
      id: string;
      column: string | null;
    }
    const parent = new SnapshotSelection(Selection.intersect().resolver);
    // Identity map: content-equal by `id`, so the first level adopts silently.
    const first = createMappedSelection(parent, (clause) => clause);
    // Reads more of the source than its `id`; drops the clause without a column.
    const second = createMappedSelection(first.selection, (clause) => {
      const { column } = clause.source as ColumnSource;
      if (!clause.predicate) {
        return clause;
      }
      if (column === null) {
        return null;
      }
      return clausePoint(column, clause.value, {
        source: clause.source,
        clients: clause.clients,
      });
    });
    const oldSource: ColumnSource = { id: 'sport', column: 'old_column' };
    parent.replace([clausePoint('sport', 'swim', { source: oldSource })]);
    await parent.pending('value');
    await first.selection.pending('value');
    await second.selection.pending('value');
    expect(sqlOf(second.selection)).toContain('old_column');
    const firstEmits = countEmits(first.selection);
    const secondEmits = countEmits(second.selection);

    // The replacement changes the nested predicate.
    const newSource: ColumnSource = { id: 'sport', column: 'new_column' };
    parent.replace([clausePoint('sport', 'swim', { source: newSource })]);
    await parent.pending('value');
    await second.selection.pending('value');
    await settle(0);
    expect(firstEmits.count).toBe(0);
    expect(first.selection.clauses[0]?.source).toBe(newSource);
    expect(secondEmits.count).toBe(1);
    expect(sqlOf(second.selection)).toContain('new_column');
    expect(sqlOf(second.selection)).not.toContain('old_column');
    expect(second.selection.clauses[0]?.source).toBe(newSource);
    // Not an interaction: published without an active clause, like refresh().
    expect(second.selection.clauses.active).toBeUndefined();

    // A further replacement makes the nested map drop the clause.
    const droppedSource: ColumnSource = { id: 'sport', column: null };
    parent.replace([clausePoint('sport', 'swim', { source: droppedSource })]);
    await parent.pending('value');
    await second.selection.pending('value');
    await settle(0);
    expect(firstEmits.count).toBe(0);
    expect(secondEmits.count).toBe(2);
    expect(second.selection.clauses).toHaveLength(0);
    expect(second.selection.valueFor(newSource)).toBeUndefined();

    // Bringing back a column re-adds it; the follow paths stay idempotent.
    parent.replace([clausePoint('sport', 'swim', { source: newSource })]);
    await parent.pending('value');
    await second.selection.pending('value');
    await settle(0);
    expect(secondEmits.count).toBe(3);
    expect(sqlOf(second.selection)).toContain('new_column');
    second.refresh();
    await settle(0);
    expect(secondEmits.count).toBe(3);
    second.destroy();
    first.destroy();
  });

  test('refresh() adopts changed clause data for unchanged sources and propagates it', async () => {
    let label = 'first';
    const parent = Selection.intersect();
    // Same predicate, changed `value`: content-equal one level up.
    const first = createMappedSelection(parent, (clause) =>
      clause.predicate ? { ...clause, value: label } : clause,
    );
    // Derives its predicate from the first level's `value`.
    const second = createMappedSelection(first.selection, (clause) => {
      if (!clause.predicate) {
        return clause;
      }
      return clausePoint('label', clause.value, {
        source: clause.source,
        clients: clause.clients,
      });
    });
    parent.update(sport('swim'));
    await parent.pending('value');
    await first.selection.pending('value');
    await second.selection.pending('value');
    expect(first.selection.valueFor(sportSource)).toBe('first');
    expect(sqlOf(second.selection)).toContain('first');
    const firstEmits = countEmits(first.selection);
    const secondEmits = countEmits(second.selection);

    label = 'second';
    first.refresh();
    await first.selection.pending('value');
    await second.selection.pending('value');
    await settle(0);
    // Query-equivalent one level up: adopted without an emission.
    expect(firstEmits.count).toBe(0);
    expect(first.selection.valueFor(sportSource)).toBe('second');
    expect(first.selection.clauses[0]?.value).toBe('second');
    // The nested predicate changed, so the nested Selection emits.
    expect(secondEmits.count).toBe(1);
    expect(sqlOf(second.selection)).toContain('second');
    expect(sqlOf(second.selection)).not.toContain('first');

    // Idempotent once adopted.
    first.refresh();
    second.refresh();
    await settle(0);
    expect(firstEmits.count).toBe(0);
    expect(secondEmits.count).toBe(1);
    second.destroy();
    first.destroy();
  });

  test('a snapshot with unchanged sources but changed clause data is adopted', async () => {
    class SnapshotSelection extends Selection {
      replace(clauses: Array<SelectionClause>): void {
        const next: Selection['clauses'] = [...clauses];
        this._value = next;
        this._resolved = next;
        this.emit('value', next);
      }
    }
    const parent = new SnapshotSelection(Selection.intersect().resolver);
    const first = createMappedSelection(parent, (clause) => clause);
    const second = createMappedSelection(first.selection, (clause) => {
      const meta = clause.meta as { column?: string } | undefined;
      if (!clause.predicate || meta?.column === undefined) {
        return clause;
      }
      return clausePoint(meta.column, clause.value, {
        source: clause.source,
        clients: clause.clients,
      });
    });
    // Every clause carries the same predicate SQL; only `value`/`meta` vary.
    const clauseWith = (value: string, column: string): SelectionClause => ({
      ...clausePoint('sport', 'swim', { source: sportSource }),
      value,
      meta: { column } as unknown as SelectionClause['meta'],
    });
    parent.replace([clauseWith('swim', 'old_column')]);
    await parent.pending('value');
    await first.selection.pending('value');
    await second.selection.pending('value');
    expect(sqlOf(second.selection)).toContain('old_column');
    const firstEmits = countEmits(first.selection);
    const secondEmits = countEmits(second.selection);

    // Same source object and predicate SQL; `value` and `meta` changed.
    parent.replace([clauseWith('run', 'new_column')]);
    await parent.pending('value');
    await second.selection.pending('value');
    await settle(0);
    expect(firstEmits.count).toBe(0);
    expect(first.selection.valueFor(sportSource)).toBe('run');
    expect(first.selection.clauses[0]?.meta).toEqual({ column: 'new_column' });
    expect(secondEmits.count).toBe(1);
    expect(sqlOf(second.selection)).toContain('new_column');
    expect(sqlOf(second.selection)).toContain('run');
    second.destroy();
    first.destroy();
  });

  test('destroy() detaches from the relay and stops following', async () => {
    const parent = Selection.intersect();
    const handle = createMappedSelection(parent, toDiscipline);
    expect(parent._relay.has(handle.selection)).toBe(true);
    parent.update(sport('swim'));
    await parent.pending('value');

    handle.destroy();
    handle.destroy();
    expect(parent._relay.has(handle.selection)).toBe(false);
    parent.update(sport('run'));
    await parent.pending('value');
    expect(sqlOf(handle.selection)).toContain('swim');
  });

  test('a client filtered by the mapped Selection queries mapped predicates', async () => {
    const db = createCountingDb();
    const parent = Selection.crossfilter();
    const handle = createMappedSelection(parent, toDiscipline);
    const client = createValuesClient<Totals>({
      coordinator: db.coordinator,
      filterBy: handle.selection,
      query: ({ where }) => Query.from('t').select({ total: count() }).where(where),
    });
    await settle();
    expect(db.queries).toHaveLength(1);

    parent.update(sport('swim'));
    await parent.pending('value');
    await settle();
    expect(db.queries).toHaveLength(2);
    expect(db.queries[1]).toContain('"discipline"');
    expect(db.queries[1]).not.toContain('"sport"');

    // The client's own (mapped) clause keeps crossfilter self-exclusion.
    parent.update(sport('run', new Set([client.mosaicClient])));
    await parent.pending('value');
    await settle();
    expect(db.queries).toHaveLength(2);

    client.destroy();
    handle.destroy();
  });
});
