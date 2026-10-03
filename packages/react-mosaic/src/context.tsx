import { coordinator as defaultCoordinator } from '@uwdata/mosaic-core';
import type { Coordinator } from '@uwdata/mosaic-core';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

/**
 * Three states, distinguished on purpose:
 * - `undefined` (the default) — no `MosaicProvider` above: fall back to the
 *   upstream global coordinator, exactly as before.
 * - `null` — an explicit boundary (`<MosaicProvider coordinator={null}>`): the
 *   lookup stops here and throws instead of falling through.
 * - a `Coordinator` — the provided instance.
 */
const MosaicCoordinatorContext = createContext<Coordinator | null | undefined>(undefined);

export interface MosaicProviderProps {
  /**
   * The coordinator hooks below this provider connect to. Pass `null` to mark
   * an explicit boundary (e.g. a subtree whose connection is still loading):
   * hooks below it throw a clear error instead of silently falling back to a
   * parent provider's coordinator or the upstream global one. A hook given an
   * explicit `coordinator` option is unaffected by the boundary.
   */
  coordinator: Coordinator | null;
  children?: ReactNode;
}

/**
 * Provides the Mosaic coordinator that client hooks connect to when they are
 * not given an explicit `coordinator` option. `coordinator={null}` provides an
 * explicit boundary instead — see {@link MosaicProviderProps.coordinator}.
 */
export function MosaicProvider(props: MosaicProviderProps) {
  return (
    <MosaicCoordinatorContext.Provider value={props.coordinator}>
      {props.children}
    </MosaicCoordinatorContext.Provider>
  );
}

/**
 * Resolve the coordinator a hook should use: the explicit option wins, then
 * the nearest `MosaicProvider`, then upstream Mosaic's global default
 * coordinator (the one bare vgplot calls use) when there is no provider at all.
 *
 * Throws when the nearest `MosaicProvider` was given `coordinator={null}` and
 * no explicit `override` is passed — the provider marks a boundary the lookup
 * must not cross.
 */
export function useMosaicCoordinator(override?: Coordinator): Coordinator {
  const fromContext = useContext(MosaicCoordinatorContext);
  // `??` (not `!== undefined`) keeps the historical nullish handling for
  // untyped callers that pass `coordinator: null` as a hook option.
  const explicit = override ?? null;
  if (explicit !== null) {
    return explicit;
  }
  if (fromContext === null) {
    throw new Error(
      '[react-mosaic] No Mosaic coordinator is available: the nearest ' +
        '<MosaicProvider> was given coordinator={null}, which marks an explicit ' +
        'boundary (e.g. a subtree whose connection is still loading). Gate the ' +
        'data hooks below it on coordinator readiness — including hooks with ' +
        '`enabled: false`, which still create their client on render — or pass ' +
        'an explicit `coordinator` option.',
    );
  }
  if (fromContext !== undefined) {
    return fromContext;
  }
  return defaultCoordinator();
}
