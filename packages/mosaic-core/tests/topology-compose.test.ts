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

/** Publish a point clause from an independent source onto a Selection. */
function publish(selection: Selection, column: string, value: string): void {
  selection.update(
    clausePoint(column, value, { source: { column, value } as object }),
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
