import { createContext, useContext } from 'react';
import { coordinator as defaultCoordinator } from '@uwdata/mosaic-core';
import type { ReactNode } from 'react';
import type { Coordinator } from '@uwdata/mosaic-core';

const MosaicCoordinatorContext = createContext<Coordinator | null>(null);

export interface MosaicProviderProps {
  coordinator: Coordinator;
  children?: ReactNode;
}

/**
 * Provides the Mosaic coordinator that client hooks connect to when they are
 * not given an explicit `coordinator` option.
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
 * coordinator (the one bare vgplot calls use).
 */
export function useMosaicCoordinator(override?: Coordinator): Coordinator {
  const fromContext = useContext(MosaicCoordinatorContext);
  return override ?? fromContext ?? defaultCoordinator();
}
