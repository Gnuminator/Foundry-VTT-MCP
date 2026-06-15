import type { Combatant, CombatState, ModuleError, SessionEvent } from './feed/types.js';

/**
 * Bounded in-memory view of the game. Keeps a rolling window of recent events
 * and the latest combat snapshot — deliberately NOT the full session history —
 * so the context handed to the model stays small and cost-controlled.
 */
export class GameState {
  private events: SessionEvent[] = [];
  private readonly seen = new Set<string>();
  private errors: ModuleError[] = [];
  private readonly seenErrors = new Set<string>();
  private combatState: CombatState | null = null;

  constructor(
    private readonly maxEvents = 80,
    private readonly maxErrors = 100
  ) {}

  /** Merge new events (de-duplicated by id), keeping only the newest `maxEvents`. Returns those actually added. */
  addEvents(incoming: SessionEvent[]): SessionEvent[] {
    const added: SessionEvent[] = [];
    for (const event of incoming) {
      if (this.seen.has(event.id)) continue;
      this.seen.add(event.id);
      added.push(event);
    }
    if (added.length === 0) return added;

    this.events.push(...added);
    this.events.sort((a, b) => a.timestampMs - b.timestampMs);
    if (this.events.length > this.maxEvents) {
      const removed = this.events.splice(0, this.events.length - this.maxEvents);
      for (const event of removed) this.seen.delete(event.id);
    }
    return added;
  }

  get recentEvents(): SessionEvent[] {
    return this.events.slice();
  }

  /** Merge new module errors (de-duplicated by id), keeping the newest `maxErrors`. Returns those added. */
  addErrors(incoming: ModuleError[]): ModuleError[] {
    const added: ModuleError[] = [];
    for (const error of incoming) {
      if (this.seenErrors.has(error.id)) continue;
      this.seenErrors.add(error.id);
      added.push(error);
    }
    if (added.length === 0) return added;

    this.errors.push(...added);
    this.errors.sort((a, b) => a.timestampMs - b.timestampMs);
    if (this.errors.length > this.maxErrors) {
      const removed = this.errors.splice(0, this.errors.length - this.maxErrors);
      for (const error of removed) this.seenErrors.delete(error.id);
    }
    return added;
  }

  get recentErrors(): ModuleError[] {
    return this.errors.slice();
  }

  get combat(): CombatState | null {
    return this.combatState;
  }

  setCombat(combat: CombatState | null): void {
    this.combatState = combat;
  }

  /**
   * Signature that changes on any combat beat worth a co-GM comment: a turn/round
   * advance, OR a combatant crossing 0 HP, being defeated, or gaining/losing a
   * condition mid-turn. HP is bucketed (down/up, not exact) so routine chip
   * damage doesn't trigger, but the dramatic transitions do.
   */
  combatSignature(): string | null {
    if (!this.combatState) return null;
    const { round, turn, current, combatants } = this.combatState;
    const perCombatant = combatants
      .map(
        c =>
          `${c.id}:${c.hp.value <= 0 ? 'down' : 'up'}:${c.defeated ? 'D' : ''}:${[...c.conditions]
            .sort()
            .join(',')}`
      )
      .join('|');
    return `${round}:${turn}:${current?.id ?? 'none'}|${perCombatant}`;
  }

  /**
   * Compact, human-readable snapshot for the model's volatile (uncached) turn:
   * a combat summary plus the most recent events. Bounded by design.
   */
  buildContext(maxRecentEvents = 25): string {
    const lines: string[] = [];

    if (this.combatState && this.combatState.active) {
      const { round, turn, current, combatants } = this.combatState;
      lines.push(`# Combat — round ${round}, turn ${turn}`);
      if (current) {
        lines.push(`Active combatant: ${describeCombatant(current)}`);
      }
      const order = combatants
        .filter(c => !c.defeated)
        .slice(0, 16)
        .map(c => `  - ${describeCombatant(c)}`);
      if (order.length > 0) {
        lines.push('Initiative order (active):');
        lines.push(...order);
      }
      const downed = combatants.filter(c => c.defeated).length;
      if (downed > 0) lines.push(`(${downed} combatant(s) down/defeated)`);
    } else {
      lines.push('# Combat — none active');
    }

    const recent = this.events.slice(-maxRecentEvents);
    lines.push('');
    lines.push(`# Recent events (${recent.length})`);
    if (recent.length === 0) {
      lines.push('  (no recent events)');
    } else {
      for (const event of recent) {
        const stamp = new Date(event.timestampMs).toLocaleTimeString();
        lines.push(`  [${stamp}] (${event.eventType}) ${event.description}`);
      }
    }

    return lines.join('\n');
  }
}

function describeCombatant(c: Combatant): string {
  const hp = `${c.hp.value}/${c.hp.max}${c.hp.temp ? ` (+${c.hp.temp} temp)` : ''} HP`;
  const init = c.initiative ?? '—';
  const side = c.isPC ? 'PC' : c.category === 'enemy' ? 'enemy' : 'NPC';
  const conditions = c.conditions.length > 0 ? ` [${c.conditions.join(', ')}]` : '';
  const turn = c.isCurrentTurn ? ' ◀ current' : '';
  return `${c.name} (${side}, init ${init}): ${hp}${conditions}${turn}`;
}
