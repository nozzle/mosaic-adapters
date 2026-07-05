/**
 * {@link createCascadingContexts}: the framework-agnostic core of react-mosaic's
 * `useCascadingContexts` hook. Implements "peer cascading" — for each input key
 * it mints an `intersect` context that includes every OTHER input plus all
 * provided externals, but never the input's own Selection. This is what keeps a
 * filter control filtered by its peers without filtering by itself (avoiding the
 * "ghost option" bug).
 */
import { Selection } from '@uwdata/mosaic-core';
import {
  attachIncludedSelection,
  clearSeededClauses,
  detachIncludedSelection,
  seedContext,
} from './wiring';

/** Handle returned by {@link createCascadingContexts}. */
export interface CascadingContextsHandle {
  /** Per-key context Selections, one per key of `inputs`. */
  readonly contexts: Record<string, Selection>;
  /** Detach every relay link and clear seeded clauses. Idempotent. */
  destroy: () => void;
  /** True once {@link CascadingContextsHandle.destroy} has run. */
  readonly destroyed: boolean;
}

/**
 * The source Selections for one key's context: every OTHER input plus all
 * externals.
 */
function getContextSources(
  inputs: Record<string, Selection>,
  externals: Array<Selection>,
  key: string,
): Array<Selection> {
  const self = inputs[key];
  const others = Object.values(inputs).filter(
    (selection) => selection !== self,
  );
  return [...others, ...externals];
}

/**
 * Wire peer-cascading contexts for a set of input Selections.
 *
 * @param inputs - Map of input Selections keyed by name; each key gets its own
 *   context.
 * @param externals - Additional Selections included in every context (e.g. table
 *   filters). Defaults to none.
 * @returns A handle exposing the per-key contexts and a `destroy()` teardown.
 */
export function createCascadingContexts(
  inputs: Record<string, Selection>,
  externals: Array<Selection> = [],
): CascadingContextsHandle {
  const keys = Object.keys(inputs);
  const contexts: Record<string, Selection> = {};

  keys.forEach((key) => {
    contexts[key] = Selection.intersect();
  });

  for (const key of keys) {
    const context = contexts[key];
    if (!context) {
      continue;
    }

    const sources = getContextSources(inputs, externals, key);
    sources.forEach((source) => {
      attachIncludedSelection(source, context);
    });
    seedContext(sources, context);
  }

  let destroyed = false;

  function destroy(): void {
    if (destroyed) {
      return;
    }
    destroyed = true;

    for (const key of keys) {
      const self = inputs[key];
      const context = contexts[key];
      if (!context) {
        continue;
      }

      for (const other of Object.values(inputs)) {
        if (other !== self) {
          detachIncludedSelection(other, context);
        }
      }

      for (const external of externals) {
        detachIncludedSelection(external, context);
      }
    }

    for (const key of keys) {
      const context = contexts[key];
      if (!context) {
        continue;
      }
      clearSeededClauses(getContextSources(inputs, externals, key), context);
    }
  }

  return {
    contexts,
    destroy,
    get destroyed() {
      return destroyed;
    },
  };
}
