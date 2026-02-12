/**
 * @file Shared utility for converting Arrow table results to plain JS objects.
 *
 * Handles BigInt→Number coercion with a safety warning when values exceed
 * `Number.MAX_SAFE_INTEGER`.
 */
import { isArrowTable } from '@uwdata/mosaic-core';
import { logger } from '../logger';

/**
 * Convert an Arrow table result to an array of plain objects with BigInt→Number coercion.
 *
 * @param result - The raw result from `coordinator.query()`, expected to be an Arrow table.
 * @returns An array of plain objects with all BigInt values coerced to Number.
 */
export function arrowTableToObjects(
  result: unknown,
): Array<Record<string, unknown>> {
  if (!isArrowTable(result)) {
    return [];
  }

  const table = result as {
    numRows: number;
    get: (index: number) => Record<string, unknown> | null;
  };

  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < table.numRows; i++) {
    const raw = table.get(i);
    if (!raw) {
      continue;
    }
    const obj: Record<string, unknown> = {};
    for (const key of Object.keys(raw)) {
      const val = raw[key];
      if (typeof val === 'bigint') {
        if (
          val > BigInt(Number.MAX_SAFE_INTEGER) ||
          val < BigInt(-Number.MAX_SAFE_INTEGER)
        ) {
          logger.warn(
            'Grouped',
            `BigInt value for "${key}" exceeds Number.MAX_SAFE_INTEGER — precision may be lost`,
            { key, value: val.toString() },
          );
        }
        obj[key] = Number(val);
      } else {
        obj[key] = val;
      }
    }
    rows.push(obj);
  }
  return rows;
}
