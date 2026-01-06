/**
 * Recursive type definitions for generating strict dot-notation paths from object schemas.
 * Used to enforce type safety for SQL column references in deeply nested structures (e.g. Parquet).
 */

/**
 * Helper to limit recursion depth to prevent compiler errors on deep objects.
 * Defaults to a reasonable depth for standard data schemas.
 */
type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * Generates all valid dot-notation paths for a given type T.
 * Recursion stops at Primitives, Dates, and Arrays (which are handled via unnesting logic elsewhere).
 */
export type Path<T, TDepth extends number = 10> = [TDepth] extends [never]
  ? never
  : T extends object
    ? {
        [K in keyof T]: K extends string | number
          ? T[K] extends Date | Array<any>
            ? `${K}`
            : `${K}` | `${K}.${Path<T[K], Prev[TDepth]>}`
          : never;
      }[keyof T]
    : never;

/**
 * The unified Strict ID type.
 * TData represents the Row Data schema.
 * Allows direct keys or nested paths.
 */
export type StrictId<TData> = keyof TData | Path<TData>;
