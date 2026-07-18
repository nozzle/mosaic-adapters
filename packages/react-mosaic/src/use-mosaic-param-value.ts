import { useSyncExternalStore } from 'react';
import type { Param } from '@uwdata/mosaic-core';

/**
 * Read a Param's current value reactively — the read-back half of param
 * publishing. A control that drives a topology-owned Param (a threshold slider,
 * a mode toggle) can render its own live value from the same Param its siblings
 * consume, so external changes (another control, a global reset) are reflected
 * without extra wiring.
 *
 * Returns `undefined` when the param has never been given a value. Re-subscribes
 * when a different Param instance is passed, and unsubscribes on unmount.
 */
export function useMosaicParamValue<T>(param: Param<T>): T | undefined {
  return useSyncExternalStore(
    (notify) => {
      param.addEventListener('value', notify);
      return () => param.removeEventListener('value', notify);
    },
    () => readParamValue<T>(param),
    () => readParamValue<T>(param),
  );
}

function readParamValue<T>(param: Param<T>): T | undefined {
  const raw = param.value as T | null | undefined;
  return raw ?? undefined;
}
