import { logger } from './logger';
import type { Coordinator, MosaicClient } from '@uwdata/mosaic-core';
import type { IMosaicLifecycleHooks } from './types';

/**
 * Creates a lifecycle manager to handle coordinator connection and coordination swapping.
 * This helper provides composition-based reuse of connection logic for different client types.
 *
 * @param client - The Mosaic client instance to manage.
 * @returns An object containing lifecycle management methods and state.
 */
export function createLifecycleManager(
  client: MosaicClient & IMosaicLifecycleHooks,
) {
  let isConnected = false;

  return {
    get isConnected() {
      return isConnected;
    },

    /**
     * Connects the client to the provided coordinator.
     */
    connect(coordinator: Coordinator | null | undefined): () => void {
      if (isConnected) {
        return () => {};
      }

      if (!coordinator) {
        logger.warn(
          'Core',
          `[${client.constructor.name}] No coordinator available. Cannot connect.`,
        );
        return () => {};
      }

      coordinator.connect(client);
      isConnected = true;
      client.__onConnect?.();

      return () => this.disconnect(coordinator);
    },

    /**
     * Disconnects the client from the provided coordinator.
     */
    disconnect(coordinator: Coordinator | null | undefined) {
      if (!isConnected || !coordinator) {
        return;
      }

      coordinator.disconnect(client);
      isConnected = false;
      client.__onDisconnect?.();
    },

    /**
     * Manages swapping the coordinator reference.
     * Handles disconnection from the old and reconnection to the new coordinator if previously active.
     */
    handleCoordinatorSwap(
      oldCoordinator: Coordinator | null | undefined,
      newCoordinator: Coordinator,
      reconnect: () => void,
    ) {
      if (oldCoordinator === newCoordinator) {
        return;
      }

      const wasConnected = isConnected;

      if (wasConnected && oldCoordinator) {
        this.disconnect(oldCoordinator);
      }

      if (wasConnected) {
        reconnect();
      }
    },
  };
}

/**
 * Standardized error handling for Mosaic queries.
 */
export function handleQueryError(clientName: string, error: Error) {
  logger.error('Core', `[${clientName}] Query Error`, { error });
}
