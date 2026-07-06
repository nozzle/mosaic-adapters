/**
 * {@link createComposedSelection}: the framework-agnostic core of react-mosaic's
 * `useComposedSelection` hook. Given a list of source Selections it returns a
 * stable `intersect` context Selection that mirrors the union of their clauses,
 * plus a `destroy()` that unwires every relay link and clears the seeded
 * clauses.
 */
import { Selection } from '@uwdata/mosaic-core';
import {
  attachIncludedSelection,
  clearSeededClauses,
  detachIncludedSelection,
  seedContext,
} from './wiring';

/** Handle returned by {@link createComposedSelection}. */
export interface ComposedSelectionHandle {
  /** The composed Selection mirroring every included Selection. */
  readonly selection: Selection;
  /** Detach every relay link and clear seeded clauses. Idempotent. */
  destroy: () => void;
  /** True once {@link ComposedSelectionHandle.destroy} has run. */
  readonly destroyed: boolean;
}

/** Options for {@link createComposedSelection}. */
export interface ComposedSelectionOptions {
  /**
   * Resolution strategy for the composed Selection. Defaults to `'intersect'`.
   * With `'crossfilter'` the composite self-excludes each clause's own clients
   * (a facet reading the context is not filtered by its own selection).
   */
  as?: 'intersect' | 'crossfilter';
}

function createComposeContext(as: 'intersect' | 'crossfilter'): Selection {
  return as === 'crossfilter' ? Selection.crossfilter() : Selection.intersect();
}

/**
 * Compose a set of Selections into a single derived Selection.
 *
 * The composed Selection includes (relays) the clauses of every Selection in
 * `selections`. It is seeded with their current clauses at construction, so it
 * reflects existing state and not just future updates.
 *
 * @param selections - The source Selections to compose. An empty list yields a
 *   bare Selection with no wiring (and a no-op `destroy`).
 * @param options - Optional. `as` picks the resolution strategy (default
 *   `'intersect'`; `'crossfilter'` enables per-client self-exclusion).
 * @returns A handle exposing the composed Selection and a `destroy()` teardown.
 */
export function createComposedSelection(
  selections: Array<Selection>,
  options: ComposedSelectionOptions = {},
): ComposedSelectionHandle {
  const context = createComposeContext(options.as ?? 'intersect');

  if (selections.length === 0) {
    let emptyDestroyed = false;
    return {
      selection: context,
      destroy: () => {
        emptyDestroyed = true;
      },
      get destroyed() {
        return emptyDestroyed;
      },
    };
  }

  selections.forEach((selection) => {
    attachIncludedSelection(selection, context);
  });
  seedContext(selections, context);

  let destroyed = false;

  function destroy(): void {
    if (destroyed) {
      return;
    }
    destroyed = true;

    selections.forEach((selection) => {
      detachIncludedSelection(selection, context);
    });
    clearSeededClauses(selections, context);
  }

  return {
    selection: context,
    destroy,
    get destroyed() {
      return destroyed;
    },
  };
}
