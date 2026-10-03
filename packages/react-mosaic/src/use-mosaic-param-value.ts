import type { Param } from '@uwdata/mosaic-core';
import { useCallback, useSyncExternalStore } from 'react';

/**
 * Read a Param's current value reactively — the read-back half of param
 * publishing. A control that drives a topology-owned Param (a threshold slider,
 * a mode toggle) can render its own live value from the same Param its siblings
 * consume, so external changes (another control, a global reset) are reflected
 * without extra wiring.
 *
 * Returns `undefined` when the param has never been given a value. The
 * subscription is keyed on the Param instance: it re-subscribes only when a
 * different Param is passed (not on every render), and unsubscribes on unmount.
 */
export function useMosaicParamValue<T>(param: Param<T>): T | undefined {
  const subscribe = useCallback(
    (notify: () => void) => {
      param.addEventListener('value', notify);
      return () => param.removeEventListener('value', notify);
    },
    [param],
  );
  return useSyncExternalStore(
    subscribe,
    () => readParamValue<T>(param),
    () => readParamValue<T>(param),
  );
}

function readParamValue<T>(param: Param<T>): T | undefined {
  const raw = param.value as T | null | undefined;
  return raw ?? undefined;
}
