import * as net from 'net';
import { EventEmitter } from 'events';
import type { Logger } from '../logger.js';

/**
 * Long-lived client for the MCP backend's JSON-lines control channel
 * (127.0.0.1:31414 by default). Speaks the same newline-delimited protocol the
 * mcp-server wrapper uses:
 *
 *   request  → {"id","method":"call_tool","params":{"name","args"}}\n
 *   response ← {"id","result":{...}} | {"id","error":{"message"}}\n
 *
 * A successful `call_tool` wraps the tool output as
 *   { content: [{ type: "text", text: "<json-or-plain>" }], isError?: true }
 * so `callTool` unwraps `content[0].text` and JSON-parses it when possible.
 *
 * The backend cycles and restarts frequently and can go HALF-OPEN (the TCP
 * connection stays ESTABLISHED while the process is dead or wedged). The client
 * is built to detect and recover from that, not just from clean disconnects:
 *
 *   - TCP keepalive + a connect timeout so the OS/handshake can't wedge us.
 *   - An application-level heartbeat (`ping`) that force-reconnects on silence.
 *   - A request timeout that tears the socket down (not just rejects one call),
 *     so a stalled channel reconnects instead of looping 15s timeouts forever.
 *   - A liveness-aware `isConnected` so consumers never trust a stale "up".
 *
 * Read-only and never spawns a backend — it is a pure client and reconnects
 * with backoff whenever the socket drops.
 *
 * Emits: `connected`, `disconnected` (Error).
 */

const MAX_BUFFER_BYTES = 1_000_000;

/** The control channel/transport failed (down, write error, protocol error). */
export class ChannelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChannelError';
  }
}

