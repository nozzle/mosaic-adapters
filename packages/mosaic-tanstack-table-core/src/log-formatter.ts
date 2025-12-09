/**
 * Utilities for formatting log data into token-dense representations.
 * Handles object diffing, SQL minification, and relative timestamps.
 */

export const formatters = {
    /**
     * Compares two objects and returns a string representation of ONLY the differences.
     * Returns null if objects are identical.
     */
    diff(prev: any, next: any, path = ''): string | null {
      // strict equality check
      if (prev === next) return null;
  
      // Handle primitives or nulls
      if (
        typeof prev !== 'object' ||
        typeof next !== 'object' ||
        prev === null ||
        next === null
      ) {
        return `${path}: ${JSON.stringify(prev)} -> ${JSON.stringify(next)}`;
      }
  
      // Deep compare objects/arrays
      const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
      const changes: string[] = [];
  
      for (const key of keys) {
        const newPath = path ? `${path}.${key}` : key;
        // Recursion for nested objects
        const change = this.diff(prev[key], next[key], newPath);
        if (change) changes.push(change);
      }
  
      if (changes.length === 0) return null;
      return changes.join(', ');
    },
  
    /**
     * Minifies SQL by removing extra whitespace/newlines.
     */
    sql(query: string): string {
      if (!query) return '';
      return query.replace(/\s+/g, ' ').trim();
    },
  
    /**
     * Generates a relative timestamp (e.g., +150ms).
     */
    timeDelta(startTime: number, currentTime: number = Date.now()): string {
      const diff = currentTime - startTime;
      return diff > 0 ? `+${diff}ms` : '0ms';
    },
  };