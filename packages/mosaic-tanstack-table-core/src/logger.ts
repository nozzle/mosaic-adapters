/**
 * A structured logging utility that separates console output from stored logs.
 * Includes capabilities for sanitizing console output and heuristic error detection.
 */

import type { Coordinator } from '@uwdata/mosaic-core';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogCategory =
  | 'Core'
  | 'Framework'
  | 'TanStack-Table'
  | 'Mosaic'
  | 'SQL'
  | 'Memory';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  // meta is for heavy objects (Table State, columns, etc)
  meta?: Record<string, any>;
}

/**
 * Truncates and sanitizes objects for console display to prevent
 * polluting the console with thousands of array items.
 */
function sanitizeForConsole(obj: any, depth = 0): any {
  if (depth > 2) {
    return '...';
  }
  if (Array.isArray(obj)) {
    if (obj.length > 5) {
      return [
        ...obj.slice(0, 5).map((o) => sanitizeForConsole(o, depth + 1)),
        `... (${obj.length - 5} more items)`,
      ];
    }
    return obj.map((o) => sanitizeForConsole(o, depth + 1));
  }
  if (typeof obj === 'object' && obj !== null) {
    const res: any = {};
    for (const k in obj) {
      // Heuristic: truncate likely large data arrays
      if (
        (k === 'rows' || k === 'data') &&
        Array.isArray(obj[k]) &&
        obj[k].length > 10
      ) {
        res[k] = `Array(${obj[k].length})`;
      } else {
        res[k] = sanitizeForConsole(obj[k], depth + 1);
      }
    }
    return res;
  }
  return obj;
}

class LogManager {
  private logs: Array<LogEntry> = [];
  private maxLogs = 2000;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Configuration: Console is quiet (INFO+), Storage is loud (DEBUG+)
  private consoleLevel = 1; // 0=Debug, 1=Info, 2=Warn, 3=Error
  private storageLevel = 0;

  private levelMap: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  private add(
    level: LogLevel,
    category: LogCategory,
    message: string,
    meta?: any,
  ) {
    const numericLevel = this.levelMap[level];

    // 0. Heuristic Check for Common SQL Errors (Struct Access)
    if (
      (level === 'error' || level === 'warn') &&
      meta &&
      (typeof meta.error?.message === 'string' || typeof meta.sql === 'string')
    ) {
      const textToCheck = meta.error?.message || meta.sql;
      // Look for "something.something" pattern which indicates incorrect quoting
      // Exclude dot from the first character set to prevent polynomial backtracking ReDoS
      const structErrorRegex = /"[^".]+\.[^"]+"/;
      const match = textToCheck.match(structErrorRegex);

      if (match) {
        // Log a high-visibility warning to help developers immediately
        console.warn(
          `%c[Mosaic-Fix-Hint] Potential Struct Syntax Error detected: ${JSON.stringify(match[0])}`,
          'background: #ffcc00; color: black; padding: 2px; border-radius: 2px;',
          '\nDuckDB requires nested columns to be quoted separately like "table"."column", not "table.column".\nCheck your createStructAccess utility.',
        );
      }
    }

    // 1. Handle Console Output (The "Quiet" Channel)
    if (numericLevel >= this.consoleLevel) {
      const badge = `[${category}]`;
      const style = this.getConsoleStyle(category);
      const sanitizedMeta = meta ? sanitizeForConsole(meta) : undefined;

      if (level === 'error') {
        console.error(`%c${badge} ${message}`, style, sanitizedMeta || '');
      } else if (level === 'warn') {
        console.warn(`%c${badge} ${message}`, style, sanitizedMeta || '');
      } else {
        // For Info/Debug in console, use collapsed groups if meta exists to keep it tidy
        if (sanitizedMeta) {
          console.groupCollapsed(`%c${badge} ${message}`, style);
          console.log(sanitizedMeta);
          console.groupEnd();
        } else {
          console.log(`%c${badge} ${message}`, style);
        }
      }
    }

    // 2. Handle Storage (The "Loud" Channel)
    if (numericLevel >= this.storageLevel) {
      this.logs.push({
        timestamp: new Date().toISOString(),
        level,
        category,
        message,
        // Deep clone meta to prevent mutation references later
        meta: meta
          ? JSON.parse(JSON.stringify(meta, this.circularReplacer()))
          : undefined,
      });

      if (this.logs.length > this.maxLogs) {
        this.logs.shift();
      }
    }
  }

  /**
   * Debounces a log entry. Useful for high-frequency events like brush selections or scroll updates.
   * Only the last log entry within the `delay` window for a given `id` will be recorded.
   *
   * @param id - Unique identifier for the debounce group (e.g., 'query-generation')
   * @param delay - Debounce delay in ms
   * @param level - Log level
   * @param category - Log category
   * @param message - Log message
   * @param meta - Metadata
   */
  debounce(
    id: string,
    delay: number,
    level: LogLevel,
    category: LogCategory,
    message: string,
    meta?: any,
  ) {
    if (this.debounceTimers.has(id)) {
      clearTimeout(this.debounceTimers.get(id));
    }

    const timer = setTimeout(() => {
      this.add(level, category, `${message} (Debounced)`, meta);
      this.debounceTimers.delete(id);
    }, delay);

    this.debounceTimers.set(id, timer);
  }

  // Public API
  debug(category: LogCategory, message: string, meta?: any) {
    this.add('debug', category, message, meta);
  }
  info(category: LogCategory, message: string, meta?: any) {
    this.add('info', category, message, meta);
  }
  warn(category: LogCategory, message: string, meta?: any) {
    this.add('warn', category, message, meta);
  }
  error(category: LogCategory, message: string, meta?: any) {
    this.add('error', category, message, meta);
  }

  /**
   * Diagnostic: Logs the current memory usage of DuckDB.
   * STUB: PRAGMA memory_info is not available in EH/MVP WASM bundles.
   */

  logMemory(_coordinator: Coordinator, _label: string) {
    // This is a stub to prevent TypeError: logger.logMemory is not a function
    // in clients that were instrumented for memory tracking.
  }

  download() {
    const data = {
      generatedAt: new Date().toISOString(),
      environment:
        typeof process !== 'undefined' &&
        'env' in process &&
        typeof process.env.NODE_ENV !== 'undefined'
          ? process.env.NODE_ENV
          : 'unknown',
      userAgent:
        typeof window !== 'undefined' ? window.navigator.userAgent : 'node',
      // Define the schema for the array tuples below
      logSchema: ['timestamp', 'level', 'category', 'message', 'meta'],
      // Transform objects to arrays to reduce key repetition overhead
      logs: this.logs.map((l) => [
        l.timestamp,
        l.level,
        l.category,
        l.message,
        l.meta,
      ]),
    };

    // Use default stringify (no indentation) for maximum compression
    const blob = new Blob([JSON.stringify(data)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mosaic-debug-logs-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Helper: Color code console logs by category
  private getConsoleStyle(category: LogCategory): string {
    switch (category) {
      case 'SQL':
        return 'color: #8e44ad; font-weight: bold;';
      case 'TanStack-Table':
        return 'color: #e67e22; font-weight: bold;';
      case 'Mosaic':
        return 'color: #2980b9; font-weight: bold;';
      case 'Framework':
        return 'color: #27ae60; font-weight: bold;';
      case 'Memory':
        return 'color: #c0392b; font-weight: bold;';
      default:
        return 'color: gray;';
    }
  }

  // Helper: Handle circular references in JSON
  private circularReplacer() {
    const seen = new WeakSet();
    return (key: string, value: any) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      return value;
    };
  }
}

export const logger = new LogManager();
