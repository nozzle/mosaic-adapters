/**
 * Tests for {@link createComposedSelection}: the framework-agnostic composition
 * primitive extracted from react-mosaic's `useComposedSelection`. The composed
 * `intersect` context must mirror the union of its included Selections' clauses
 * (both those present at construction and those published afterwards), and
 * `destroy()` must detach every relay and clear the seeded clauses so no residue
 * or propagation survives teardown.
 */
import { Selection, clausePoint } from '@uwdata/mosaic-core';
import { describe, expect, test } from 'vitest';

import { createComposedSelection } from '../src/index';
import type { MosaicClient } from '@uwdata/mosaic-core';

/** Publish a point clause from an independent source onto a Selection. */
function publish(selection: Selection, column: string, value: string): void {
  selection.update(
    clausePoint(column, value, { source: { column, value } as object }),
  );
}

/** A stand-in Mosaic client (only object identity matters for self-exclusion). */
function fakeClient(): MosaicClient {
  return {} as unknown as MosaicClient;
}

/** Publish a clause whose `clients` set names `client`, from a foreign source. */
function publishForClient(
  selection: Selection,
  column: string,
  value: string,
  client: MosaicClient,
): void {
  selection.update(
    clausePoint(column, value, {
      source: { column, value } as object,
      clients: new Set([client]),
    }),
  );
}

/** Column names of the context's synchronously resolved clauses. */
function resolvedColumns(context: Selection): Array<string> {
  return context._resolved.map((clause) =>
    String((clause.source as { column: string }).column),
  );
}

describe('createComposedSelection', () => {
  test('mirrors clauses published to any included selection', () => {
    const $a = Selection.crossfilter();
    const $b = Selection.crossfilter();
    const handle = createComposedSelection([$a, $b]);

    publish($a, 'sport', 'swim');
    publish($b, 'name', 'Ada');

    expect(resolvedColumns(handle.selection).sort()).toEqual(['name', 'sport']);
    handle.destroy();
  });

  test('seeds the context with clauses that predate composition', () => {
    const $a = Selection.crossfilter();
    publish($a, 'sport', 'swim');

    const handle = createComposedSelection([$a]);

    expect(resolvedColumns(handle.selection)).toEqual(['sport']);
    handle.destroy();
  });

  test('an empty include list yields a bare intersect selection', () => {
    const handle = createComposedSelection([]);

    expect(handle.selection).toBeInstanceOf(Selection);
    expect(handle.selection.single).toBe(false);
    expect(handle.selection._resolved).toHaveLength(0);
    // destroy is a no-op but must be safe / idempotent.
    handle.destroy();
    handle.destroy();
    expect(handle.destroyed).toBe(true);
  });

  test('as: crossfilter yields a self-excluding composite', () => {
    const $a = Selection.crossfilter();
    const handle = createComposedSelection([$a], { as: 'crossfilter' });

    // A clause whose clients set names `client`; the composite must exclude it
    // from that client's predicate.
    const client = fakeClient();
    publishForClient($a, 'sport', 'swim', client);

    // Reading for the owning client self-excludes (its own only clause drops).
    expect(handle.selection.predicate(client)).toBeUndefined();
    // A different client still sees the clause.
    expect(String(handle.selection.predicate(fakeClient()))).toContain(
      '"sport"',
    );
    handle.destroy();
  });

  test('as: crossfilter with an empty include list produces a crossfilter Selection', () => {
    const handle = createComposedSelection([], { as: 'crossfilter' });

    expect(handle.selection).toBeInstanceOf(Selection);
    // crossfilter is a (non-single) intersect resolver with the cross flag set;
    // its self-exclusion behavior distinguishes it from a plain intersect.
    const client = fakeClient();
    publishForClient(handle.selection, 'x', '1', client);
    expect(handle.selection.predicate(client)).toBeUndefined();
    handle.destroy();
  });

  test('default (no options) stays intersect — no self-exclusion', () => {
    const $a = Selection.crossfilter();
    const handle = createComposedSelection([$a]);

    const client = fakeClient();
    publishForClient($a, 'sport', 'swim', client);

    // An intersect composite does NOT self-exclude the owning client.
    expect(String(handle.selection.predicate(client))).toContain('"sport"');
    handle.destroy();
  });

  test('destroy detaches relays: later publishes no longer propagate', () => {
    const $a = Selection.crossfilter();
    const $b = Selection.crossfilter();
    const handle = createComposedSelection([$a, $b]);

    publish($a, 'sport', 'swim');
    expect(resolvedColumns(handle.selection)).toEqual(['sport']);

    handle.destroy();
    expect(handle.destroyed).toBe(true);

    // Seeded clauses were cleared on teardown.
    expect(handle.selection._resolved).toHaveLength(0);

    // A later publish to a formerly-included selection does not reach the context.
    publish($b, 'name', 'Ada');
    expect(handle.selection._resolved).toHaveLength(0);
  });

  test('destroy is idempotent', () => {
    const $a = Selection.crossfilter();
    const handle = createComposedSelection([$a]);
    publish($a, 'sport', 'swim');

    handle.destroy();
    handle.destroy();

    expect(handle.destroyed).toBe(true);
    expect(handle.selection._resolved).toHaveLength(0);
  });
});
