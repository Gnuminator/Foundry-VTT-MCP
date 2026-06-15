import type { Logger } from '../logger.js';
import type { ModuleError } from '../feed/types.js';
import type { CoGm } from './anthropic-co-gm.js';
import { buildErrorCommentMessage, isSignificantError } from './prompt.js';

/**
 * Turns new module errors into an occasional AI "likely cause + fix" comment.
 *
 * Deliberately quiet: only `error`-level entries (not deprecation warnings), each
 * distinct message commented at most once, debounced and spaced by its own
 * (longer) min-interval, and it never preempts an in-flight combat comment or
 * "ask" — it defers while the model is busy. Toggleable independently of the
 * combat-commentary pause.
 */

export type Broadcast = (type: string, payload: unknown) => void;

export interface ErrorCommentarySettings {
  getModel(): string;
  isEnabled(): boolean;
}

export interface ErrorCommentaryDeps {
  coGm: CoGm;
  logger: Logger;
  broadcast: Broadcast;
  settings: ErrorCommentarySettings;
  minIntervalMs: number;
  debounceMs: number;
  maxTokens: number;
}

export class ErrorCommentaryEngine {
  private pending: ModuleError[] = [];
  private timer: NodeJS.Timeout | null = null;
  private lastCommentAt = 0;
  private genSeq = 0;
  private readonly seenMessages = new Set<string>();
  private readonly logger: Logger;

  constructor(private readonly deps: ErrorCommentaryDeps) {
    this.logger = deps.logger.child('diagnostics');
  }

  notifyErrors(errors: ModuleError[]): void {
    const fresh = errors.filter(e => isSignificantError(e) && !this.seenMessages.has(e.message));
    if (fresh.length === 0) return;
    for (const e of fresh) this.seenMessages.add(e.message);
    if (this.seenMessages.size > 300) {
      // Bound the dedup set; the recent fresh batch stays remembered.
      this.seenMessages.clear();
      for (const e of fresh) this.seenMessages.add(e.message);
    }
    this.pending.push(...fresh);
    this.schedule(this.deps.debounceMs);
  }

  private schedule(delayMs: number): void {
    if (!this.deps.coGm.enabled || !this.deps.settings.isEnabled()) return;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delayMs);
  }

  private async flush(): Promise<void> {
    if (!this.deps.coGm.enabled || !this.deps.settings.isEnabled()) {
      this.pending = [];
      return;
    }
    if (this.pending.length === 0) return;

    const sinceLast = Date.now() - this.lastCommentAt;
    if (sinceLast < this.deps.minIntervalMs) {
      this.schedule(this.deps.minIntervalMs - sinceLast);
      return;
    }
    // Combat commentary and direct questions take priority — wait, don't preempt.
    if (this.deps.coGm.isBusy) {
      this.schedule(2000);
      return;
    }

    const errors = this.pending;
    this.pending = [];
    const model = this.deps.settings.getModel();
    const genId = `diag${(this.genSeq += 1)}-${Date.now().toString(36)}`;
    this.lastCommentAt = Date.now();
    const trigger = errors[0]?.message?.slice(0, 120) ?? 'module error';

    this.logger.debug('Generating diagnostics comment', { genId, errors: errors.length });
    this.deps.broadcast('comment.start', {
      id: genId,
      kind: 'diagnostic',
      tone: 'technical',
      model,
      trigger,
    });
    try {
      const result = await this.deps.coGm.stream({
        model,
        maxTokens: this.deps.maxTokens,
        userMessage: buildErrorCommentMessage(errors),
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
      this.logger.error('Diagnostics comment failed', { genId, error: message });
      this.deps.broadcast('comment.error', { id: genId, message });
    }
  }
}
