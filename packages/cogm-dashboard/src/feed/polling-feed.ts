import type { Logger } from '../logger.js';
import {
  ChannelError,
  type McpControlClient,
  TimeoutError,
  ToolError,
} from './mcp-control-client.js';
import type {
  BridgeStatus,
  Combatant,
  CombatState,
  FoundryReachability,
  GameFeed,
  GameFeedHandlers,
  SessionEvent,
} from './types.js';

/**
 * Polling implementation of `GameFeed`.
 *
 * - Polls `get-recent-events` every `pollIntervalMs`, using the returned
 *   `latestTimestamp` as the incremental cursor so only new events come back.
 * - Polls `get-combat-state` every `combatPollIntervalMs` for the tracker.
 *
 * Hardened for a backend that cycles/half-opens and is contended by multiple
 * clients:
 *  - Re-entrancy guards so a slow poll never overlaps itself.
 *  - Cursor + backfill reset on every (re)connect so a restarted/cleared event
 *    log is re-read instead of silently skipped.
 *  - Monotonic, boundary-safe cursor advance (out-of-order replies can't rewind
 *    it; a quiet first poll never seeds an exclusive boundary that drops events).
 *  - Typed-error classification with hysteresis so a transient/contended failure
 *    or a dead transport doesn't flap the Foundry-reachability badge.
 *
 * A failed poll never throws out of the feed — it downgrades the reported status
 * and retries on the next tick.
 */

/** Consecutive unexplained tool failures before declaring Foundry unreachable. */
const FOUNDRY_FAILURE_THRESHOLD = 3;

interface RecentEventsResponse {
  success?: boolean;
  events?: SessionEvent[];
  latestTimestamp?: string | null;
  serverTime?: string;
}

interface RawCombatResponse {
  success?: boolean;
  active?: boolean;
  round?: number;
  turn?: number;
  current?: Combatant | null;
  combatants?: Combatant[];
}

export interface PollingFeedOptions {
  pollIntervalMs: number;
  combatPollIntervalMs: number;
  /** How many recent events to backfill on first connect. */
  backfillLimit?: number;
  logger: Logger;
}

export class PollingGameFeed implements GameFeed {
  private readonly logger: Logger;
  private cursor: string | null = null;
  private firstEventPoll = true;
  private eventPollInFlight = false;
  private combatPollInFlight = false;
  private eventTimer: NodeJS.Timeout | null = null;
  private combatTimer: NodeJS.Timeout | null = null;
  private started = false;
  private foundry: FoundryReachability = 'unknown';
  private consecutiveFailures = 0;
  private lastError: string | null = null;
  private lastPollAt: string | null = null;
  private lastStatusKey = '';
  private readonly backfillLimit: number;

  constructor(
    private readonly client: McpControlClient,
    private readonly handlers: GameFeedHandlers,
    private readonly options: PollingFeedOptions
  ) {
    this.logger = options.logger.child('feed');
    this.backfillLimit = options.backfillLimit ?? 25;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    this.client.on('connected', () => {
      // A reconnect may mean a restarted/cleared backend event buffer — re-seed
      // so a stale cursor can't suppress live events, and re-backfill history.
      this.foundry = 'unknown';
      this.cursor = null;
      this.firstEventPoll = true;
      this.consecutiveFailures = 0;
      this.publishStatus();
      // Kick an immediate poll so the UI populates without waiting a full tick.
      void this.pollEvents();
      void this.pollCombat();
    });

    this.client.on('disconnected', (error: Error) => {
      this.foundry = 'unknown';
      this.lastError = error.message;
      this.publishStatus();
    });

    this.client.start();

    this.eventTimer = setInterval(() => void this.pollEvents(), this.options.pollIntervalMs);
    this.combatTimer = setInterval(() => void this.pollCombat(), this.options.combatPollIntervalMs);
    this.publishStatus();
  }

  stop(): void {
    if (this.eventTimer) clearInterval(this.eventTimer);
    if (this.combatTimer) clearInterval(this.combatTimer);
    this.eventTimer = null;
    this.combatTimer = null;
    this.client.close();
    this.started = false;
  }

