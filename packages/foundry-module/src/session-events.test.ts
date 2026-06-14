/**
 * Unit tests for the EventTracker.
 *
 * The EventTracker is the part of the chat-log / play-by-play / session-log
 * pipeline that can be tested without a live Foundry: we stub the small set of
 * Foundry globals it touches (`Hooks`, `CONST`, `game`), fire synthetic
 * `createChatMessage` / `updateActor` / combat hooks at it, and assert on the
 * buffers and the (pure) play-by-play synthesis it produces.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Minimal Foundry global harness -----------------------------------------

type HookFn = (...args: any[]) => void;
let hooks: Record<string, HookFn[]> = {};

function fire(event: string, ...args: any[]): void {
  for (const cb of hooks[event] ?? []) cb(...args);
}

beforeEach(() => {
  hooks = {};
  (globalThis as any).Hooks = {
    on: (name: string, cb: HookFn) => {
      (hooks[name] ??= []).push(cb);
    },
    once: (_name: string, _cb: HookFn) => {
      // no-op in tests; we don't fire 'ready' so seedCaches stays inert
    },
  };
  (globalThis as any).CONST = {
    CHAT_MESSAGE_STYLES: { OTHER: 0, OOC: 1, IC: 2, EMOTE: 3 },
    DICE_ROLL_MODES: { PUBLIC: 'publicroll', PRIVATE: 'gmroll' },
  };
  (globalThis as any).game = {
    settings: { get: () => 200 },
    actors: { get: () => undefined },
    users: { get: (id: string) => ({ name: `User-${id}` }) },
  };
  // Ensure foundry.utils is absent so getProp uses its manual fallback.
  delete (globalThis as any).foundry;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

// Import after the harness type is in place (module construction is side-effect free).
import { EventTracker } from './session-events.js';

// --- Synthetic message builders ---------------------------------------------

function attackMessage(over: Partial<any> = {}): any {
  return {
    id: 'atk',
    timestamp: 1000,
    speaker: { alias: 'Silvera', actor: 'actor1' },
    rolls: [
      {
        formula: '2d20kh + 5',
        total: 25,
        dice: [
          {
            faces: 20,
            number: 2,
            modifiers: ['kh'],
            results: [
              { result: 20, active: true },
              { result: 12, active: false },
            ],
          },
        ],
        terms: [],
        options: { advantageMode: 1 },
      },
    ],
    flavor: 'Longsword Attack',
    content: '<div>attack</div>',
    style: 2,
    whisper: [],
    ...over,
  };
}

function damageMessage(over: Partial<any> = {}): any {
  return {
    id: 'dmg',
    timestamp: 2000,
    speaker: { alias: 'Silvera', actor: 'actor1' },
    rolls: [
      {
        formula: '1d8 + 3',
        total: 9,
        dice: [{ faces: 8, results: [{ result: 6, active: true }] }],
        terms: [{ options: { flavor: 'slashing' } }],
        options: {},
      },
    ],
    flavor: 'Longsword Damage',
    flags: { dnd5e: { roll: { type: 'damage' } } },
    content: '',
    style: 2,
    whisper: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe('EventTracker chat parsing', () => {
  it('parses an advantage crit attack roll', () => {
    const t = new EventTracker();
    t.registerHooks();
    fire('createChatMessage', attackMessage());

    const [entry] = t.getChatLog();
    expect(entry.speakerName).toBe('Silvera');
    expect(entry.actorId).toBe('actor1');
    expect(entry.messageType).toBe('roll');
    expect(entry.isRoll).toBe(true);
    expect(entry.roll).not.toBeNull();
    expect(entry.roll!.total).toBe(25);
    expect(entry.roll!.isCritical).toBe(true);
    expect(entry.roll!.isFumble).toBe(false);
    expect(entry.roll!.advantage).toBe('advantage');
    expect(entry.roll!.dice[0]).toEqual({ faces: 20, results: [20, 12] });
  });

  it('detects a natural-1 fumble and disadvantage', () => {
    const t = new EventTracker();
    t.registerHooks();
    fire(
      'createChatMessage',
      attackMessage({
        rolls: [
          {
            formula: '2d20kl + 5',
            total: 6,
            dice: [
              {
                faces: 20,
                number: 2,
                modifiers: ['kl'],
                results: [
                  { result: 1, active: true },
                  { result: 14, active: false },
                ],
              },
            ],
            terms: [],
            options: { advantageMode: -1 },
          },
        ],
      })
    );

    const [entry] = t.getChatLog();
    expect(entry.roll!.isFumble).toBe(true);
    expect(entry.roll!.isCritical).toBe(false);
    expect(entry.roll!.advantage).toBe('disadvantage');
  });

  it('parses a damage roll with damage type and logs a session damage event', () => {
    const t = new EventTracker();
    t.registerHooks();
    fire('createChatMessage', damageMessage());

    const [entry] = t.getChatLog();
    expect(entry.messageType).toBe('damage');
    expect(entry.damage).not.toBeNull();
    expect(entry.damage!.total).toBe(9);
    expect(entry.damage!.types).toEqual(['slashing']);

    const events = t.getSessionLog({ eventType: 'damage-roll' });
    expect(events).toHaveLength(1);
    expect(events[0].details.total).toBe(9);
  });

  it('classifies ic / ooc / emote / whisper messages', () => {
    const t = new EventTracker();
    t.registerHooks();
    fire('createChatMessage', {
      id: 'ic',
      timestamp: 10,
      speaker: { alias: 'Bartender' },
      rolls: [],
      content: 'Welcome!',
      style: 2,
      whisper: [],
    });
    fire('createChatMessage', {
      id: 'ooc',
      timestamp: 11,
      speaker: { alias: 'Greg' },
      rolls: [],
      content: 'brb',
      style: 1,
      whisper: [],
    });
    fire('createChatMessage', {
      id: 'em',
      timestamp: 12,
      speaker: { alias: 'Greg' },
      rolls: [],
      content: 'waves',
      style: 3,
      whisper: [],
    });
    fire('createChatMessage', {
      id: 'wh',
      timestamp: 13,
      speaker: { alias: 'GM' },
      rolls: [],
      content: 'psst',
      style: 0,
      whisper: ['u1'],
    });

    const log = t.getChatLog();
    expect(log.map(e => e.messageType)).toEqual(['ic', 'ooc', 'emote', 'whisper']);
    expect(log[3].whisperTo).toEqual(['User-u1']);
  });

  it('applies limit, speaker, type and since filters', () => {
    const t = new EventTracker();
    t.registerHooks();
    fire('createChatMessage', attackMessage({ id: 'a', timestamp: 1000 }));
    fire('createChatMessage', damageMessage({ id: 'd', timestamp: 2000 }));
    fire('createChatMessage', {
      id: 'chat',
      timestamp: 3000,
      speaker: { alias: 'Goblin' },
      rolls: [],
      content: 'grr',
      style: 2,
      whisper: [],
    });

    expect(t.getChatLog({ messageType: 'roll' }).map(e => e.id)).toEqual(['a', 'd']);
    expect(t.getChatLog({ messageType: 'damage' }).map(e => e.id)).toEqual(['d']);
    expect(t.getChatLog({ speakerName: 'silvera' }).map(e => e.id)).toEqual(['a', 'd']);
    expect(t.getChatLog({ limit: 1 }).map(e => e.id)).toEqual(['chat']);
    expect(t.getChatLog({ sinceTimestamp: new Date(1500).toISOString() }).map(e => e.id)).toEqual([
      'd',
      'chat',
    ]);
  });

  it('trims the chat buffer to the configured size', () => {
    (globalThis as any).game.settings.get = () => 3;
    const t = new EventTracker();
    t.registerHooks();
    for (let i = 0; i < 10; i++) {
      fire('createChatMessage', {
        id: `m${i}`,
        timestamp: i,
        speaker: { alias: 'X' },
        rolls: [],
        content: '',
        style: 2,
        whisper: [],
      });
    }
    const log = t.getChatLog({ limit: 200 });
    expect(log).toHaveLength(3);
    expect(log.map(e => e.id)).toEqual(['m7', 'm8', 'm9']);
  });
});

describe('EventTracker session events', () => {
  it('detects damage and death from HP changes', () => {
    const t = new EventTracker();
    t.registerHooks();
    const goblin = { id: 'g1', name: 'Goblin' };
    // First sighting seeds the cache (no event).
    fire('updateActor', goblin, { system: { attributes: { hp: { value: 5 } } } });
    // Drop to 0 → damage + death.
    fire('updateActor', goblin, { system: { attributes: { hp: { value: 0 } } } });

    expect(t.getSessionLog({ eventType: 'damage' })).toHaveLength(1);
    expect(t.getSessionLog({ eventType: 'damage' })[0].details.amount).toBe(5);
    expect(t.getSessionLog({ eventType: 'death' })).toHaveLength(1);
  });

  it('detects healing and stabilization', () => {
    const t = new EventTracker();
    t.registerHooks();
    const pc = { id: 'p1', name: 'Tulkas' };
    fire('updateActor', pc, { system: { attributes: { hp: { value: 0 } } } });
    fire('updateActor', pc, { system: { attributes: { hp: { value: 8 } } } });

    expect(t.getSessionLog({ eventType: 'healing' })).toHaveLength(1);
    expect(t.getSessionLog({ eventType: 'stabilize' })).toHaveLength(1);
  });

  it('detects spell-slot expenditure', () => {
    const t = new EventTracker();
    t.registerHooks();
    const caster = { id: 'c1', name: 'Silvera' };
    fire('updateActor', caster, { system: { spells: { spell3: { value: 2 } } } });
    fire('updateActor', caster, { system: { spells: { spell3: { value: 1 } } } });

    const spent = t.getSessionLog({ eventType: 'resource-spent' });
    expect(spent).toHaveLength(1);
    expect(spent[0].details).toMatchObject({ resource: 'spell3', from: 2, to: 1 });
  });

  it('logs condition apply/remove and scene changes', () => {
    const t = new EventTracker();
    t.registerHooks();
    fire('createActiveEffect', {
      name: 'Prone',
      parent: { id: 'g1', name: 'Goblin' },
      statuses: new Set(['prone']),
    });
    fire('deleteActiveEffect', {
      name: 'Prone',
      parent: { id: 'g1', name: 'Goblin' },
      statuses: new Set(['prone']),
    });
    fire('updateScene', { id: 's2', name: 'Throne Room' }, { active: true });

    expect(t.getSessionLog({ eventType: 'condition-applied' })).toHaveLength(1);
    expect(t.getSessionLog({ eventType: 'condition-removed' })).toHaveLength(1);
    expect(t.getSessionLog({ eventType: 'scene-change' })).toHaveLength(1);
  });
});

describe('EventTracker combat play-by-play', () => {
  it('groups actions into rounds using the recorded turn timeline', () => {
    const t = new EventTracker();
    t.registerHooks();

    fire('combatStart', {
      id: 'c1',
      round: 1,
      combatants: { size: 1 },
      combatant: { name: 'Silvera', actor: { id: 'actor1' } },
    });

    // Chat after combat start (timestamps must be >= the combat-start time).
    const base = Date.now() + 100;
    fire('createChatMessage', attackMessage({ id: 'a', timestamp: base + 1 }));
    fire('createChatMessage', damageMessage({ id: 'd', timestamp: base + 2 }));

    const pbp = t.buildPlayByPlay({ round: 1, started: true });
    expect(pbp.combatActive).toBe(true);
    expect(pbp.totalRounds).toBe(1);
    expect(pbp.rounds).toHaveLength(1);
    expect(pbp.rounds[0]!.turns[0].combatant).toBe('Silvera');
    expect(pbp.rounds[0]!.turns[0].actions).toHaveLength(2);
    expect(pbp.summary.damageByActor).toEqual({ Silvera: 9 });
    expect(pbp.summary.note).toBeNull();
  });

  it('degrades gracefully to a single round when no timeline was recorded', () => {
    const t = new EventTracker();
    t.registerHooks();
    fire('createChatMessage', attackMessage({ id: 'a', timestamp: 1000 }));
    fire('createChatMessage', damageMessage({ id: 'd', timestamp: 2000 }));

    const pbp = t.buildPlayByPlay({ round: 2, started: false });
    expect(pbp.combatActive).toBe(false);
    expect(pbp.totalRounds).toBe(2);
    expect(pbp.rounds).toHaveLength(1);
    expect(pbp.rounds[0]!.turns[0].combatant).toBe('(unattributed)');
    expect(pbp.summary.note).toMatch(/no per-turn timeline/i);
    expect(pbp.summary.damageByActor).toEqual({ Silvera: 9 });
  });
});
