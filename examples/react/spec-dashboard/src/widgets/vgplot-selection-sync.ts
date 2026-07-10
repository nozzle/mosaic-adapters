/**
 * Narrow compatibility adapter for vgplot's interval-interactor internals.
 *
 * Mosaic Selection state is authoritative; vgplot interactors publish to it
 * but do not observe values published by another source. This adapter gives a
 * plot its current topology value without republishing. All private structural
 * access is feature-detected and isolated here so the widget stays declarative.
 */
import type { Selection } from '@uwdata/mosaic-core';

type Callable = (...args: Array<unknown>) => unknown;

export interface VgplotSelectionInteractor {
  selection?: Selection;
  channel?: unknown;
  value?: unknown;
  reset?: () => void;
  scale?: { apply?: (value: unknown) => unknown };
  brush?: { moveSilent?: Callable };
  g?: { call?: (callback: Callable, ...args: Array<unknown>) => unknown };
}

export interface VgplotSelectionBinding {
  selection: Selection;
  kind: 'intervalX' | 'intervalXY' | 'toggle';
  active: boolean;
  value: unknown;
}

function numericInterval(value: unknown): [number, number] | null {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== 'number' ||
    typeof value[1] !== 'number' ||
    !Number.isFinite(value[0]) ||
    !Number.isFinite(value[1]) ||
    value[0] > value[1]
  ) {
    return null;
  }
  return [value[0], value[1]];
}

function sameInterval(current: unknown, next: [number, number]): boolean {
  return (
    Array.isArray(current) &&
    current.length === 2 &&
    current[0] === next[0] &&
    current[1] === next[1]
  );
}

/** Adopt active topology values into matching interactors without publishing. */
export function syncVgplotSelectionInteractors(
  interactors: ReadonlyArray<VgplotSelectionInteractor>,
  bindings: ReadonlyArray<VgplotSelectionBinding>,
): void {
  for (const binding of bindings) {
    const matching = interactors.filter(
      (candidate) => candidate.selection === binding.selection,
    );
    for (const interactor of matching) {
      if (!binding.active) {
        if (interactor.value != null) {
          interactor.value = undefined;
          if (typeof interactor.reset === 'function') {
            interactor.reset();
          }
        }
        continue;
      }

      // This app currently persists only numeric intervalX values. Other
      // interactors retain their own active renderer-local value; they still
      // participate in the feature-detected external-clear path above.
      if (binding.kind !== 'intervalX' || interactor.channel !== 'x') {
        continue;
      }
      const value = numericInterval(binding.value);
      if (value === null || sameInterval(interactor.value, value)) {
        continue;
      }

      // Setting the domain value is sufficient before the first plot render:
      // Interval1D.init() reads it and paints the brush. For a live plot, move
      // the existing brush silently when all private capabilities exist.
      interactor.value = value;
      const apply = interactor.scale?.apply;
      const moveSilent = interactor.brush?.moveSilent;
      const call = interactor.g?.call;
      if (
        typeof apply !== 'function' ||
        typeof moveSilent !== 'function' ||
        typeof call !== 'function'
      ) {
        continue;
      }
      const lo = apply(value[0]);
      const hi = apply(value[1]);
      if (
        typeof lo !== 'number' ||
        typeof hi !== 'number' ||
        !Number.isFinite(lo) ||
        !Number.isFinite(hi)
      ) {
        continue;
      }
      const extent = [lo, hi];
      try {
        call.call(
          interactor.g,
          moveSilent,
          extent.sort((a, b) => a - b),
        );
      } catch {
        // Private shapes are deliberately not a hard app dependency. Keep the
        // value for a later full render, which can still seed it.
      }
    }
  }
}
