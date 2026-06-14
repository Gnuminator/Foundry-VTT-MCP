# What Was Built (v0.9.0 fork)

This fork extends `adambdooley/foundry-vtt-mcp` with **16 new MCP tools** plus the infrastructure
behind them, taking the bridge from ~40 to **56 tools**. The focus is live play: reading what's
happening at the table, posting back into it, and tracking session state.

See also: [FIXES.md](FIXES.md), [FEATURE-IDEAS.md](FEATURE-IDEAS.md), [ROADMAP.md](ROADMAP.md).

---

## Architecture (unchanged transport)

Every tool follows the existing pattern — no changes to the WebRTC/WebSocket transport:

```
Claude  →  MCP tool (packages/mcp-server/src/tools/*.ts)
        →  foundryClient.query('foundry-mcp-bridge.X', params)
        →  WebRTC / WebSocket
        →  CONFIG.queries['foundry-mcp-bridge.X']  (packages/foundry-module/src/queries.ts, GM-gated)
        →  FoundryDataAccess.X(...)               (packages/foundry-module/src/data-access.ts)
```

New message types were **added** to this generic dispatch, not substituted.

## New infrastructure

- **`packages/foundry-module/src/event-tracking.ts`** — an `EventTracker` singleton owning two
  in-browser rolling buffers for the session plus a combat turn timeline:
  - a **chat-log buffer** (parses every `createChatMessage`: rolls, totals, individual dice,
    crit/fumble, advantage/disadvantage, damage totals & types, flavor, message type);
  - a **session-event log** (combat start/end, HP changes, deaths/stabilizations, conditions,
    resource spend, scene changes, journals);
  - registered via Foundry hooks in the module init hook.
  - `buildPlayByPlay()` is a **pure** function (no Foundry globals) so it's unit-tested.
- **`chatLogBufferSize`** world setting (default 200) controls the chat buffer size.
- **Test bench** (`test-bench/`) — see [test-bench/README.md](../test-bench/README.md).
- **Unit tests** — `event-tracking.test.ts` (12 tests, synthetic-Foundry harness).

---

## The 16 new tools

### 3A — Chat log & combat play-by-play

- **`get-chat-log`** — buffered chat messages. Filters: `limit` (≤200), `speakerName`, `messageType`
  (`roll`|`damage`|`all`), `sinceTimestamp`. Each entry includes roll formula/total/dice,
  crit/fumble, advantage, damage total & types, flavor.
- **`get-combat-play-by-play`** — structured round-by-round summary of the current/most-recent
  combat (turns, actions, downs/deaths/stabilizations, total damage per actor). Degrades gracefully
  to a single aggregated round if combat began before the module loaded.
- **`send-chat-message`** — post as an actor or the GM/world; `ic` / `ooc` / `emote` / `whisper`.

### 3C — Resource tracking

- **`get-character-resources`** — spell slots (per level + pact), class resources (Ki, Rage, Sorcery
  Points, etc.), item charges, concentration, hit dice, death saves.
- **`update-character-resource`** — set a resource value (validated 0..max); accepts a spell level,
  `pact`, a class-resource label/key, or an item name.

### 3D — Active effects & conditions

- **`get-active-effects`** — all effects with type (condition vs buff/debuff), durations, modifiers,
  and concentration flag.
- **`clear-stale-conditions`** — remove expired conditions, or a named list.

### 3E — Initiative & turn tracker

- **`get-combat-state`** — full combat state: round, current turn, full initiative order with HP,
  conditions, PC/NPC/enemy category, `actedThisRound`, and death-save status for the downed.
- **`advance-combat-turn`** — next turn, or jump to a named combatant.
- **`set-initiative`** — set/override a combatant's initiative.

### 3F — Movement & positioning

- **`get-token-positions`** — all tokens on a scene with grid coords, elevation, category,
  visibility, HP, conditions.
- **`measure-distance`** — grid-aware distance between two tokens.

### 3G — Extended roll requests / NPC rolls

- **`request-ability-check`** — ability-check button to a player (shows DC).
- **`request-attack-roll`** — weapon/spell attack-roll button to a player.
- **`roll-npc-check`** — roll directly for an NPC and post the result (ability/save/skill/attack).

### 3H — Session event log

- **`get-session-log`** — the structured per-session memory; filter by `eventType` / `actorName`.

---

## Build & artifacts

- `npm run build` — full monorepo (TypeScript strict + `exactOptionalPropertyTypes`).
- `npm run bundle:server` — self-contained `dist/index.bundle.cjs` + `backend.bundle.cjs` (what
  Claude Desktop launches).
- Foundry module manifest: `packages/foundry-module/module.json` (v0.9.0).
- Full per-tool parameter/return reference lives in the project [README](../README.md)
  ("Combat, Chat & Session Tools").
