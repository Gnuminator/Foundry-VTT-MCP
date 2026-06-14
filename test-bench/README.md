# Foundry MCP Bridge — Test Bench

Two complementary ways to verify the tools actually work in a live game.

| Layer            | What it tests                                                                                            | File                            |
| ---------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **Foundry half** | Every query handler → data-access → live game API, run directly inside Foundry. No Claude/WebRTC needed. | `foundry-mcp-test-bench.js`     |
| **Full path**    | Claude Desktop → MCP server → WebRTC/WebSocket → Foundry.                                                | `claude-desktop-test-prompt.md` |

Running both isolates **game-integration** problems (macro fails) from **transport/MCP** problems
(macro passes but the Claude driver fails).

## 1. In-game macro (`foundry-mcp-test-bench.js`)

1. Log into your world as **GM**.
2. Create a **Script** macro (Macro Directory → Create Macro → Type: Script) and paste the file's
   contents, **or** paste it into the browser console (F12).
3. Execute. You get:
   - a `console.table` of PASS / FAIL / SKIP per tool, with timing and a result snippet,
   - a summary whispered to you in chat.
4. To also run the state-changing tools, set `RUN_WRITE_TESTS = true` at the top. Write tests are
   designed to be low-impact (self-whispers, no-op resource writes), but they do post to chat / roll dice.

## 2. Claude Desktop driver (`claude-desktop-test-prompt.md`)

Paste the prompt into a fresh Claude Desktop chat (fork server active, world open as GM). It walks
Claude through calling each tool and reporting pass/fail.

## Diagnosing the roll-request button

If a player clicks a requested roll button and nothing happens, open the **player's** browser console
(F12) and have them click again, then check for:

- `[foundry-mcp-bridge] attachRollButtonHandlers: N button(s) for user "<name>" (GM=…)`
  - **absent** → the `renderChatMessageHTML` hook never attached handlers on that client (the module
    may not be initialising for non-GM users / a Foundry-version hook mismatch).
  - **present, N ≥ 1, but clicking still does nothing** → the click handler is bound but bailing; look
    for a `Permission denied for roll execution` warning (target-user resolution issue) or a thrown
    error from `roll.toMessage`.

Report what you see and it can be pinned down precisely.
