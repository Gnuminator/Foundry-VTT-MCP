import type { Tone } from '../config.js';
import type { Logger } from '../logger.js';
import type { SessionEvent } from '../feed/types.js';
import type { GameState } from '../state.js';
import type { CoGm } from './anthropic-co-gm.js';
import { buildCommentUserMessage, describeTrigger, isSignificant } from './prompt.js';

/**
 * Turns a stream of significant game events (and combat turn changes) into a
 * paced trickle of AI comments.
 *
 * Guarantees:
 *  - Never one comment per event. A burst is collected over a short debounce
 *    window and condensed into a single comment.
 *  - Comments are spaced at least `minIntervalMs` apart (frequency cap).
 *  - Honours the pause switch and never fires when AI is disabled.
 *  - Never interrupts an in-flight generation (e.g. a direct "ask"); it waits.
 */

export type Broadcast = (type: string, payload: unknown) => void;

export interface CommentarySettings {
  getTone(): Tone;
  getModel(): string;
  isPaused(): boolean;
}

export interface CommentaryEngineDeps {
  coGm: CoGm;
  state: GameState;
  logger: Logger;
  broadcast: Broadcast;
  settings: CommentarySettings;
  minIntervalMs: number;
  debounceMs: number;
  maxTokens: number;
}

export class CommentaryEngine {
  private pendingEvents: SessionEvent[] = [];
  private combatChanged = false;
  private timer: NodeJS.Timeout | null = null;
  private lastCommentAt = 0;
  private genSeq = 0;
  private readonly logger: Logger;

  constructor(private readonly deps: CommentaryEngineDeps) {
    this.logger = deps.logger.child('commentary');
  }

  notifyEvents(events: SessionEvent[]): void {
    const significant = events.filter(isSignificant);
    if (significant.length === 0) return;
    this.pendingEvents.push(...significant);
    this.schedule(this.deps.debounceMs);
  }

  notifyCombatChange(): void {
    this.combatChanged = true;
    this.schedule(this.deps.debounceMs);
  }

  private schedule(delayMs: number): void {
    if (!this.deps.coGm.enabled || this.deps.settings.isPaused()) return;
    if (this.timer) return; // a flush is already pending; events keep accumulating
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delayMs);
  }

  private async flush(): Promise<void> {
    if (!this.deps.coGm.enabled || this.deps.settings.isPaused()) {
      this.clearPending();
      return;
    }
    if (this.pendingEvents.length === 0 && !this.combatChanged) return;

    // Enforce the minimum spacing between comments.
    const sinceLast = Date.now() - this.lastCommentAt;
    if (sinceLast < this.deps.minIntervalMs) {
      this.schedule(this.deps.minIntervalMs - sinceLast);
      return;
    }

    // Don't preempt an in-flight generation (e.g. an "ask"); retry shortly.
    if (this.deps.coGm.isBusy) {
      this.schedule(1000);
      return;
    }

    const events = this.pendingEvents;
    const combatChanged = this.combatChanged;
    this.clearPending();

    const tone = this.deps.settings.getTone();
    const model = this.deps.settings.getModel();
    const context = this.deps.state.buildContext();
    const current = this.deps.state.combat?.current?.name ?? null;
    const trigger = describeTrigger(events, combatChanged, current);

    const genId = `c${(this.genSeq += 1)}-${Date.now().toString(36)}`;
    this.lastCommentAt = Date.now();

    this.logger.debug('Generating comment', { genId, events: events.length, combatChanged, tone });
    this.deps.broadcast('comment.start', { id: genId, kind: 'commentary', tone, model, trigger });

    try {
      const result = await this.deps.coGm.stream({
        model,
        maxTokens: this.deps.maxTokens,
        userMessage: buildCommentUserMessage(tone, context, trigger),
        onDelta: text => this.deps.broadcast('comment.delta', { id: genId, text }),
      });
      if (result.aborted) {
        this.deps.broadcast('comment.aborted', { id: genId });
      } else {
        this.deps.broadcast('comment.done', {
          id: genId,
          text: result.text,
          usage: result.usage,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI error';
      this.logger.error('Commentary generation failed', { genId, error: message });
      this.deps.broadcast('comment.error', { id: genId, message });
    }
  }

  private clearPending(): void {
    this.pendingEvents = [];
    this.combatChanged = false;
  }
}
