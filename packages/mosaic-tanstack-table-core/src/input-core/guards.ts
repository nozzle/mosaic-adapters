import { isParam, isSelection } from '@uwdata/mosaic-core';
import type { Param, Selection } from '@uwdata/mosaic-core';

export function isSelectionTarget(value: unknown): value is Selection {
  return isSelection(value);
}

export function isScalarParamTarget<TValue = unknown>(
  value: unknown,
): value is Param<TValue> {
  if (!isParam<TValue>(value)) {
    return false;
  }

  return !isSelection(value);
}
