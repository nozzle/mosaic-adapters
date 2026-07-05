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
  /** The composed `intersect` Selection mirroring every included Selection. */
  readonly selection: Selection;
  /** Detach every relay link and clear seeded clauses. Idempotent. */
  destroy: () => void;
  /** True once {@link ComposedSelectionHandle.destroy} has run. */
  readonly destroyed: boolean;
}

/**
 * Compose a set of Selections into a single derived `intersect` Selection.
 *
 * The composed Selection includes (relays) the clauses of every Selection in
 * `selections`. It is seeded with their current clauses at construction, so it
 * reflects existing state and not just future updates.
 *
 * @param selections - The source Selections to compose. An empty list yields a
 *   bare `intersect` Selection with no wiring (and a no-op `destroy`).
 * @returns A handle exposing the composed Selection and a `destroy()` teardown.
 */
export function createComposedSelection(
  selections: Array<Selection>,
): ComposedSelectionHandle {
  const context = Selection.intersect();

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
