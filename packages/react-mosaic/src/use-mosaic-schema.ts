import { useEffect, useReducer, useRef } from 'react';
import { useSelector } from '@tanstack/react-store';
import { createSchemaClient } from '@nozzleio/mosaic-core';
import { useMosaicCoordinator } from './context';
import type { Coordinator } from '@uwdata/mosaic-core';
import type {
  SchemaClient,
  SchemaClientOptions,
  SchemaClientState,
} from '@nozzleio/mosaic-core';

export type UseMosaicSchemaOptions = Omit<
  SchemaClientOptions,
  'coordinator'
> & {
  /** Defaults to the nearest `MosaicProvider`, then the global coordinator. */
  coordinator?: Coordinator;
};

export type UseMosaicSchemaResult = SchemaClientState & {
  client: SchemaClient;
};

/**
 * Read-once schema discovery (`createSchemaClient`). Every option is
 * structural — the schema client has no setters — so changing the table,
 * columns, or stats re-creates the client and re-reads.
 */
export function useMosaicSchema(
  options: UseMosaicSchemaOptions,
): UseMosaicSchemaResult {
  const coordinator = useMosaicCoordinator(options.coordinator);
  const columns = options.columns ?? '*';
  const columnsKey = columns === '*' ? '*' : columns.join(' ');
  const statsKey = options.stats?.join(' ');

  const clientRef = useRef<{
    key: string;
    coordinator: Coordinator;
    client: SchemaClient;
  } | null>(null);
  const key = `${options.table}\u0000${columnsKey}\u0000${statsKey ?? ''}`;
  if (
    clientRef.current === null ||
    clientRef.current.key !== key ||
    clientRef.current.coordinator !== coordinator
  ) {
    clientRef.current = {
      key,
      coordinator,
      client: createSchemaClient({ ...options, coordinator }),
    };
  }
  const client = clientRef.current.client;
  const [, revive] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (client.destroyed) {
      // StrictMode simulated remount: the cleanup below destroyed the
      // committed client; recreate it on the next render.
      clientRef.current = null;
      revive();
      return undefined;
    }
    return () => {
      client.destroy();
    };
  }, [client]);

  const state = useSelector(client.store, (s) => s);
  return { ...state, client };
}
