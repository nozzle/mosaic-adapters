/**
 * Shared helpers for the two authoring views (Classic `question-filters.tsx`
 * and the `filter-builder.tsx` Builder) and the facet control they share.
 *
 * Both views ran verbatim copies of a debounce hook, a committed-spec array
 * reader, and the facet trigger-label logic; consolidating them here keeps the
 * two views converging on identical behavior (and lets the debounce grow a
 * cancel handle without drifting between call sites).
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFilterSetState } from '@nozzleio/react-mosaic';
import { usePageFilterSet } from './topology';

/**
 * A debounced runner with an explicit cancel handle. `run(fn)` (re)arms the
 * timer; `cancel()` drops any pending fire without running it. The timer is
 * also cleared on unmount.
 *
 * The cancel handle is load-bearing, not a convenience: the Builder's scalar
 * value control arms a debounce on every keystroke, and a placement switch (or
 * an external removal) must be able to abort a pending publish before it
 * resurrects a spec the switch just removed.
 */
export interface DebouncedRun {
  /** (Re)arm the debounce; a prior pending run is dropped. */
  run: (fn: () => void) => void;
  /** Drop any pending run without firing it. */
  cancel: () => void;
}

export function useDebouncedRun(delayMs: number): DebouncedRun {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => cancel, []);

  const run = (fn: () => void) => {
    cancel();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      fn();
    }, delayMs);
  };

  return useMemo(() => ({ run, cancel }), []);
}

/**
 * Reads a spec's committed value as a string array (empty when the spec is
 * absent or holds a non-array value). Memoized on the resolved spec so the
 * facet control's derived selection is referentially stable across renders.
 */
export function useSelectedValues(specId: string): Array<string> {
  const filterSet = usePageFilterSet();
  const { specs } = useFilterSetState(filterSet);
  const spec = specs.find((entry) => entry.id === specId);
  return useMemo(() => {
    if (spec === undefined || !Array.isArray(spec.value)) {
      return [];
    }
    return spec.value.map((value) => String(value));
  }, [spec]);
}

/**
 * The trigger / placeholder label a facet control derives from its committed
 * selection: `All` when empty, the sole value when one, else `N selected`.
 */
export function facetTriggerLabel(selected: Array<string>): string {
  if (selected.length === 0) {
    return 'All';
  }
  if (selected.length === 1) {
    return String(selected[0]);
  }
  return `${selected.length} selected`;
}
