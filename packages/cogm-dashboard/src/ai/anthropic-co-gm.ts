import Anthropic from '@anthropic-ai/sdk';
import type { Logger } from '../logger.js';
import type { WorldInfo } from '../feed/types.js';
import { buildSystemPrompt } from './prompt.js';

/**
 * Thin wrapper around the Anthropic Messages API for the co-GM.
 *
 * Design points:
 *  - Streaming (`messages.stream`) so the browser sees tokens as they arrive.
 *  - The large static persona/rules/campaign block carries a `cache_control`
 *    breakpoint and is byte-identical every call, so it is served from the
 *    prompt cache after the first request — the volatile game state lives in the
 *    user turn and is never cached. Each request is independent (no growing
 *    conversation), which keeps the model's context bounded.
 *  - Latest-wins concurrency: starting a new generation aborts the previous one
 *    (so a direct "ask the co-GM" can preempt an in-flight auto-comment).
 *  - Disabled gracefully when no API key is present — the feed still runs.
 */

export interface StreamUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheHit: boolean;
}

export interface StreamRequest {
  model: string;
  userMessage: string;
  maxTokens: number;
  onDelta: (text: string) => void;
}

export interface StreamResult {
  text: string;
  usage: StreamUsage;
  aborted: boolean;
}

function emptyUsage(): StreamUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheHit: false,
  };
}

function mapUsage(usage: Anthropic.Usage): StreamUsage {
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    cacheHit: cacheRead > 0,
  };
}

export class CoGm {
  private readonly client: Anthropic | null;
  private readonly logger: Logger;
  private world: WorldInfo | null = null;
  private active: AbortController | null = null;
  private generating = false;

  constructor(apiKey: string, logger: Logger) {
    this.logger = logger.child('cogm');
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
    if (!this.client) {
      this.logger.warn('ANTHROPIC_API_KEY not set — AI commentary is disabled (feed still runs)');
    }
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  get isBusy(): boolean {
    return this.generating;
  }

  setWorld(world: WorldInfo | null): void {
    this.world = world;
  }

  /** Abort any in-flight generation. */
  abortActive(): void {
    if (this.active) this.active.abort();
  }

  async stream(request: StreamRequest): Promise<StreamResult> {
    if (!this.client) {
      throw new Error('AI is disabled (no ANTHROPIC_API_KEY).');
    }

    // Latest-wins: cancel any previous generation before starting this one.
    this.abortActive();
    const controller = new AbortController();
    this.active = controller;
    this.generating = true;

    const system: Anthropic.TextBlockParam[] = [
      {
        type: 'text',
        text: buildSystemPrompt({ world: this.world }),
        cache_control: { type: 'ephemeral' },
      },
    ];

    try {
      const stream = this.client.messages.stream(
        {
          model: request.model,
          max_tokens: request.maxTokens,
          system,
          messages: [{ role: 'user', content: request.userMessage }],
        },
        { signal: controller.signal }
      );

      stream.on('text', (delta: string) => request.onDelta(delta));

      const final = await stream.finalMessage();
      const text = final.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('');

      const usage = mapUsage(final.usage);
      this.logger.info('Generation complete', {
        model: request.model,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheHit: usage.cacheHit,
      });
      return { text, usage, aborted: false };
    } catch (error) {
      if (error instanceof Anthropic.APIUserAbortError) {
        return { text: '', usage: emptyUsage(), aborted: true };
      }
      throw error;
    } finally {
      if (this.active === controller) {
        this.active = null;
        this.generating = false;
      }
    }
  }
}
