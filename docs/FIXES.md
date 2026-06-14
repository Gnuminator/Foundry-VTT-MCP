# Fixes Applied (v0.9.0 fork)

This document lists the bugs and correctness issues fixed in this fork beyond the upstream
`adambdooley/foundry-vtt-mcp` baseline. Most were surfaced by a code review of the new v0.9.0
code; each entry says **what** was wrong, **why** it mattered, and **how** it was fixed.

See also: [BUILT.md](BUILT.md) (what was added), [FEATURE-IDEAS.md](FEATURE-IDEAS.md), [ROADMAP.md](ROADMAP.md).

---

## High severity

### `send-chat-message` posted "whispers" publicly when targets didn't resolve

- **Was:** if `messageType: "whisper"` but none of the supplied user names matched, the message was
  created with an empty whisper array — i.e. **publicly visible to everyone**. A privacy leak.
- **Now:** if no whisper target resolves, the message falls back to whispering the GM(s) and the
  response includes a `warning`. A whisper can never silently become public.
- **File:** `packages/foundry-module/src/data-access.ts` (`sendChatMessage`).

### `send-chat-message` used an invalid speaker for the GM/world voice

- **Was:** `ChatMessage.getSpeaker({ user: game.user })`. `getSpeaker` accepts `{scene, actor, token,
alias}` — there is no `user` key, so the speaker fell back to default logic and the returned
  `speaker.alias` could be wrong/null.
- **Now:** `ChatMessage.getSpeaker({ alias: game.user?.name })` for the GM/world voice.
- **File:** `data-access.ts` (`sendChatMessage`).

### `get-combat-state` "has acted" flag was mislabeled / round-0 wrong

- **Was:** `hasActed: (combat.round ?? 0) > 0 ? idx < currentIndex : false` — an ambiguous global flag.
- **Now:** renamed to **`actedThisRound`** and gated on `combat.started`. The turn index resets to 0
  each round, so `idx < currentTurn` is the correct "already acted this round" test.
- **File:** `data-access.ts` (`getCombatState`).

---

## Medium severity

### `get-active-effects` classified every status-bearing effect as a "condition"

- **Was:** `isCondition = statuses.some(isRegistered) || statuses.length > 0` — the trailing clause made
  the registered-condition lookup pointless, so buffs that carry a status (e.g. a spell applying
  `concentrating`) were mislabeled as conditions.
- **Now:** an effect is a condition only when its status id is a registered `CONFIG.statusEffects`
  condition.
- **File:** `data-access.ts` (`getActiveEffects`).

### Chat messages were classified using `message.type` (wrong type on Foundry v13)

- **Was:** `classifyMessage` read `message.style ?? message.type`. In Foundry v13 `message.type` is the
  document **subtype** (a string), not the numeric chat style — so IC/OOC/emote classification was
  unreliable.
- **Now:** classifies on `message.style` only.
- **File:** `packages/foundry-module/src/event-tracking.ts` (`classifyMessage`).

### Session log dropped the first HP/resource change after world load

- **Was:** the HP and spell-slot/resource caches were only populated inside `updateActor`, so the
  first damage/heal/death/spend of a session had no baseline to diff against and produced no event.
- **Now:** caches are seeded from current actor state on the `ready` hook, so the first change of the
  session is detected.
- **File:** `event-tracking.ts` (`seedCaches`, called from `registerHooks`).

---

## Low severity

### `update-character-resource` couldn't write item charges on dnd5e v3+

- **Was:** wrote `system.uses.value`, which in dnd5e v3+ is a **derived, read-only getter**
  (`max - spent`); the write was silently ignored.
- **Now:** writes `system.uses.spent` when present (v3+), falling back to `value` for legacy data.
- **File:** `data-access.ts` (`updateCharacterResource`).

### `measure-distance` returned confidently-wrong numbers for off-canvas hex scenes

- **Was:** when the scene wasn't the one on the canvas, hex grids fell back to a Euclidean
  calculation (wrong for hex) with no indication.
- **Now:** the fallback flags the result with `approximate: true` for hex grids. Square/gridless
  measurements (D&D 5e Chebyshev) are unchanged.
- **File:** `data-access.ts` (`measureDistance`).

---

## Diagnostics added (not yet a fix)

### Roll-request button "does nothing when clicked"

A player reported that clicking a `request-player-rolls` button did nothing. The click-handler chain
(`renderChatMessageHTML` hook → `attachRollButtonHandlers`) and the character→player resolution both
look correct on inspection, so the root cause needs the **player's browser-console output from a live
click** to pin down.

A diagnostic line was added to `attachRollButtonHandlers`:

```
[foundry-mcp-bridge] attachRollButtonHandlers: N button(s) for user "<name>" (GM=…)
```

Triage (see `test-bench/README.md`):

- **Line absent** when the player clicks → the render hook never attached handlers on their client
  (Foundry-version hook mismatch, or the module not initialising for non-GM users) — leading suspect.
- **Line present but nothing happens** → look for `Permission denied for roll execution` or a thrown
  `roll.toMessage` error.

This remains open pending that console output.

---

## Verification

All fixes are covered by: a clean `npm run build`, the EventTracker unit suite
(`npm test -w @foundry-mcp/module`, 12 tests), and the MCP schema smoke test
(`node scripts/mcp-schema-smoke-test.mjs`).
