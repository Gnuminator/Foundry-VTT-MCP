/**
 * Shapes for the live game feed. These mirror the JSON returned by the MCP
 * bridge tools `get-recent-events` and `get-combat-state` (see the Foundry
 * module's session-events / data-access layers). The feed itself is exposed
 * behind the `GameFeed` interface so the polling implementation can later be
 * swapped for a push-based (e.g. WebRTC) source without touching consumers.
 */

/** One significant session event (combat, damage, condition, resource, etc.). */
export interface SessionEvent {
  id: string;
  timestamp: string;
  timestampMs: number;
  eventType: string;
  actorName: string | null;
  actorId: string | null;
  description: string;
  details: Record<string, unknown>;
}

export interface CombatantHp {
  value: number;
  max: number;
  temp: number;
}

export interface DeathSaves {
  successes: number;
  failures: number;
}

export interface Combatant {
  id: string;
  name: string;
  initiative: number | null;
  isCurrentTurn: boolean;
  actedThisRound: boolean;
  hp: CombatantHp;
  conditions: string[];
  isPC: boolean;
  category: string; // 'pc' | 'npc' | 'enemy'
  defeated: boolean;
  deathSaves: DeathSaves | null;
}

export interface CombatState {
  active: boolean;
  round: number;
  turn: number;
  current: Combatant | null;
  combatants: Combatant[];
}

/** Lightweight world descriptor used to seed the AI's static context. */
export interface WorldInfo {
  title: string;
  systemId: string;
  systemVersion: string;
  foundryVersion: string;
  gmNames: string[];
}

export type ControlChannelStatus = 'connected' | 'disconnected';
export type FoundryReachability = 'reachable' | 'unreachable' | 'unknown';

export interface BridgeStatus {
  controlChannel: ControlChannelStatus;
  foundry: FoundryReachability;
  lastError: string | null;
  lastPollAt: string | null;
}

export interface GameFeedHandlers {
  onEvents(events: SessionEvent[], meta: { initial: boolean }): void;
  onCombat(combat: CombatState | null): void;
  onStatus(status: BridgeStatus): void;
}

/**
 * A source of live game data. The polling implementation satisfies this today;
 * a future WebRTC/push feed can implement the same surface.
 */
export interface GameFeed {
  start(): void;
  stop(): void;
}
