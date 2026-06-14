# Claude Desktop — MCP Tool Driver Prompt

Paste the block below into a **fresh Claude Desktop chat** while:

- the fork MCP server is active (config points at `dist/index.bundle.cjs`, Claude Desktop restarted), and
- your Foundry world is open as GM with the v0.9.0 module loaded.

This exercises the **full path** (Claude Desktop → MCP server → WebRTC/WebSocket → Foundry),
which the in-game macro (`foundry-mcp-test-bench.js`) does **not** cover — the macro tests the
Foundry half only. Run both to isolate transport issues from game-integration issues.

---

You are testing the Foundry MCP Bridge end to end. Work through the checklist below **one tool at a
time, in order**. For each: call the tool, then report a single line — `✅ <tool> — <one-line result>`
or `❌ <tool> — <error>`. Do not fix anything; just report. At the end print a table of pass/fail and
a list of anything that failed with its error text.

READ tests (safe — run all):

1. `get-world-info`
2. `get-current-scene`
3. `get-combat-state`
4. `get-token-positions`
5. `get-chat-log` with limit 10
6. `get-session-log` with limit 10
7. `get-combat-play-by-play`
8. `list-characters`, then pick one player character and call `get-character-resources` for them
9. `get-active-effects` for that same character
10. `measure-distance` between the first two tokens returned by `get-token-positions` (skip if fewer than two)

WRITE tests (these change game state — do them only if I confirm "run writes" first): 11. `send-chat-message` — message "MCP end-to-end test", messageType "ooc" 12. `roll-npc-check` — an NPC actor, rollType "ability", rollTarget "dex", isPublic false 13. `request-ability-check` — target a player character, ability "wis", dc 12, isPublic false, reason
"end-to-end test — click the button". Then STOP and tell me to click the button in Foundry and
report whether a roll result appears in chat.

After the checklist, summarize: which tools work end-to-end, which failed, and whether the roll-request
button produced a result when clicked.
