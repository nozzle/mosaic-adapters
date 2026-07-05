/**
 * Tests for {@link createCascadingContexts}: the framework-agnostic peer-cascading
 * primitive extracted from react-mosaic's `useCascadingContexts`. Each key's
 * context must include every OTHER input plus all externals — never the input's
 * own Selection (the "ghost option" guard) — reflecting both pre-existing and
 * later-published clauses. `destroy()` must unwire every relay and clear seeded
 * clauses.
 */
import { Selection, clausePoint } from '@uwdata/mosaic-core';
import { describe, expect, test } from 'vitest';

import { createCascadingContexts } from '../src/index';

function publish(selection: Selection, column: string, value: string): void {
  selection.update(
    clausePoint(column, value, { source: { column, value } as object }),
  );
}

function resolvedColumns(context: Selection): Array<string> {
  return context._resolved.map((clause) =>
    String((clause.source as { column: string }).column),
  );
}

describe('createCascadingContexts', () => {
  test('each context includes every other input but not itself', () => {
    const $a = Selection.crossfilter();
    const $b = Selection.crossfilter();
    const $c = Selection.crossfilter();
    const handle = createCascadingContexts({ a: $a, b: $b, c: $c });

    publish($a, 'colA', 'x');
    publish($b, 'colB', 'y');
    publish($c, 'colC', 'z');

    // a's context sees b + c, never a.
    expect(resolvedColumns(handle.contexts.a!).sort()).toEqual([
      'colB',
      'colC',
    ]);
    // b's context sees a + c, never b.
    expect(resolvedColumns(handle.contexts.b!).sort()).toEqual([
      'colA',
      'colC',
    ]);
    // c's context sees a + b, never c.
    expect(resolvedColumns(handle.contexts.c!).sort()).toEqual([
      'colA',
      'colB',
    ]);

    handle.destroy();
  });

  test('externals are included in every context', () => {
    const $a = Selection.crossfilter();
    const $b = Selection.crossfilter();
    const $ext = Selection.crossfilter();
    const handle = createCascadingContexts({ a: $a, b: $b }, [$ext]);

    publish($ext, 'tableFilter', 'v');

    expect(resolvedColumns(handle.contexts.a!)).toEqual(['tableFilter']);
    expect(resolvedColumns(handle.contexts.b!)).toEqual(['tableFilter']);

    handle.destroy();
  });

  test('seeds contexts with clauses that predate wiring', () => {
    const $a = Selection.crossfilter();
    const $b = Selection.crossfilter();
    publish($a, 'colA', 'x');

    const handle = createCascadingContexts({ a: $a, b: $b });

    // b was wired after a already had a clause; b's context must reflect it.
    expect(resolvedColumns(handle.contexts.b!)).toEqual(['colA']);
    // a's context excludes itself, so it stays empty.
    expect(handle.contexts.a!._resolved).toHaveLength(0);

    handle.destroy();
  });

  test('mints one context per key', () => {
    const handle = createCascadingContexts({
      a: Selection.crossfilter(),
      b: Selection.crossfilter(),
    });

    expect(Object.keys(handle.contexts).sort()).toEqual(['a', 'b']);
    expect(handle.contexts.a).toBeInstanceOf(Selection);
    expect(handle.contexts.b).toBeInstanceOf(Selection);
    expect(handle.contexts.a).not.toBe(handle.contexts.b);

    handle.destroy();
  });

  test('destroy detaches relays: later publishes no longer propagate', () => {
    const $a = Selection.crossfilter();
    const $b = Selection.crossfilter();
    const $ext = Selection.crossfilter();
    const handle = createCascadingContexts({ a: $a, b: $b }, [$ext]);

    publish($a, 'colA', 'x');
    publish($ext, 'tableFilter', 'v');
    expect(resolvedColumns(handle.contexts.b!).sort()).toEqual([
      'colA',
      'tableFilter',
    ]);

    handle.destroy();
    expect(handle.destroyed).toBe(true);

    // Seeded clauses cleared on every context.
    expect(handle.contexts.a!._resolved).toHaveLength(0);
    expect(handle.contexts.b!._resolved).toHaveLength(0);

    // Later publishes reach no context.
    publish($b, 'colB', 'y');
    publish($ext, 'other', 'w');
    expect(handle.contexts.a!._resolved).toHaveLength(0);
    expect(handle.contexts.b!._resolved).toHaveLength(0);
  });

  test('destroy is idempotent', () => {
    const $a = Selection.crossfilter();
    const $b = Selection.crossfilter();
    const handle = createCascadingContexts({ a: $a, b: $b });
    publish($a, 'colA', 'x');

    handle.destroy();
    handle.destroy();

    expect(handle.destroyed).toBe(true);
    expect(handle.contexts.b!._resolved).toHaveLength(0);
  });

  test('empty inputs yields no contexts and a safe destroy', () => {
    const handle = createCascadingContexts({});

    expect(Object.keys(handle.contexts)).toHaveLength(0);
    handle.destroy();
    expect(handle.destroyed).toBe(true);
  });
});
