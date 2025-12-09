/**
 * A structured logging utility designed for token efficiency and LLM readability.
 * It separates ephemeral console output (developer UX) from persistent storage (debugging).
 * It uses semantic diffing to reduce log noise.
 */

import { formatters } from './log-formatter';

export type LogCategory = 'Core' | 'Framework' | 'TanStack-Table' | 'Mosaic' | 'SQL';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface CompactLog {
  t: number; // Timestamp (ms)
  c: LogCategory; // Category
  l: LogLevel; // Level
  m: string; // Message
  d?: string; // Data/Diff (Stringified to save memory/tokens)
}

class LogManager {
  private logs: CompactLog[] = [];
  private startTime = Date.now();
  private maxLogs = 1000;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Keep track of the last known state to auto-calculate diffs per category
  private stateSnapshots: Record<string, any> = {};

  // Configuration
  public enabled = true;
  // Console levels: 0=Debug, 1=Info, 2=Warn, 3=Error
  private consoleLevel = 1;

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
    if (!this.enabled) return;

    // --- 1. Console Output (Developer UX) ---
    // We print to console if it meets the level requirement
    if (this.levelMap[level] >= this.consoleLevel) {
      this.printConsole(level, category, message, meta);
    }

    // --- 2. Storage Optimization (LLM Efficiency) ---
    let optimizedData: string | undefined;

    // Special handling for State Updates: Use Diffing
    if (message.includes('StateChange') && meta) {
      const stateKey = category; // simplified grouping by category for state tracking
      const diff = formatters.diff(this.stateSnapshots[stateKey] || {}, meta);

      if (!diff) return; // Ignore identical updates (Noise reduction)

      // Update snapshot for next time
      try {
        this.stateSnapshots[stateKey] = JSON.parse(JSON.stringify(meta));
      } catch {
        // Fallback if meta is not serializable
        this.stateSnapshots[stateKey] = meta;
      }
      optimizedData = diff;
    }
    // Special handling for SQL: Minify
    else if (category === 'SQL' && meta?.sql) {
      optimizedData = formatters.sql(meta.sql);
    }
    // Fallback: If meta exists but isn't special, simple stringify
    else if (meta) {
      try {
        optimizedData = JSON.stringify(meta);
        // Truncate huge objects
        if (optimizedData.length > 500) {
          optimizedData = optimizedData.substring(0, 500) + '...[TRUNCATED]';
        }
      } catch (e) {
        optimizedData = '[Circular/Unserializable]';
      }
    }

    this.logs.push({
      t: Date.now(),
      c: category,
      l: level,
      m: message,
      d: optimizedData,
    });

    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  /**
   * Debounces a log entry. Useful for high-frequency events like brush selections or scroll updates.
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

  /**
   * Generates a highly dense text report optimized for LLMs.
   */
  exportForLLM(): string {
    let output = `--- MOSAIC DEBUG LOG (Start: ${new Date(
      this.startTime,
    ).toISOString()}) ---\n`;
    output += `Format: [TimeDelta] [Category] Message | Data\n\n`;

    let lastTime = this.startTime;

    for (const log of this.logs) {
      const delta = log.t - lastTime;
      const timeStr = delta > 0 ? `+${delta}ms`.padEnd(7) : '0ms'.padEnd(7);
      const catStr = `[${log.c}]`.padEnd(16); // Padding for alignment

      let line = `${timeStr} ${catStr} ${log.m}`;
      if (log.d) {
        line += ` | ${log.d}`;
      }

      output += line + '\n';
      lastTime = log.t;
    }

    return output;
  }

  download() {
    const text = this.exportForLLM();
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mosaic-llm-logs-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Public Wrappers
  info(cat: LogCategory, msg: string, meta?: any) {
    this.add('info', cat, msg, meta);
  }
  debug(cat: LogCategory, msg: string, meta?: any) {
    this.add('debug', cat, msg, meta);
  }
  warn(cat: LogCategory, msg: string, meta?: any) {
    this.add('warn', cat, msg, meta);
  }
  error(cat: LogCategory, msg: string, meta?: any) {
    this.add('error', cat, msg, meta);
  }

  private printConsole(
    level: LogLevel,
    category: LogCategory,
    message: string,
    meta?: any,
  ) {
    const badge = `[${category}]`;
    const style = this.getConsoleStyle(category);

    if (level === 'error') {
      console.error(`%c${badge} ${message}`, style, meta || '');
    } else if (level === 'warn') {
      console.warn(`%c${badge} ${message}`, style, meta || '');
    } else {
      // For Info/Debug in console, use collapsed groups if meta exists
      if (meta) {
        console.groupCollapsed(`%c${badge} ${message}`, style);
        console.log(meta);
        console.groupEnd();
      } else {
        console.log(`%c${badge} ${message}`, style);
      }
    }
  }

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
      default:
        return 'color: gray;';
    }
  }
}

export const logger = new LogManager();