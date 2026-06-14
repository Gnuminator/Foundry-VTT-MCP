# Feature Ideas (researched & feasibility-checked)

Candidate new tools for the bridge, verified against the Foundry VTT v13/v14 core API and the dnd5e
system (v4/v5 Activity model). Each idea reuses the existing pattern: a `CONFIG.queries` handler in
the Foundry module + an MCP tool wrapper.

**Theme:** the bridge today can _observe_ and _request_, but cannot _resolve_ combat. The highest-value
additions close that loop — letting the AI co-GM actually run a D&D 5e round.

See also: [BUILT.md](BUILT.md), [ROADMAP.md](ROADMAP.md).

Legend — Feasibility: HIGH/MED/LOW · Effort: S/M/L.

---

## Tier 1 — Clearly feasible, high value

| #   | Tool                             | What it does                                                           | Key API                                                  | Feasibility                              | Effort |
| --- | -------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------- | ------ |
| 1   | **apply-damage-and-healing**     | Apply damage/healing/temp HP with proper resistance/vuln/immunity math | `Actor5e.applyDamage(damages, opts)`, `applyTempHP()`    | HIGH                                     | S      |
| 2   | **roll-saving-throws** (resolve) | Roll saves/checks/skills for NPCs and report pass/fail vs DC           | `Actor5e.rollSavingThrow / rollAbilityCheck / rollSkill` | HIGH                                     | S      |
| 3   | **use-npc-activity**             | Trigger a monster's attack/activity; return hit/miss + damage          | `Item5e.use()`, `activity.use()/rollDamage()`            | HIGH (attack/dmg); MED (forced crit/adv) | M      |
| 4   | **manage-rest**                  | Run a short/long rest: HP, hit dice, slots, limited-use features       | `Actor5e.shortRest/longRest({dialog:false})`             | HIGH                                     | S      |
| 5   | **roll-initiative-for-npcs**     | Roll initiative for all NPCs (or the whole encounter) at once          | `Combat.rollNPC()/rollAll()`                             | HIGH                                     | S      |
| 6   | **suggest-balanced-encounter**   | Compute XP/CR budget for the party and propose a creature mix          | `CONFIG.DND5E.CR_EXP_LEVELS`, encounter thresholds       | HIGH                                     | M      |

> Ideas **1–5** together turn the bridge from a read/observe tool into one that can run a 5e combat
> round — the single biggest gap in the current toolset.

## Tier 2 — Feasible, strong value

| #   | Tool                           | What it does                                                       | Key API                                                     | Feasibility                                | Effort |
| --- | ------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------ | ------ |
| 7   | **place-measured-template**    | Drop a cone/sphere/line AoE and report who's inside                | `scene.createEmbeddedDocuments('MeasuredTemplate')`         | HIGH place / MED overlap                   | M      |
| 8   | **set-scene-mood**             | Adjust darkness/global light; start/stop playlist or ambient sound | `Scene.update({environment…})`, `Playlist#playAll`          | HIGH (light/music) / MED (sound placement) | M      |
| 9   | **drop-loot / award-treasure** | Generate currency + items; give to a PC, a loot token, or chat     | `Actor#update(currency)`, `createEmbeddedDocuments('Item')` | HIGH                                       | M      |
| 10  | **get-recent-events**          | A low-latency "what happened since X" delta over the tracked hooks | already wired in `event-tracking.ts`                        | HIGH                                       | S      |

## Tier 3 — Feasible, niche

| #   | Tool                            | What it does                                                     | Key API                                 | Feasibility | Effort |
| --- | ------------------------------- | ---------------------------------------------------------------- | --------------------------------------- | ----------- | ------ |
| 11  | **add-map-note / pin-location** | Drop a labeled, journal-linked map pin on the scene              | `scene.createEmbeddedDocuments('Note')` | HIGH        | S      |
| 12  | **set-token-vision/light**      | Give a token a torch's light, or toggle its sight (e.g. blinded) | `TokenDocument#update({sight, light})`  | HIGH        | S      |

---

## Recommended build order

1. **apply-damage-and-healing** (S) — biggest live-combat payoff, trivial API.
2. **roll-saving-throws** (S) — completes the GM-side roll loop.
3. **roll-initiative-for-npcs** (S) — fast combat start.
4. **manage-rest** (S) — common, clean API.
5. **use-npc-activity** (M) — run the monster turn.
6. **suggest-balanced-encounter** (M) — planning value, deterministic math.
7. **place-measured-template** (M) — composes with #1/#2.
8. **drop-loot**, **set-scene-mood**, **get-recent-events**, then Tier 3.

---

## Considered and rejected (honest blockers)

- **Unattended auto-combat** — the dnd5e v4 Activity refactor removed reliable programmatic control
  over advantage/disadvantage and forced criticals ([#4843](https://github.com/foundryvtt/dnd5e/issues/4843),
  [#4844](https://github.com/foundryvtt/dnd5e/issues/4844)). Expose per-step tools (#1–#3) and keep the
  GM in the loop instead.
- **True server-initiated push** ("alert me the instant a PC dies") — MCP is request/response; the
  server can't spontaneously invoke the model. Reframed as **#10** (a buffered delta the client polls).
  See [ROADMAP.md](ROADMAP.md) for the live-update analysis.
- **Global fog-of-war reveal for players** — fog/sight is computed per-client from walls + token
  vision; the GM's context can't force-reveal another player's fog. Token vision/light (#12) is the
  correct lever.

Sources: [Foundry v13 API](https://foundryvtt.com/api/v13/), [dnd5e API reference](https://deepwiki.com/foundryvtt/dnd5e/6.1-api-reference),
[dnd5e actor.mjs](https://github.com/foundryvtt/dnd5e/blob/master/module/documents/actor/actor.mjs).
