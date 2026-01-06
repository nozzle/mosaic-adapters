import { z } from 'zod';

/**
 * Helpers for defining Zod schemas compatible with DuckDB/Arrow results.
 * Database drivers often return BigInts or specific string formats that need coercion for JS.
 */
export const mosaicSchemaHelpers = {
  /**
   * Coerces number-like database values (BigInt, String) to a JavaScript number.
   * Safe for standard integers and floats.
   */
  number: z
    .union([z.number(), z.string(), z.bigint(), z.null(), z.undefined()])
    .transform((val) => {
      if (val === null || val === undefined || val === '') {
        return 0;
      }
      return Number(val);
    }),

  /**
   * Coerces various date formats (Epoch ms, ISO Strings) to a JavaScript Date object.
   */
  date: z
    .union([
      z.date(),
      z.string(),
      z.number(),
      z.bigint(),
      z.null(),
      z.undefined(),
    ])
    .transform((val) => {
      if (val === null || val === undefined) {
        return null;
      }
      if (val instanceof Date) {
        return val;
      }
      if (typeof val === 'bigint') {
        return new Date(Number(val));
      }
      return new Date(val);
    }),

  /**
   * Strictly handles DuckDB/Arrow timestamp edge cases.
   * Detects micro/nanoseconds (common in Parquet) and scales to milliseconds.
   *
   * @example
   * BigInt(1679000000000000) -> Date
   */
  safeTimestamp: z
    .union([z.date(), z.number(), z.string(), z.bigint(), z.null()])
    .transform((val) => {
      if (val === null) {
        return null;
      }
      if (val instanceof Date) {
        return val;
      }
      if (typeof val === 'bigint') {
        // Heuristic: If value is massive (year 2286+ in ms), it's likely micros/nanos.
        // 10^13 is roughly year 2286 in ms.
        if (val > 10000000000000n) {
          // Convert micro to ms (Approximation)
          return new Date(Number(val / 1000n));
        }
        return new Date(Number(val));
      }
      return new Date(val);
    }),

  /**
   *  Pass-through for values that are already safe strings or nulls.
   */
  string: z.string().nullable().optional(),
};
