import { isParam } from '@uwdata/mosaic-core';
import type { Param } from '@uwdata/mosaic-core';
import type { InputSubscriptionCleanup, MosaicInputSource } from './types';

type ParamValueListener<TValue> = (value: TValue | undefined) => void;

export class InputSubscriptionBag {
  #cleanups: Array<InputSubscriptionCleanup> = [];

  add(cleanup: InputSubscriptionCleanup | null | undefined): void {
    if (!cleanup) {
      return;
    }

    this.#cleanups.push(cleanup);
  }

  dispose(): void {
    const cleanups = this.#cleanups.splice(0);

    for (const cleanup of cleanups) {
      cleanup();
    }
  }
}

export function subscribeScalarParamValue<TValue>(
  param: Param<TValue>,
  listener: ParamValueListener<TValue>,
): InputSubscriptionCleanup {
  param.addEventListener('value', listener);

  return () => {
    param.removeEventListener('value', listener);
  };
}

export function subscribeParamStringSource(
  source: MosaicInputSource | null | undefined,
  listener: ParamValueListener<string>,
): InputSubscriptionCleanup {
  if (!isParam<string>(source)) {
    return () => {};
  }

  return subscribeScalarParamValue(source, listener);
}
