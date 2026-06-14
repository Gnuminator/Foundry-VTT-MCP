# Co-GM Dashboard

A standalone live **AI co-GM** for the Foundry VTT MCP bridge. It watches the
running game, streams an AI Game Master's-assistant commentary to a browser
dashboard, and can optionally post a chosen comment back to Foundry chat.

> **Why a separate app?** MCP / Claude Desktop can only respond when _you_
> prompt it — it cannot react to the game on its own. To get genuinely live,
> autonomous reactions, this dashboard **pulls** the game feed off the bridge's
> control channel and drives the **Anthropic Messages API** itself.

## What it does

- **Live event feed** — polls the bridge's `get-recent-events` delta (~every 4s)
  using the returned `latestTimestamp` as an incremental cursor.
- **Combat tracker** — initiative order, HP bars, conditions, and death saves
  from `get-combat-state`.
- **Streaming AI commentary** — when something significant happens (damage,
  death, conditions, combat start/turn, resource spend), the co-GM streams one
  short tactical or narrative comment. Comments are **batched and rate-limited**,
  never one-per-event.
- **Ask the co-GM** — type a question and get a streamed answer grounded in the
  current game state.
- **Post to chat** _(the only thing that mutates the game)_ — push a chosen
  comment into Foundry as a GM whisper.

Everything else is strictly read-only.

## Architecture

```
 Foundry VTT  ──►  MCP backend  ──(JSON-lines TCP 127.0.0.1:31414)──►  Co-GM dashboard
  (browser)        (bridge)              control channel                   │
                                                                           ├─ PollingGameFeed  (get-recent-events / get-combat-state)
                                                                           ├─ GameState        (bounded rolling window + combat snapshot)
                                                                           ├─ CoGm             (@anthropic-ai/sdk, streaming + prompt caching)
                                                                           ├─ CommentaryEngine (batch / debounce / frequency cap)
                                                                           └─ Express + SSE    ──►  browser dashboard (3 panes)
```

The feed sits behind a `GameFeed` interface (`src/feed/types.ts`), so the
polling implementation can later be swapped for a push source (e.g. WebRTC)
without touching the rest of the app.

### Files

| Path                             | Role                                                              |
| -------------------------------- | ----------------------------------------------------------------- |
| `src/feed/mcp-control-client.ts` | Reconnecting JSON-lines client for the control channel            |
| `src/feed/polling-feed.ts`       | `GameFeed` impl — incremental event + combat polling              |
| `src/state.ts`                   | Bounded view of the game (rolling events + combat snapshot)       |
| `src/ai/prompt.ts`               | Persona / 5e reference, event-significance rules, prompt assembly |
| `src/ai/anthropic-co-gm.ts`      | Streaming Messages API wrapper with prompt caching                |
| `src/ai/commentary.ts`           | Batches/debounces events into paced comments                      |
| `src/sse.ts`                     | Server-Sent Events hub                                            |
| `src/server.ts`                  | Express wiring, REST + SSE endpoints                              |
| `public/`                        | Vanilla-JS dashboard (no build step)                              |

## Setup

From the repo root (installs all workspaces including this one):

```bash
npm install
```

Then configure this package:

```bash
cd packages/cogm-dashboard
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY
```

## Run

Make sure the **MCP bridge is running** (it owns the control channel on
`127.0.0.1:31414`) and Foundry is open with your world loaded. Then:

```bash
# from packages/cogm-dashboard
npm run dev
```

Open **http://localhost:3000**.

Other scripts: `npm run build` (compile to `dist/`), `npm run start` (run the
built server), `npm run typecheck`, `npm run lint`.

> Tip: from the repo root you can run it without `cd` via
> `npm run dev --workspace=packages/cogm-dashboard`.

The dashboard runs **without** an API key too — you still get the live feed and
combat tracker; only the AI panes are disabled until a key is set.

## Configuration

All via `.env` (see `.env.example`):

| Variable                                | Default               | Purpose                                             |
| --------------------------------------- | --------------------- | --------------------------------------------------- |
| `ANTHROPIC_API_KEY`                     | —                     | Enables AI commentary / ask (never committed)       |
| `ANTHROPIC_MODEL`                       | `claude-opus-4-8`     | Default model (switchable live in the UI)           |
| `POLL_INTERVAL_MS`                      | `4000`                | Event-delta poll cadence                            |
| `COMBAT_POLL_INTERVAL_MS`               | = poll interval       | Combat-state poll cadence                           |
| `COMMENT_MIN_INTERVAL_MS`               | `20000`               | Minimum spacing between auto-comments               |
| `COMMENT_DEBOUNCE_MS`                   | `1500`                | Window that batches an event burst into one comment |
| `MCP_CONTROL_HOST` / `MCP_CONTROL_PORT` | `127.0.0.1` / `31414` | Bridge control channel                              |
| `PORT`                                  | `3000`                | Dashboard HTTP/SSE port                             |
| `COGM_TONE`                             | `tactical`            | Starting tone (`tactical` \| `narrative`)           |

## Cost control

- **Prompt caching.** The large static persona + 5e reference + campaign context
  carries a `cache_control` breakpoint and is byte-identical every request, so
  it is served from Anthropic's prompt cache after the first call. Tone and live
  game state live in the (uncached) user turn, so the cache stays warm across
  tone switches and turns. The UI shows `cache ✓` / `cache miss` and token counts
  per generation. (Note: prompt caching only kicks in once the cached prefix
  clears the model's minimum cacheable size — ~4 K tokens on Opus, ~2 K on
  Sonnet; the static block is sized with this in mind.)
- **Bounded context.** Each request is independent (no growing conversation) and
  includes only a combat snapshot plus a rolling window of recent events — never
  the full session history.
- **Batched, capped commentary.** Bursts are debounced into a single comment and
  spaced by `COMMENT_MIN_INTERVAL_MS`. Short `max_tokens` keep outputs tight.
- **Pause** stops auto-commentary entirely; **Haiku/Sonnet** in the model picker
  trade some quality for lower cost/latency.

## Guardrails

- **Read-mostly.** The only call that changes the game is the explicit
  _Post to chat_ button (a GM whisper via `send-chat-message`).
- **Resilient to a dead backend.** The control client reconnects with backoff,
  every request is timeout-bounded, and a failed poll downgrades the status badge
  and retries — it never crashes the dashboard.
- **Bounded model context** as described above.
