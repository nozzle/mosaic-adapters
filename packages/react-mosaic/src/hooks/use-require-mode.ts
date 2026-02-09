import { useEffect, useRef } from 'react';
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
  const pendingSwitch = useRef(false);

  useEffect(() => {
    if (!enabled) {
      pendingSwitch.current = false;
      return;
    }

    if (mode !== requiredMode && !pendingSwitch.current) {
      pendingSwitch.current = true;
      setMode(requiredMode);
    } else if (mode === requiredMode) {
      pendingSwitch.current = false;
    }
  }, [mode, requiredMode, setMode, enabled]);
}
