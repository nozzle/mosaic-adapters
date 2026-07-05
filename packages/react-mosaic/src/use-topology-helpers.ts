import { useEffect, useMemo, useReducer, useRef } from 'react';
import { Selection } from '@uwdata/mosaic-core';
import {
  createCascadingContexts,
  createComposedSelection,
} from '@nozzleio/mosaic-core';

type SelectionType = 'intersect' | 'union' | 'single' | 'crossfilter';

/** Any composition handle: wires listeners on creation, tears them down on destroy. */
interface CompositionHandle {
  destroy: () => void;
  readonly destroyed: boolean;
}

/**
 * Own the lifecycle of a core composition handle (composed selection / cascading
 * contexts) inside React. Mirrors {@link useBoundClient}'s StrictMode-safe
 * strategy: the handle is created lazily during render (relay wiring is a side
 * effect, so it must run once per mount, StrictMode included), a commit-time
 * cleanup destroys it, and a simulated StrictMode remount is detected via the
 * handle's `destroyed` flag and recreated.
 *
 * `key` is a scalar that fully captures the handle's inputs; a change recreates
 * the handle (the previous one is torn down by the cleanup effect first).
 */
function useCompositionHandle<THandle extends CompositionHandle>(
  create: () => THandle,
  key: string,
): THandle {
  const handleRef = useRef<THandle | null>(null);
  const keyRef = useRef<string | null>(null);
  const [, revive] = useReducer((n: number) => n + 1, 0);

  if (handleRef.current === null || keyRef.current !== key) {
    handleRef.current = create();
    keyRef.current = key;
  }
  const handle = handleRef.current;

  useEffect(() => {
    if (handle.destroyed) {
      // StrictMode simulated remount: the cleanup below already destroyed the
      // committed handle; drop it so the next render recreates a live one.
      handleRef.current = null;
      revive();
      return undefined;
    }
    return () => {
      handle.destroy();
    };
  }, [handle]);

  return handle;
}

const SELECTION_IDS = new WeakMap<Selection, number>();
let nextSelectionId = 1;

function createSelection(type: SelectionType) {
  switch (type) {
    case 'crossfilter':
      return Selection.crossfilter();
    case 'union':
      return Selection.union();
    case 'single':
      return Selection.single();
    case 'intersect':
    default:
      return Selection.intersect();
  }
}

function getSelectionId(selection: Selection) {
  const existingId = SELECTION_IDS.get(selection);
  if (existingId) {
    return existingId;
  }

  const nextId = nextSelectionId++;
  SELECTION_IDS.set(selection, nextId);
  return nextId;
}

function getSelectionListKey(selections: Array<Selection>) {
  return selections.map((selection) => getSelectionId(selection)).join('\0');
}

/**
 * Hook to instantiate a single stable Mosaic Selection.
 *
 * This is the first hook most consumers reach for: use it to wire a chart's or
 * input's `filterBy`, and as a lightweight pub/sub channel between widgets that
 * share the same Selection instance. The returned Selection keeps a stable
 * identity across renders (memoized on `type` only), so it is safe to pass into
 * effects, `filterBy`, or other hook dependency arrays.
 *
 * @param type - The resolution type for the selection (default: 'intersect').
 * @returns A stable Selection instance.
 *
 * @example
 * ```tsx
 * function Dashboard() {
 *   const selection = useMosaicSelection();
 *   return (
 *     <>
 *       <FilterInput target={selection} />
 *       <Chart filterBy={selection} />
 *     </>
 *   );
 * }
 * ```
 *
 * @remarks
 * If you want full control over construction, the escape hatch is to create the
 * Selection yourself and hold it in state:
 * `const [selection] = useState(() => Selection.single())`. Prefer this hook
 * where possible — it guarantees a stable identity and a consistent surface
 * across all Selection types.
 */
export function useMosaicSelection(
  type: SelectionType = 'intersect',
): Selection {
  return useMemo(() => createSelection(type), [type]);
}

/**
 * Hook to batch instantiate stable Mosaic Selections.
 * Useful for dashboards with many inputs where calling useMosaicSelection N times is verbose.
 *
 * @param keys - Static array of keys to identify the selections.
 * @param type - The resolution type for the selections (default: 'intersect').
 */
export function useMosaicSelections<TKey extends string>(
  keys: ReadonlyArray<TKey>,
  type: SelectionType = 'intersect',
): Record<TKey, Selection> {
  // Derive a stable scalar from the keys array so that callers can safely
  // pass inline array literals (e.g. `useMosaicSelections(['a','b'])`)
  // without causing Selection recreation on every render.
  const keyString = keys.join('\0');

  const selections = useMemo(() => {
    const map = {} as Record<TKey, Selection>;
    keys.forEach((key) => {
      map[key] = createSelection(type);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyString, type]);

  return selections;
}

/**
 * Hook to automatically wire "Peer Cascading" topology.
 * For every input selection provided, it creates a Context that includes:
 * 1. All OTHER input selections (excluding itself).
 * 2. All provided EXTERNAL selections.
 *
 * This pattern ensures that a filter dropdown is filtered by every other control
 * on the dashboard, but NOT by its own current value (preventing the "Ghost Option" bug).
 *
 * @param inputs - Map of input selections (from useMosaicSelections).
 * @param externals - Array of additional selections to include in every context (e.g. Table Filters).
 */
export function useCascadingContexts<TKey extends string>(
  inputs: Record<TKey, Selection>,
  externals: Array<Selection> = [],
): Record<TKey, Selection> {
  const externalsKey = getSelectionListKey(externals);
  const stableExternals = useMemo(
    () => externals,
    // The key fully captures identity/order for this selection list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [externalsKey],
  );

  // Key on the input keys + their Selection identities and the externals list: a
  // change in any of them recreates the handle (the core factory mints the
  // per-key contexts and wires their relays), and the previous handle is torn
  // down by the cleanup effect.
  const inputKeys = Object.keys(inputs);
  const inputsKey = inputKeys
    .map((key) => `${key}:${getSelectionId(inputs[key as TKey])}`)
    .join('\0');
  const handle = useCompositionHandle(
    () => createCascadingContexts(inputs, stableExternals),
    `${inputsKey}::${externalsKey}`,
  );

  return handle.contexts;
}

export function useComposedSelection(
  includedSelections: Array<Selection>,
): Selection {
  const includedSelectionsKey = getSelectionListKey(includedSelections);
  const stableIncludedSelections = useMemo(
    () => includedSelections,
    // The key fully captures identity/order for this selection list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [includedSelectionsKey],
  );

  // The core factory owns the composed Selection and its relay wiring; the hook
  // recreates the handle when the included list changes and destroys it on
  // unmount (and on the change).
  const handle = useCompositionHandle(
    () => createComposedSelection(stableIncludedSelections),
    includedSelectionsKey,
  );

  return handle.selection;
}