  // ---------------------------------------------------------------------------

  private async pollEvents(): Promise<void> {
    if (!this.client.isConnected || this.eventPollInFlight) return;
    this.eventPollInFlight = true;
    try {
      const args: Record<string, unknown> =
        this.cursor !== null
          ? { sinceTimestamp: this.cursor, limit: 100 }
          : { limit: this.backfillLimit };

      const response = await this.client.callTool<RecentEventsResponse>('get-recent-events', args);
      const events = Array.isArray(response.events) ? response.events : [];

      this.onPollSuccess();

      if (events.length > 0) {
        this.handlers.onEvents(events, { initial: this.firstEventPoll });
      }

      // Advance the cursor monotonically: never let an out-of-order reply rewind
      // it. On a quiet first poll we leave it null (re-backfill next time) rather
      // than seeding from the exclusive serverTime boundary, which would drop any
      // event recorded at that instant. GameState de-dups by id, so re-reads are
      // free.
      this.cursor = this.maxTimestamp(this.cursor, response.latestTimestamp ?? null);
      this.firstEventPoll = false;
      this.publishStatus();
    } catch (error) {
      this.handlePollError('get-recent-events', error);
    } finally {
      this.eventPollInFlight = false;
    }
  }

  private async pollCombat(): Promise<void> {
    if (!this.client.isConnected || this.combatPollInFlight) return;
    this.combatPollInFlight = true;
    try {
      const response = await this.client.callTool<RawCombatResponse>('get-combat-state');
      const combat = this.mapCombat(response);

      this.onPollSuccess();
      this.handlers.onCombat(combat);
      this.publishStatus();
    } catch (error) {
      this.handlePollError('get-combat-state', error);
    } finally {
      this.combatPollInFlight = false;
    }
  }

  private onPollSuccess(): void {
    this.consecutiveFailures = 0;
    this.foundry = 'reachable';
    this.lastError = null;
    this.lastPollAt = new Date().toISOString();
  }

  private maxTimestamp(a: string | null, b: string | null): string | null {
    if (a === null) return b;
    if (b === null) return a;
    return Date.parse(b) > Date.parse(a) ? b : a;
  }

  private mapCombat(response: RawCombatResponse): CombatState | null {
    if (!response.active) return null;
    return {
      active: true,
      round: response.round ?? 0,
      turn: response.turn ?? 0,
      current: response.current ?? null,
      combatants: Array.isArray(response.combatants) ? response.combatants : [],
    };
  }

  private handlePollError(tool: string, error: unknown): void {
    const message = error instanceof Error ? error.message : 'Unknown poll error';
    this.lastError = message;

    if (error instanceof ChannelError || error instanceof TimeoutError) {
      // The control channel/transport is the problem — we know nothing about
      // Foundry, so report 'unknown' rather than blaming the game.
      this.foundry = 'unknown';
      this.consecutiveFailures = 0;
    } else if (error instanceof ToolError && /module not connected/i.test(message)) {
      // The backend is up but Foundry's module link is down — genuinely unreachable.
      this.foundry = 'unreachable';
      this.consecutiveFailures = 0;
    } else {
      // Transient/unknown tool error — keep the last verdict sticky and only
      // downgrade after sustained failures, to avoid flapping on one bad tick.
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= FOUNDRY_FAILURE_THRESHOLD) {
        this.foundry = 'unreachable';
      }
    }

    this.logger.debug(`Poll failed: ${tool}`, { error: message });
    this.publishStatus();
  }

  /** Publish status only when a meaningful field changes (lastPollAt excluded). */
  private publishStatus(): void {
    const controlChannel = this.client.isConnected ? 'connected' : 'disconnected';
    const key = `${controlChannel}|${this.foundry}|${this.lastError ?? ''}`;
    if (key === this.lastStatusKey) return;
    this.lastStatusKey = key;

    const status: BridgeStatus = {
      controlChannel,
      foundry: this.foundry,
      lastError: this.lastError,
      lastPollAt: this.lastPollAt,
    };
    this.handlers.onStatus(status);
  }
}
