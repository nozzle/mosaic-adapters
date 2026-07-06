/**
 * React bindings for the composition topology helpers. Since #181's prerequisite
 * refactor, `useComposedSelection` and `useCascadingContexts` are thin wrappers
 * over the framework-agnostic `createComposedSelection` /
 * `createCascadingContexts` core factories. These tests pin the React-visible
 * contract: the derived Selections mirror their sources' clauses, unmount tears
 * the relay wiring down (later publishes stop propagating), and a StrictMode
 * double-mount settles on exactly one live wiring.
 */
import { Selection, clausePoint } from '@uwdata/mosaic-core';
import { describe, expect, test } from 'vitest';

import { interact, renderHook } from '@nozzleio/test-support/react';
import { useCascadingContexts, useComposedSelection } from '../src/index';
import type { MosaicClient } from '@uwdata/mosaic-core';

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

function resolvedColumns(context: Selection): Array<string> {
  return context._resolved.map((clause) =>
    String((clause.source as { column: string }).column),
  );
}

describe('useComposedSelection', () => {
  test('mirrors clauses published to any included selection', async () => {
    const $a = Selection.crossfilter();
    const $b = Selection.crossfilter();
    const hook = await renderHook(() => useComposedSelection([$a, $b]), {
      initialProps: {},
    });

    await interact(() => {
      publish($a, 'sport', 'swim');
      publish($b, 'name', 'Ada');
    });

    expect(resolvedColumns(hook.result.current).sort()).toEqual([
      'name',
      'sport',
    ]);
  });

  test('keeps a stable identity across re-renders', async () => {
    const $a = Selection.crossfilter();
    const hook = await renderHook(() => useComposedSelection([$a]), {
      initialProps: {},
    });

    const first = hook.result.current;
    await hook.rerender({});
    await hook.rerender({});

    expect(hook.result.current).toBe(first);
  });

  test('unmount detaches the relay: later publishes stop propagating', async () => {
    const $a = Selection.crossfilter();
    const hook = await renderHook(() => useComposedSelection([$a]), {
      initialProps: {},
    });

    await interact(() => publish($a, 'sport', 'swim'));
    const context = hook.result.current;
    expect(resolvedColumns(context)).toEqual(['sport']);

    await hook.unmount();

    await interact(() => publish($a, 'name', 'Ada'));
    // The relay was torn down and the seeded clause cleared on unmount.
    expect(context._resolved).toHaveLength(0);
  });

  test('StrictMode double-mount settles on a single live wiring', async () => {
    const $a = Selection.crossfilter();
    const hook = await renderHook(() => useComposedSelection([$a]), {
      initialProps: {},
      reactStrictMode: true,
    });

    await interact(() => publish($a, 'sport', 'swim'));
    // Exactly one relay target survives (no double-wiring residue): a single
    // clause, not two.
    expect(resolvedColumns(hook.result.current)).toEqual(['sport']);
  });

  test("as: 'crossfilter' yields a self-excluding composite", async () => {
    const $a = Selection.crossfilter();
    const hook = await renderHook(
      () => useComposedSelection([$a], { as: 'crossfilter' }),
      { initialProps: {} },
    );

    // A clause whose clients set names `client`; the composite must exclude it
    // from that client's own predicate.
    const client = fakeClient();
    await interact(() => publishForClient($a, 'sport', 'swim', client));

    // Reading for the owning client self-excludes (its own only clause drops).
    expect(hook.result.current.predicate(client)).toBeUndefined();
    // A different client still sees the clause.
    expect(String(hook.result.current.predicate(fakeClient()))).toContain(
      '"sport"',
    );
  });

  test("default (no options) stays 'intersect' — no self-exclusion", async () => {
    const $a = Selection.crossfilter();
    const hook = await renderHook(() => useComposedSelection([$a]), {
      initialProps: {},
    });

    const client = fakeClient();
    await interact(() => publishForClient($a, 'sport', 'swim', client));

    // An intersect composite does NOT self-exclude the owning client.
    expect(String(hook.result.current.predicate(client))).toContain('"sport"');
  });

  test("changing 'as' across rerenders rebuilds the composition", async () => {
    const $a = Selection.crossfilter();
    const hook = await renderHook(
      ({ as }: { as: 'intersect' | 'crossfilter' }) =>
        useComposedSelection([$a], { as }),
      {
        initialProps: { as: 'intersect' } as {
          as: 'intersect' | 'crossfilter';
        },
      },
    );

    const first = hook.result.current;

    // A same-`as` rerender keeps the identical composite.
    await hook.rerender({ as: 'intersect' });
    expect(hook.result.current).toBe(first);

    // Switching resolution strategy mints a fresh composite (the previous one is
    // torn down by the cleanup effect).
    await hook.rerender({ as: 'crossfilter' });
    expect(hook.result.current).not.toBe(first);

    // The rebuilt composite behaves as a crossfilter (self-excludes its client).
    const client = fakeClient();
    await interact(() => publishForClient($a, 'sport', 'swim', client));
    expect(hook.result.current.predicate(client)).toBeUndefined();
  });
});

describe('useCascadingContexts', () => {
  test('each context includes every other input but not itself', async () => {
    const $a = Selection.crossfilter();
    const $b = Selection.crossfilter();
    const inputs = { a: $a, b: $b };
    const hook = await renderHook(() => useCascadingContexts(inputs), {
      initialProps: {},
    });

    await interact(() => {
      publish($a, 'colA', 'x');
      publish($b, 'colB', 'y');
    });

    expect(resolvedColumns(hook.result.current.a)).toEqual(['colB']);
    expect(resolvedColumns(hook.result.current.b)).toEqual(['colA']);
  });

  test('externals are included in every context', async () => {
    const $a = Selection.crossfilter();
    const $b = Selection.crossfilter();
    const $ext = Selection.crossfilter();
    const inputs = { a: $a, b: $b };
    const externals = [$ext];
    const hook = await renderHook(
      () => useCascadingContexts(inputs, externals),
      { initialProps: {} },
    );

    await interact(() => publish($ext, 'tableFilter', 'v'));

    expect(resolvedColumns(hook.result.current.a)).toEqual(['tableFilter']);
    expect(resolvedColumns(hook.result.current.b)).toEqual(['tableFilter']);
  });

  test('unmount detaches every relay', async () => {
    const $a = Selection.crossfilter();
    const $b = Selection.crossfilter();
    const inputs = { a: $a, b: $b };
    const hook = await renderHook(() => useCascadingContexts(inputs), {
      initialProps: {},
    });

    await interact(() => publish($a, 'colA', 'x'));
    const contexts = hook.result.current;
    expect(resolvedColumns(contexts.b)).toEqual(['colA']);

    await hook.unmount();

    await interact(() => publish($a, 'colA2', 'z'));
    expect(contexts.b._resolved).toHaveLength(0);
  });

  test('StrictMode double-mount settles on a single live wiring', async () => {
    const $a = Selection.crossfilter();
    const $b = Selection.crossfilter();
    const inputs = { a: $a, b: $b };
    const hook = await renderHook(() => useCascadingContexts(inputs), {
      initialProps: {},
      reactStrictMode: true,
    });

    await interact(() => publish($a, 'colA', 'x'));
    // b's context sees a exactly once, not twice.
    expect(resolvedColumns(hook.result.current.b)).toEqual(['colA']);
  });
});
