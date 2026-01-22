/**
 * Utility functions specific to the logging system.
 * Handles data sanitization, diffing, and type coercion for LLM-friendly output.
 */

/**
 * Calculates a shallow diff between two objects.
 * Returns only the keys that have changed between the old and new objects.
 * Useful for reducing log noise by only emitting state deltas.
 */
export function getObjectDiff(
  oldObj: any,
  newObj: any,
): Record<string, any> | null {
  if (!oldObj || !newObj) {
    return newObj;
  }

  const diff: Record<string, any> = {};
  let hasChanges = false;

  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

  for (const key of allKeys) {
    // Simple JSON stringify comparison for shallow equality
    if (JSON.stringify(oldObj[key]) !== JSON.stringify(newObj[key])) {
      diff[key] = newObj[key];
      hasChanges = true;
    }
  }

  return hasChanges ? diff : null;
}

/**
 * A safe replacer function for JSON.stringify.
 * 1. Handles BigInt (converts to string with 'n' suffix).
 * 2. Prunes internal framework keys (React fibers, TanStack internals).
 * 3. Handles Circular References.
 * 4. Aggressively summarizes large arrays to save tokens.
 */
export function llmFriendlyReplacer() {
  const seen = new WeakSet();
  return (key: string, value: any) => {
    // 1. Handle BigInt (Common in DuckDB / Apache Arrow)
    if (typeof value === 'bigint') {
      return `${value.toString()}n`;
    }

    // 2. Prune internal keys that add noise but no semantic value
    if (key.startsWith('_') || key === 'table' || key === 'client') {
      return undefined;
    }

    // 3. Handle Objects and Circular References
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Reference]';
      }
      seen.add(value);

      // 4. Summarize Arrays instead of dumping thousands of rows
      if (Array.isArray(value)) {
        if (value.length > 5) {
          // LLMs don't need 1000 rows. They need to know 1000 rows exist.
          // We show the first 3 items to give a schema hint.
          const preview = JSON.stringify(value.slice(0, 3)).replace(
            /^\[|\]$/g,
            '',
          );
          return `[Array(${value.length}): ${preview}, ...]`;
        }
      }
    }
    return value;
  };
}
