/**
 * Simple logging utility with configurable levels
 */

export enum LogLevel {
  DEBUG = 0,
  WARN = 1,
  ERROR = 2
}

class Logger {
  private level: LogLevel = LogLevel.WARN;
  private prefix = '[Vale Plugin]';

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(...args: unknown[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.debug(this.prefix, ...args);
    }
  }

  warn(...args: unknown[]): void {
    if (this.level <= LogLevel.WARN) {
      console.warn(this.prefix, ...args);
    }
  }

  error(...args: unknown[]): void {
    if (this.level <= LogLevel.ERROR) {
      console.error(this.prefix, ...args);
    }
  }
}

export const logger = new Logger();
