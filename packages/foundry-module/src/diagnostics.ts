import { MODULE_ID } from './constants.js';

/**
 * Diagnostics — captures runtime errors/warnings from the Foundry client so the
 * MCP server can surface them on demand for troubleshooting other modules.
 *
 * It hooks console.error / console.warn, window 'error', and 'unhandledrejection',
 * buffers the last N entries (attributing each to the offending module/system by
 * parsing the stack), and persists the buffer to localStorage so it survives the
 * page reloads that typically follow a load-time module error.
 *
 * Filename is deliberately NOT "*tracking*" — ad blockers block such filenames
 * and would break the module for players.
 *
 * Everything here is defensive: capturing a diagnostic must never throw or break
 * the page, and console wrappers always chain to the original.
 */

export interface DiagnosticEntry {
  id: string;
  timestamp: string; // ISO
  timestampMs: number;
  level: 'error' | 'warn';
  message: string;
  stack: string | null;
  source: string | null;
  /** "module:<id>" / "system:<id>" / "world:<id>" parsed from the stack, or null. */
  module: string | null;
  kind: 'console' | 'window-error' | 'unhandledrejection';
  userName: string | null;
}

const MAX_ENTRIES = 500;
const STORAGE_KEY = `${MODULE_ID}.diagnostics`;

export class Diagnostics {
  private buffer: DiagnosticEntry[] = [];
  private installed = false;
  private seq = 0;

  private nextId(): string {
    this.seq += 1;
    return `diag-${Date.now().toString(36)}-${this.seq}`;
  }

  /**
   * Install the capture hooks. Idempotent. Call as early as possible (module
   * top-level) so the earliest errors are caught.
   */
  install(): void {
    if (this.installed) return;
    this.installed = true;

    try {
      this.restore();
    } catch {
      // ignore corrupt persisted buffer
    }

    try {
      const origError = console.error.bind(console);
      const origWarn = console.warn.bind(console);

      console.error = (...args: any[]) => {
        try {
          this.captureConsole('error', args);
        } catch {
          /* never break logging */
        }
        origError(...args);
      };
      console.warn = (...args: any[]) => {
        try {
          this.captureConsole('warn', args);
        } catch {
          /* never break logging */
        }
        origWarn(...args);
      };

      window.addEventListener('error', (ev: any) => {
        try {
          this.capture({
            level: 'error',
            kind: 'window-error',
            message: ev?.message || String(ev?.error?.message || ev?.error || 'Uncaught error'),
            stack: ev?.error?.stack ?? null,
            source: ev?.filename ? `${ev.filename}:${ev.lineno ?? '?'}:${ev.colno ?? '?'}` : null,
          });
        } catch {
          /* best-effort */
        }
      });

      window.addEventListener('unhandledrejection', (ev: any) => {
        try {
          const reason = ev?.reason;
          this.capture({
            level: 'error',
            kind: 'unhandledrejection',
            message: (reason && reason.message) || String(reason ?? 'Unhandled promise rejection'),
            stack: reason?.stack ?? null,
            source: null,
          });
        } catch {
          /* best-effort */
        }
      });

      console.log(`[${MODULE_ID}] Diagnostics installed (${this.buffer.length} buffered)`);
    } catch (error) {
      console.warn(`[${MODULE_ID}] Failed to install diagnostics:`, error);
    }
  }

  private captureConsole(level: 'error' | 'warn', args: any[]): void {
    const errArg = args.find(a => a instanceof Error);
    const message = args.map(a => this.format(a)).join(' ');
    this.capture({
      level,
      kind: 'console',
      message,
      stack: errArg?.stack ?? null,
      source: null,
    });
  }

  private format(a: any): string {
    if (a instanceof Error) return a.message;
    if (typeof a === 'string') return a;
    if (typeof a === 'object' && a !== null) {
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    }
    return String(a);
  }

  private capture(p: {
    level: 'error' | 'warn';
    kind: DiagnosticEntry['kind'];
    message: string;
    stack: string | null;
    source: string | null;
  }): void {
    const haystack = `${p.stack || ''} ${p.source || ''} ${p.message || ''}`;
    const entry: DiagnosticEntry = {
      id: this.nextId(),
      timestamp: new Date().toISOString(),
      timestampMs: Date.now(),
      level: p.level,
      message: String(p.message ?? '').slice(0, 2000),
      stack: p.stack ? String(p.stack).slice(0, 4000) : null,
      source: p.source,
      module: this.attribute(haystack),
      kind: p.kind,
      userName: (globalThis as any).game?.user?.name ?? null,
    };

    this.buffer.push(entry);
    if (this.buffer.length > MAX_ENTRIES) {
      this.buffer.splice(0, this.buffer.length - MAX_ENTRIES);
    }
    this.persist();
  }

  /** Parse the first /modules|systems|worlds/<id>/ path out of a stack/message. */
  private attribute(haystack: string): string | null {
    const m = /\/(modules|systems|worlds)\/([A-Za-z0-9_.\-]+)\//.exec(haystack || '');
    if (!m) return null;
    const kind = m[1] === 'modules' ? 'module' : m[1] === 'systems' ? 'system' : 'world';
    return `${kind}:${m[2]}`;
  }

  private persist(): void {
    try {
      window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.buffer.slice(-MAX_ENTRIES)));
    } catch {
      // storage may be full/unavailable; in-memory buffer still works
    }
  }

  private restore(): void {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      this.buffer = parsed.slice(-MAX_ENTRIES);
    }
  }

  // ===========================================================================
  // Accessors (used by the data-access layer)
  // ===========================================================================

  getErrors(
    filters: {
      level?: 'error' | 'warn';
      moduleId?: string;
      sinceTimestamp?: string;
      limit?: number;
    } = {}
  ): DiagnosticEntry[] {
    let entries = this.buffer.slice();

    if (filters.level) entries = entries.filter(e => e.level === filters.level);
    if (filters.moduleId) {
      const needle = filters.moduleId.toLowerCase();
      entries = entries.filter(e => (e.module || '').toLowerCase().includes(needle));
    }
    if (filters.sinceTimestamp) {
      const since = Date.parse(filters.sinceTimestamp);
      if (!Number.isNaN(since)) entries = entries.filter(e => e.timestampMs > since);
    }

    const limit = Math.min(Math.max(filters.limit ?? 100, 1), MAX_ENTRIES);
    return entries.slice(-limit);
  }

  /** Counts by attributed module + level — a quick triage summary. */
  summary(): { total: number; byModule: Record<string, number>; byLevel: Record<string, number> } {
    const byModule: Record<string, number> = {};
    const byLevel: Record<string, number> = {};
    for (const e of this.buffer) {
      const key = e.module || 'unattributed';
      byModule[key] = (byModule[key] || 0) + 1;
      byLevel[e.level] = (byLevel[e.level] || 0) + 1;
    }
    return { total: this.buffer.length, byModule, byLevel };
  }

  clear(): number {
    const n = this.buffer.length;
    this.buffer = [];
    try {
      window.localStorage?.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    return n;
  }
}

/** Singleton, mirroring the eventTracker pattern. */
export const diagnostics = new Diagnostics();
