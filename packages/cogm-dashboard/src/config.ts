import 'dotenv/config';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Centralised, typed configuration for the Co-GM dashboard.
 *
 * Everything is sourced from environment variables (loaded from a local `.env`
 * via dotenv) with sensible defaults so the dashboard runs out of the box
 * against a bridge on the standard 127.0.0.1:31414 control channel. No secrets
 * are ever hard-coded — the Anthropic key only comes from the environment.
 */

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export type Tone = 'tactical' | 'narrative';

export interface Config {
  /** HTTP port the dashboard (and its SSE stream) listens on. */
  readonly port: number;
  /** MCP backend control-channel host (JSON-lines TCP). */
  readonly mcpHost: string;
  /** MCP backend control-channel port. */
  readonly mcpPort: number;
  /** How often to poll the session-event delta, in ms. */
  readonly pollIntervalMs: number;
  /** How often to poll combat state, in ms. */
  readonly combatPollIntervalMs: number;
  /** Minimum spacing between auto-generated AI comments, in ms. */
  readonly commentMinIntervalMs: number;
  /** Debounce window used to batch a burst of events into one comment, in ms. */
  readonly commentDebounceMs: number;
  /** Anthropic API key (empty string ⇒ AI features disabled, feed still runs). */
  readonly anthropicApiKey: string;
  /** Default Claude model id. */
  readonly anthropicModel: string;
  /** Starting commentary tone. */
  readonly defaultTone: Tone;
  /** Rolling window size for the in-memory event buffer. */
  readonly maxEvents: number;
  /** Token cap for an auto-generated comment. */
  readonly commentMaxTokens: number;
  /** Token cap for an "ask the co-GM" answer. */
  readonly askMaxTokens: number;
  /** How often to poll module diagnostics (errors/warnings), in ms. */
  readonly errorPollIntervalMs: number;
  /** Rolling window size for the in-memory module-error buffer. */
  readonly maxErrors: number;
  /** Whether the co-GM auto-comments on new module errors. */
  readonly commentOnErrors: boolean;
  /** Minimum spacing between diagnostics comments, in ms. */
  readonly errorCommentMinIntervalMs: number;
  /** Token cap for a diagnostics comment. */
  readonly errorCommentMaxTokens: number;
  /** Control-channel per-request reply timeout, in ms. */
  readonly controlRequestTimeoutMs: number;
  /** Control-channel TCP connect timeout, in ms. */
  readonly controlConnectTimeoutMs: number;
  /** Control-channel heartbeat cadence, in ms. */
  readonly controlHeartbeatIntervalMs: number;
  /** Window after last activity before the control channel is treated as stale, in ms. */
  readonly controlStalenessThresholdMs: number;
  /** Absolute path to the static frontend assets. */
  readonly publicDir: string;
  /** Log verbosity. */
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readString(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw !== undefined && raw.trim() !== '' ? raw.trim() : fallback;
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

const pollIntervalMs = readNumber('POLL_INTERVAL_MS', 4000);

const tone: Tone = readString('COGM_TONE', 'tactical') === 'narrative' ? 'narrative' : 'tactical';

const logLevelRaw = readString('LOG_LEVEL', 'info');
const logLevel: Config['logLevel'] =
  logLevelRaw === 'debug' || logLevelRaw === 'warn' || logLevelRaw === 'error'
    ? logLevelRaw
    : 'info';

export const config: Config = {
  port: readNumber('PORT', 3000),
  mcpHost: readString('MCP_CONTROL_HOST', '127.0.0.1'),
  mcpPort: readNumber('MCP_CONTROL_PORT', 31414),
  pollIntervalMs,
  combatPollIntervalMs: readNumber('COMBAT_POLL_INTERVAL_MS', pollIntervalMs),
  commentMinIntervalMs: readNumber('COMMENT_MIN_INTERVAL_MS', 20000),
  commentDebounceMs: readNumber('COMMENT_DEBOUNCE_MS', 1500),
  anthropicApiKey: readString('ANTHROPIC_API_KEY', ''),
  anthropicModel: readString('ANTHROPIC_MODEL', 'claude-opus-4-8'),
  defaultTone: tone,
  maxEvents: readNumber('COGM_MAX_EVENTS', 80),
  commentMaxTokens: readNumber('COGM_COMMENT_MAX_TOKENS', 320),
  askMaxTokens: readNumber('COGM_ASK_MAX_TOKENS', 700),
  errorPollIntervalMs: readNumber('ERROR_POLL_INTERVAL_MS', 6000),
  maxErrors: readNumber('COGM_MAX_ERRORS', 100),
  commentOnErrors: readBool('COGM_COMMENT_ON_ERRORS', true),
  errorCommentMinIntervalMs: readNumber('ERROR_COMMENT_MIN_INTERVAL_MS', 60000),
  errorCommentMaxTokens: readNumber('COGM_ERROR_COMMENT_MAX_TOKENS', 280),
  controlRequestTimeoutMs: readNumber('MCP_REQUEST_TIMEOUT_MS', 15000),
  controlConnectTimeoutMs: readNumber('MCP_CONNECT_TIMEOUT_MS', 5000),
  controlHeartbeatIntervalMs: readNumber('MCP_HEARTBEAT_INTERVAL_MS', 10000),
  controlStalenessThresholdMs: readNumber('MCP_STALENESS_THRESHOLD_MS', 30000),
  publicDir: path.join(moduleDir, '..', 'public'),
  logLevel,
};
