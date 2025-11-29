// packages/mosaic-tanstack-table-core/src/trimmed/logger.ts
/* eslint-disable no-console */
// A structured logging utility that separates console output from stored logs.
// It allows for quiet console output while retaining detailed metadata
// (state snapshots, SQL queries) in a downloadable JSON format for debugging.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogCategory = 'Core' | 'React' | 'TanStack' | 'Mosaic' | 'SQL';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  // meta is for heavy objects (Table State, columns, etc)
  meta?: Record<string, any>;
}

class LogManager {
  private logs: LogEntry[] = [];
  private maxLogs = 2000;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Configuration: Console is quiet (INFO+), Storage is loud (DEBUG+)
  private consoleLevel: number = 1; // 0=Debug, 1=Info, 2=Warn, 3=Error
  private storageLevel: number = 0;

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

    // 1. Handle Console Output (The "Quiet" Channel)
    if (numericLevel >= this.consoleLevel) {
      const badge = `[${category}]`;
      const style = this.getConsoleStyle(category);

      if (level === 'error') {
        console.error(`%c${badge} ${message}`, style, meta || '');
      } else if (level === 'warn') {
        console.warn(`%c${badge} ${message}`, style, meta || '');
      } else {
        // For Info/Debug in console, use collapsed groups if meta exists to keep it tidy
        if (meta) {
          console.groupCollapsed(`%c${badge} ${message}`, style);
          console.log(meta);
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

  download() {
    const data = {
      generatedAt: new Date().toISOString(),
      environment:
        typeof process !== 'undefined' && process.env
          ? process.env.NODE_ENV
          : 'unknown',
      userAgent:
        typeof window !== 'undefined' ? window.navigator.userAgent : 'node',
      logs: this.logs,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
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
      case 'TanStack':
        return 'color: #e67e22; font-weight: bold;';
      case 'Mosaic':
        return 'color: #2980b9; font-weight: bold;';
      case 'React':
        return 'color: #27ae60; font-weight: bold;';
      default:
        return 'color: gray;';
    }
  }

  // Helper: Handle circular references in JSON
  private circularReplacer() {
    const seen = new WeakSet();
    return (key: string, value: any) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    };
  }
}

export const logger = new LogManager();
