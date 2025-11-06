// packages/mosaic-tanstack-core/src/util.ts
// This file contains standalone utility functions and classes used by the DataTable.
// It is designed to have no dependencies on the DataTable's instance state.

import { eq, literal, and, type SQLAst } from '@uwdata/mosaic-sql';

/**
 * A simple logger class to provide prefixed and timestamped console logs for debugging.
 */
export class Logger {
    constructor(private prefix: string) {}

    private enabled = true;

    log(...args: any[]) {
        if (this.enabled) {
            console.log(`[${this.prefix} - ${new Date().toLocaleTimeString()}]`, ...args);
        }
    }
    warn(...args: any[]) {
        console.warn(`[${this.prefix} - ${new Date().toLocaleTimeString()}]`, ...args);
    }
    error(...args: any[]) {
        console.error(`[${this.prefix} - ${new Date().toLocaleTimeString()}]`, ...args);
    }
}

/**
 * Creates a SQL predicate to uniquely identify a row based on its ID,
 * which is a JSON string of its primary key values.
 */
export function createPredicateFromRowId(id: string, primaryKey: string[], logger: Logger): SQLAst | null {
    if (primaryKey.length === 0) {
      logger.warn('Cannot create predicate from row ID: No primaryKey is defined for this table.');
      return null;
    }
    try {
      const keyValues = JSON.parse(id);
      if (!Array.isArray(keyValues) || keyValues.length !== primaryKey.length) {
        logger.error('Mismatched row ID format. Expected an array with length', primaryKey.length);
        return null;
      }
      const keyPredicates = primaryKey.map((key, i) => eq(key, literal(keyValues[i])));
      return and(...keyPredicates);
    } catch (e) {
      logger.error('Failed to parse row ID.', id, e);
      return null;
    }
}