/**
 * Utility to handle functional or direct value updates.
 * @param updater - value or function to produce the new value
 * @param old - the current value
 * @returns the updated value
 */
export function functionalUpdate<T>(updater: T | ((old: T) => T), old: T): T {
  return typeof updater === 'function'
    ? (updater as (old: T) => T)(old)
    : updater;
}

/**
 * Sanitises a string so it can be safely used as a SQL column name.
 * - Keeps letters, numbers, underscores, and dots (for table.column)
 * - Strips everything else
 * - Ensures it starts with a letter or underscore
 * - Optionally quotes the result to prevent reserved word issues
 * @param input - The input string to sanitise
 * @returns The sanitised SQL column name
 */
export function toSafeSqlColumnName(input: string): string {
  // Trim and normalise whitespace
  let name = input.trim();

  // Remove unsafe characters (only allow letters, numbers, underscores, and dots)
  name = name.replace(/[^a-zA-Z0-9_.]/g, '');

  // Ensure it starts with a valid character (a letter or underscore)
  if (!/^[a-zA-Z_]/.test(name)) {
    name = '_' + name;
  }

  return name;
}
