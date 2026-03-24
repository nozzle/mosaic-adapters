import { useEffect } from 'react';
import { useMosaicCoordinator } from '../context/connector-provider';
import type { ConnectorMode } from '../context/connector-provider';

/**
 * Ensures the Mosaic coordinator is in the specified mode.
 * Call this at the top of page components that require a specific mode.
 *
 * @param requiredMode - The mode this component requires ('wasm' or 'remote')
 * @param enabled - Only switch mode when true. Defaults to true.
 */
export function useRequireMode(
  requiredMode: ConnectorMode,
  enabled: boolean = true,
) {
  const { mode, setMode } = useMosaicCoordinator();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (mode !== requiredMode) {
      setMode(requiredMode);
    }
  }, [mode, requiredMode, setMode, enabled]);

  return !enabled || mode === requiredMode;
}
