/**
 * Minimal leveled logger. Writes structured single-line records to stdout/stderr
 * (no `console` so it stays clear of the repo's `no-console` lint rule and is
 * trivial to redirect). Mirrors the child-logger ergonomics used elsewhere in
 * the monorepo.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function safeMeta(meta: unknown): string {
  if (meta === undefined) return '';
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return ' [unserializable meta]';
  }
}

export class Logger {
  constructor(
    private readonly level: LogLevel = 'info',
    private readonly scope = 'cogm'
  ) {}

  child(scope: string): Logger {
    return new Logger(this.level, `${this.scope}:${scope}`);
  }

  private emit(level: LogLevel, message: string, meta?: unknown): void {
    if (WEIGHT[level] < WEIGHT[this.level]) return;
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${this.scope}] ${message}${safeMeta(meta)}\n`;
    const stream = level === 'warn' || level === 'error' ? process.stderr : process.stdout;
    stream.write(line);
  }

  debug(message: string, meta?: unknown): void {
    this.emit('debug', message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.emit('info', message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.emit('warn', message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.emit('error', message, meta);
  }
}
