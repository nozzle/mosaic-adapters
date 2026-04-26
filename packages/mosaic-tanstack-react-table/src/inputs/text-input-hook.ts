import * as React from 'react';
import { useCoordinator } from '@nozzleio/react-mosaic';
import { shallow, useStore } from '@tanstack/react-store';
import { TextInputCore } from '@nozzleio/mosaic-tanstack-table-core/input-core';
import type {
  MosaicTextInputOptions,
  MosaicTextInputState,
} from '@nozzleio/mosaic-tanstack-table-core/input-core';

export type { MosaicTextInputOptions, MosaicTextInputState };

export interface UseMosaicTextInputResult extends MosaicTextInputState {
  setValue: (value: string | null) => void;
  activate: (value?: string | null) => void;
  clear: () => void;
  client: TextInputCore;
}

export function useMosaicTextInput(
  options: MosaicTextInputOptions,
): UseMosaicTextInputResult {
  const contextCoordinator = useCoordinator();
  const normalizedOptions = React.useMemo(
    () => ({
      ...options,
      coordinator: options.coordinator ?? contextCoordinator,
      enabled: options.enabled ?? true,
    }),
    [contextCoordinator, options],
  );
  const [client] = React.useState(() => new TextInputCore(normalizedOptions));

  React.useEffect(() => {
    client.updateOptions(normalizedOptions);
  }, [client, normalizedOptions]);

  const state = useStore(
    client.store,
    (store) => ({
      value: store.value,
      suggestions: store.suggestions,
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
