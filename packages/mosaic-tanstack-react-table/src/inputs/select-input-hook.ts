import * as React from 'react';
import { useCoordinator } from '@nozzleio/react-mosaic';
import { shallow, useStore } from '@tanstack/react-store';
import { SelectInputCore } from '@nozzleio/mosaic-tanstack-table-core/input-core';
import type {
  MosaicSelectInputOptions,
  MosaicSelectInputState,
} from '@nozzleio/mosaic-tanstack-table-core/input-core';

export type { MosaicSelectInputOptions, MosaicSelectInputState };

export interface UseMosaicSelectInputResult<
  T = unknown,
> extends MosaicSelectInputState<T> {
  setValue: (value: T | Array<T> | '' | null) => void;
  activate: (value?: T | Array<T> | '' | null) => void;
  clear: () => void;
  client: SelectInputCore<T>;
}

export function useMosaicSelectInput<T = unknown>(
  options: MosaicSelectInputOptions<T>,
): UseMosaicSelectInputResult<T> {
  const contextCoordinator = useCoordinator();
  const normalizedOptions = React.useMemo(
    () => ({
      ...options,
      coordinator: options.coordinator ?? contextCoordinator,
      enabled: options.enabled ?? true,
    }),
    [contextCoordinator, options],
  );
  const [client] = React.useState(
    () => new SelectInputCore<T>(normalizedOptions),
  );

  React.useEffect(() => {
    client.updateOptions(normalizedOptions);
  }, [client, normalizedOptions]);

  const state = useStore(
    client.store,
    (store) => ({
      value: store.value,
      options: store.options,
      pending: store.pending,
      error: store.error,
    }),
    shallow,
  );

  React.useEffect(() => {
    if (!normalizedOptions.enabled) {
      client.disconnect();
      return;
    }

    const cleanup = client.connect();
    return cleanup;
  }, [client, normalizedOptions.enabled]);

  React.useEffect(() => {
    return () => {
      client.destroy();
    };
  }, [client]);

  return {
    ...state,
    setValue: (value) => client.setValue(value),
    activate: (value) => client.activate(value),
    clear: () => client.clear(),
    client,
  };
}
