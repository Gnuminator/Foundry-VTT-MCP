import type { Response } from 'express';
import type { Logger } from './logger.js';

/**
 * Tiny Server-Sent Events hub. Each connected dashboard tab is a long-lived
 * `text/event-stream` response; the server pushes named events to all of them.
 * A periodic comment-line heartbeat keeps proxies and browsers from closing an
 * idle connection.
 */
export class SseHub {
  private readonly clients = new Set<Response>();
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child('sse');
  }

  add(res: Response): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    this.clients.add(res);
    this.logger.debug('Client connected', { clients: this.clients.size });

    res.on('close', () => {
      this.clients.delete(res);
      this.logger.debug('Client disconnected', { clients: this.clients.size });
    });

    if (!this.heartbeat) {
      this.heartbeat = setInterval(() => this.ping(), 15000);
      this.heartbeat.unref();
    }
  }

  /** End every client stream and stop the heartbeat (for a clean shutdown). */
  close(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    for (const res of this.clients) {
      try {
        res.end();
      } catch {
        // already closed
      }
    }
    this.clients.clear();
  }

  /** Send to a single client (used for the initial snapshot on connect). */
  send(res: Response, type: string, payload: unknown): void {
    try {
      res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch {
      this.clients.delete(res);
    }
  }

  /** Broadcast a named event to every connected client. */
  broadcast(type: string, payload: unknown): void {
    const frame = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of this.clients) {
      try {
        res.write(frame);
      } catch {
        this.clients.delete(res);
      }
    }
  }

  private ping(): void {
    for (const res of this.clients) {
      try {
        res.write(': ping\n\n');
      } catch {
        this.clients.delete(res);
      }
    }
  }

  get size(): number {
    return this.clients.size;
  }
}
