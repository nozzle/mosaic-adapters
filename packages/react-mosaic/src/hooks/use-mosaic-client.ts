/**
 * Hook to manage the lifecycle of a Mosaic Client.
 * Automatically connects the client to the coordinator on mount
 * and disconnects it on unmount.
 */
import { useEffect } from 'react';
import { useCoordinator } from '../context';
import type { MosaicClient } from '@uwdata/mosaic-core';

export function useMosaicClient(client: MosaicClient | null | undefined) {
  const coordinator = useCoordinator();

  useEffect(() => {
    if (!client) {
      return;
    }

    // Connect logic: registers the client to receive updates
    coordinator.connect(client);

    // Cleanup logic: removes the client from the coordinator
    return () => {
      coordinator.disconnect(client);
    };
  }, [coordinator, client]);
}
