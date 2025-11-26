// packages/mosaic-tanstack-table-core/src/trimmed/logger.ts
// A simple in-memory logger that allows downloading logs as a file.
// This replaces direct console usage to reduce noise and aid debugging.

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: any[];
}

class LogManager {
  private logs: LogEntry[] = [];
  private maxLogs = 5000;
  private isEnabled = true;

  private add(level: LogLevel, message: string, ...data: any[]) {
    if (!this.isEnabled) return;

    // Still print to console for immediate feedback, but maybe cleaner?
    // For now, we mirror to console.
    if (level === 'error') console.error(message, ...data);
    else if (level === 'warn') console.warn(message, ...data);
    else console.log(`[${level.toUpperCase()}] ${message}`, ...data);

    this.logs.push({
      timestamp: new Date().toISOString(),
      level,
      message,
      data: data.map((d) => {
        try {
          return JSON.parse(JSON.stringify(d)); // Snapshot objects
        } catch {
          return String(d);
        }
      }),
    });

    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  info(message: string, ...data: any[]) {
    this.add('info', message, ...data);
  }

  warn(message: string, ...data: any[]) {
    this.add('warn', message, ...data);
  }

  error(message: string, ...data: any[]) {
    this.add('error', message, ...data);
  }

  debug(message: string, ...data: any[]) {
    this.add('debug', message, ...data);
  }

  clear() {
    this.logs = [];
  }

  download() {
    const text = this.logs
      .map(
        (l) =>
          `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message} ${
            l.data && l.data.length ? JSON.stringify(l.data) : ''
          }`,
      )
      .join('\n');

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mosaic-table-logs-${new Date().toISOString()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

export const logger = new LogManager();