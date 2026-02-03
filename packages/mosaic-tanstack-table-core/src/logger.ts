/**
 * A structured logging utility that prioritizes semantic clarity and token efficiency.
 *
 * Architecture:
 * - Console: Rich, interactive output for developers.
 * - Storage: Sanitized, diff-based event stream for LLM analysis.
 * - Format: JSONL (JSON Lines) for easy stream processing and readability.
 */

import { getObjectDiff, llmFriendlyReplacer } from './logger-utils';
import type { Coordinator } from '@uwdata/mosaic-core';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogCategory =
  | 'Core'
  | 'Framework'
  | 'TanStack-Table'
  | 'Mosaic'
  | 'SQL'
  | 'Memory'
  | 'Interaction';

interface LogEntry {
  ts: number; // Relative timestamp in ms
  lvl: LogLevel;
  cat: LogCategory;
  msg: string;
  meta?: any;
}

class LogManager {
  private logs: Array<LogEntry> = [];
  private maxLogs = 1000; // Lower limit to keep high signal-to-noise ratio
  private startTime = Date.now();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Cache strictly for calculating diffs between log events
  private stateCache = new Map<string, any>();

  // Check debug mode from environment (supports Vite and Node.js)
  private isDebug =
    (typeof import.meta !== 'undefined' &&
      (import.meta as any).env?.VITE_DEBUG_MODE === 'true') ||
    (typeof process !== 'undefined' &&
      typeof process.env !== 'undefined' &&
      process.env.DEBUG === 'true');

  constructor() {
    // Auto-enable verbose logging in dev environments if needed
    if (typeof window !== 'undefined') {
      (window as any).__MOSAIC_LOGGER__ = this;
    }
  }

  private add(
    level: LogLevel,
    category: LogCategory,
    message: string,
    meta?: any,
  ) {
    // 1. Console Output (Keep it rich for developers)
    this.printToConsole(level, category, message, meta);

    // 2. Storage (Sanitize specifically for LLM context windows)
    let storedMeta = meta;

    // Special handling for State Updates (Diffing)
    // If an ID is provided, we track changes over time instead of full dumps.
    if (message.includes('State Change') && meta?.id) {
      const prev = this.stateCache.get(meta.id);
      if (prev) {
        const diff = getObjectDiff(prev, meta.newState);
        storedMeta = { diff }; // Only store what changed
      } else {
        storedMeta = { initialState: meta.newState };
      }
      // Update cache for next time
      this.stateCache.set(meta.id, meta.newState);
    }
    // Handle SQL: Just store the string, drop the heavy AST objects
    else if (category === 'SQL' && typeof meta?.sql === 'string') {
      storedMeta = { sql: meta.sql };
    }

    // Clone and sanitize immediately to prevent mutation issues and memory leaks
    const sanitizedMeta = storedMeta
      ? JSON.parse(JSON.stringify(storedMeta, llmFriendlyReplacer()))
      : undefined;

    this.logs.push({
      ts: Date.now() - this.startTime, // Relative time is easier to track causality
      lvl: level,
      cat: category,
      msg: message,
      meta: sanitizedMeta,
    });

    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  private printToConsole(
    level: LogLevel,
    category: LogCategory,
    message: string,
    meta?: any,
  ) {
    // Only log to console if debug mode is enabled
    if (!this.isDebug) {
      return;
    }

    const style = this.getConsoleStyle(category, level);
    // Use groupCollapsed to keep the console clean but explorable
    if (meta) {
      console.groupCollapsed(`%c[${category}] ${message}`, style);
      console.log(meta);
      console.groupEnd();
    } else {
      console.log(`%c[${category}] ${message}`, style);
    }
  }

  /**
   * Debounces a log entry. Useful for high-frequency events like brush selections or scroll updates.
   * Only the last log entry within the `delay` window for a given `id` will be recorded.
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
   * Stub for memory logging to maintain interface compatibility.
   */
  logMemory(_coordinator: Coordinator, _label: string) {
    // No-op
  }

  /**
   * Generates an LLM-Optimized Log Dump.
   * Format: JSON Lines (JSONL)
   * Why: Easier for LLMs to read line-by-line without parsing a massive start/end object.
   */
  download() {
    // Guard for SSR/Node.js environments
    if (typeof document === 'undefined') {
      return;
    }

    const header = {
      generated: new Date().toISOString(),
      sessionDuration: `${((Date.now() - this.startTime) / 1000).toFixed(1)}s`,
      system: 'Mosaic Adapter Logs',
      instructions:
        "Timestamps are relative (ms). 'diff' fields show state changes.",
    };

    // Convert logs to JSONL strings
    const lines = this.logs.map((entry) => {
      return JSON.stringify(entry);
    });

    const output = [JSON.stringify(header), ...lines].join('\n');

    const blob = new Blob([output], { type: 'application/x-jsonlines' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debug-session-${Date.now()}.jsonl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Helper: Color code console logs by category
  private getConsoleStyle(category: LogCategory, level: LogLevel): string {
    if (level === 'error') {
      return 'color: #ff0000; font-weight: bold;';
    }
    switch (category) {
      case 'SQL':
        return 'color: #8e44ad; font-weight: bold;';
      case 'TanStack-Table':
        return 'color: #e67e22; font-weight: bold;';
      case 'Mosaic':
        return 'color: #2980b9; font-weight: bold;';
      case 'Framework':
        return 'color: #27ae60; font-weight: bold;';
      default:
        return 'color: gray;';
    }
  }
}

export const logger = new LogManager();
