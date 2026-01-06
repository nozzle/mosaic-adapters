import { z } from 'zod';

/**
 * Helpers for defining Zod schemas compatible with DuckDB/Arrow results.
 * Database drivers often return BigInts or specific string formats that need coercion for JS.
 */
export const mosaicSchemaHelpers = {
  /**
   * Coerces number-like database values (BigInt, String) to a JavaScript number.
   * Safe for standard integers and floats. Be cautious with BigInts exceeding Number.MAX_SAFE_INTEGER.
   *
   * UPDATED: Now handles NULL/UNDEFINED inputs explicitly.
   * If the input is null/undefined/empty-string, it will fallback to 0 (default behavior of coerce)
   * unless piped differently, but it won't crash on validation.
   */
  number: z
    .union([z.number(), z.string(), z.bigint(), z.null(), z.undefined()])
    .transform((val) => {
      if (val === null || val === undefined || val === '') {
        return 0; // Or null, but coerce usually implies 0 for empty in many contexts.
        // Actually, for safer SQL handling, we might want null, but that changes the return type to number | null.
        // To keep backward compatibility with "z.coerce.number()", we return 0 for now,
        // unless the user wraps this in .nullable().
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
        return null; // Return null safely
      }
      if (val instanceof Date) {
        return val;
      }
      // Handle BigInt epoch (common in Arrow)
      if (typeof val === 'bigint') {
        return new Date(Number(val));
      }
      return new Date(val);
    }),

  /**
   *  Pass-through for values that are already safe strings or nulls.
   */
  string: z.string().nullable().optional(),
};
