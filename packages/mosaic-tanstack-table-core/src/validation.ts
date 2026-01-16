/**
 * Lightweight runtime validation and coercion utilities.
 * Used to ensure data integrity at the database/application boundary without heavy libraries.
 */

/**
 * Asserts that a value is a number. Throws TypeError if invalid.
 */
export function assertIsNumber(value: unknown): asserts value is number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new TypeError(`Expected number, received ${typeof value}`);
  }
}

/**
 * Asserts that a value is an Array. Throws TypeError if invalid.
 */
export function assertIsArray(value: unknown): asserts value is Array<unknown> {
  if (!Array.isArray(value)) {
    throw new TypeError(
      `Expected Array, received ${typeof value === 'object' ? 'object' : typeof value}`,
    );
  }
}

/**
 * Type guard to check if a value is a valid numeric range tuple [number, number].
 */
export function isRangeTuple(val: unknown): val is [number, number] {
  return (
    Array.isArray(val) &&
    val.length === 2 &&
    typeof val[0] === 'number' &&
    typeof val[1] === 'number'
  );
}

/**
 * Coerces a database value (String, BigInt, Number) to a standard Number.
 * Returns 0 for null/undefined/empty string to match standard default behavior.
 */
export function coerceNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  const num = Number(value);
  return isNaN(num) ? 0 : num;
}

/**
 * Coerces DuckDB Time/Date types (Epoch ms, ISO Strings) to JS Date.
 * Returns null if the value is invalid or empty.
 */
export function coerceDate(value: unknown): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'bigint') {
    return new Date(Number(value));
  }
  const date = new Date(String(value));
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Handles Parquet/DuckDB microsecond/nanosecond timestamps.
 * Heuristic: If value > 10^13 (approx Year 2286), assume micros and divide by 1000.
 */
export function coerceSafeTimestamp(value: unknown): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'bigint') {
    // 10,000,000,000,000 ms is roughly year 2286.
    // If larger, it is likely microseconds or nanoseconds from a Parquet file.
    if (value > 10_000_000_000_000n) {
      return new Date(Number(value / 1000n));
    }
    return new Date(Number(value));
  }
  return coerceDate(value);
}