/** A request exceeded its timeout — strong evidence the channel is dead/half-open. */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/** The backend executed the tool but it reported an error (e.g. Foundry not connected). */
export class ToolError extends Error {
  constructor(
    message: string,
    readonly toolName: string
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface ControlResponse {
  id?: string;
  result?: unknown;
  error?: { message?: string };
}

interface ToolResultPayload {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
}

export interface McpControlClientOptions {
  host: string;
  port: number;
  logger: Logger;
  /** Per-request reply timeout. A timeout tears the socket down. */
  requestTimeoutMs?: number;
  /** Bound on the TCP handshake so a wedged backend can't hang us at connect. */
  connectTimeoutMs?: number;
  /** Heartbeat ping cadence once connected. */
  heartbeatIntervalMs?: number;
  /** Consecutive heartbeat failures before forcing a reconnect. */
  maxHeartbeatFailures?: number;
  /** TCP keepalive initial delay. */
  keepAliveMs?: number;
  /** Window after the last successful activity before `isConnected` reports stale. */
  stalenessThresholdMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

export class McpControlClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private buffer = '';
  private connected = false;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatFailures = 0;
  private lastActivityAt = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly logger: Logger;
  private readonly requestTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly maxHeartbeatFailures: number;
  private readonly keepAliveMs: number;
  private readonly stalenessThresholdMs: number;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;

  constructor(private readonly options: McpControlClientOptions) {
    super();
    this.logger = options.logger.child('control');
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15000;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 10000;
    this.maxHeartbeatFailures = options.maxHeartbeatFailures ?? 2;
    this.keepAliveMs = options.keepAliveMs ?? 10000;
    this.stalenessThresholdMs = options.stalenessThresholdMs ?? 30000;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 500;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 5000;
  }

  /**
   * Liveness-aware: true only while the socket is connected AND we have seen a
   * response within the staleness window. A half-open socket that has gone quiet
   * reports false so consumers stop trusting a dead channel.
   */
  get isConnected(): boolean {
    return this.connected && Date.now() - this.lastActivityAt < this.stalenessThresholdMs;
  }

  /** Begin connecting (and keep reconnecting until `close()`). */
  start(): void {
    this.stopped = false;
    this.openSocket();
  }

  /** Stop the client: cancel reconnects, reject in-flight calls, destroy socket. */
  close(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.rejectAll(new ChannelError('Control client closed'));
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
  }

  /** Health check used by the heartbeat. */
  async ping(): Promise<boolean> {
    const result = (await this.send('ping')) as { ok?: boolean } | undefined;
    return result?.ok === true;
  }

  /** List the tools the backend exposes. */
  async listTools(): Promise<unknown[]> {
    const result = (await this.send('list_tools')) as { tools?: unknown[] } | undefined;
    return result?.tools ?? [];
  }

  /**
   * Invoke a backend tool and return its (JSON-parsed) result. Throws a typed
   * error: ToolError if the tool reported a failure, TimeoutError on a stalled
   * channel, ChannelError if the channel is down.
   */
  async callTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const payload = (await this.send('call_tool', { name, args })) as ToolResultPayload | undefined;
    const text = payload?.content?.[0]?.text;

    if (payload?.isError) {
      throw new ToolError(
        typeof text === 'string' ? text : `Tool "${name}" reported an error`,
        name
      );
    }
    if (typeof text !== 'string') {
      return payload as unknown as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      // Some tools return a plain string rather than serialized JSON.
      return text as unknown as T;
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.connected) {
        reject(new ChannelError('Control channel not connected'));
        return;
      }

      const id = `cogm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const request: { id: string; method: string; params?: Record<string, unknown> } = {
        id,
        method,
      };
      if (params !== undefined) request.params = params;

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new TimeoutError(`Request "${method}" timed out after ${this.requestTimeoutMs}ms`));
        // A reply never came on a socket we believe is up — the channel is
        // almost certainly dead/half-open. Tear it down so we reconnect instead
        // of looping per-request timeouts against a corpse.
        if (this.connected) {
          this.failConnection(new TimeoutError(`Control channel timeout on "${method}"`));
        }
      }, this.requestTimeoutMs);
      timer.unref();

      this.pending.set(id, { resolve, reject, timer });

      try {
        this.socket.write(`${JSON.stringify(request)}\n`, 'utf8');
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        const err = error instanceof Error ? error : new Error('Write failed');
        reject(new ChannelError(err.message));
        // A synchronous write throw means the stream is broken — recover the
        // whole channel rather than only this one request.
        if (this.connected) this.failConnection(err);
      }
    });
  }

  private openSocket(): void {
    if (this.stopped || this.socket) return;

    const { host, port } = this.options;
    const socket = net.createConnection({ host, port });
    // Assign eagerly so the re-entrancy guard above and close() both see the
    // in-flight connecting socket (otherwise it leaks / can resurrect a closed
    // client when it finally connects).
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.setNoDelay(true);

    // Bound the TCP handshake; cleared on connect so it can't double as an idle
    // timeout afterwards (liveness post-connect is keepalive + heartbeat).
    socket.setTimeout(this.connectTimeoutMs);
    socket.once('timeout', () => {
      socket.destroy(new Error('Control channel connect timeout'));
    });

    socket.on('connect', () => {
      if (this.stopped) {
        socket.destroy();
        return;
      }
      socket.setTimeout(0);
      socket.setKeepAlive(true, this.keepAliveMs);
      this.connected = true;
      this.reconnectAttempt = 0;
      this.buffer = '';
      this.lastActivityAt = Date.now();
      this.heartbeatFailures = 0;
      this.startHeartbeat(socket);
      this.logger.info('Connected to MCP control channel', { host, port });
      this.emit('connected');
    });

    socket.on('data', (chunk: string) => this.onData(chunk));

    socket.on('error', error => {
      // `close` will follow; just record the reason for the reconnect log.
      this.logger.debug('Control socket error', { error: error.message });
    });

    socket.on('close', () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.socket = null;
      this.stopHeartbeat();
      socket.removeAllListeners();
      this.rejectAll(new ChannelError('Control channel disconnected'));
      if (wasConnected) {
        this.emit('disconnected', new ChannelError('Control channel disconnected'));
      }
      this.scheduleReconnect();
    });
  }

  /** Idempotent teardown: destroying the socket routes through the close path. */
  private failConnection(reason: Error): void {
    const socket = this.socket;
    if (socket && !socket.destroyed) {
      socket.destroy(reason);
    } else {
      // Nothing live to destroy — make sure a reconnect is armed anyway.
      this.scheduleReconnect();
    }
  }

  private startHeartbeat(socket: net.Socket): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      // Only probe the socket this heartbeat belongs to.
      if (this.socket !== socket) {
        this.stopHeartbeat();
        return;
      }
      this.ping()
        .then(ok => {
          if (ok) {
            this.heartbeatFailures = 0;
          } else if (++this.heartbeatFailures >= this.maxHeartbeatFailures) {
            this.logger.warn('Control heartbeat failing, forcing reconnect');
            this.failConnection(new ChannelError('Heartbeat failed'));
          }
        })
        .catch(() => {
          if (++this.heartbeatFailures >= this.maxHeartbeatFailures) {
            this.logger.warn('Control heartbeat timed out, forcing reconnect');
            this.failConnection(new ChannelError('Heartbeat timeout'));
          }
        });
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.heartbeatFailures = 0;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(
      this.reconnectBaseMs * Math.pow(1.6, this.reconnectAttempt),
      this.reconnectMaxMs
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
    this.reconnectTimer.unref();
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > MAX_BUFFER_BYTES) {
      this.logger.warn('Control buffer overflow, resetting connection');
      this.buffer = '';
      this.failConnection(new ChannelError('Control buffer overflow'));
      return;
    }

    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;

      let message: ControlResponse;
      try {
        message = JSON.parse(line) as ControlResponse;
      } catch (error) {
        this.logger.debug('Failed to parse control line', { error: (error as Error).message });
        continue;
      }

      // Any well-formed frame is proof of life.
      this.lastActivityAt = Date.now();

      if (message.id === undefined) {
        // Protocol-level error with no id to correlate (e.g. bad request).
        this.logger.debug('Uncorrelated control message', { error: message.error?.message });
        continue;
      }

      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);

      if (message.error) {
        pending.reject(new ChannelError(message.error.message ?? 'Unknown control error'));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
