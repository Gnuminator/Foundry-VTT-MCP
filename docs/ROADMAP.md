# Roadmap & Recommendations

Where this fork goes next. Most of the original roadmap has shipped — this file now tracks
what's done and what's left, plus the "live update in a Claude session" analysis that the
co-GM dashboard came out of.

See also: [BUILT.md](BUILT.md), [FIXES.md](FIXES.md), [FEATURE-IDEAS.md](FEATURE-IDEAS.md).

---

## Shipped (as of v0.13.0)

- **Combat-resolution suite** — `apply-damage-and-healing`, `roll-saving-throws`,
  `roll-initiative-for-npcs`, `manage-rest`, `use-npc-activity`. The AI can actually run a 5e round.
- **Encounter & scene tooling** — `suggest-balanced-encounter`, `place-measured-template`,
  `set-scene-mood`, `drop-loot`, `add-map-note`, `set-token-vision-light`.
- **`get-recent-events`** — the incremental "what changed since timestamp X" session delta.
- **Module diagnostics** (v0.12.0) — `get-module-errors` / `get-modules` / `get-module-manifest` /
  `clear-module-errors`.
- **Roll-request button fixes** (v0.10.1 / v0.10.2) — loading (ad-blocker filename) and the dnd5e v5
  save-object formula + save proficiency. See [FIXES.md](FIXES.md).
- **Standalone co-GM dashboard** (`packages/cogm-dashboard`, v0.13.0) — the live-update "option 1"
  below, now built: read-only feed + combat tracker + streaming AI commentary + post-to-chat, a
  hardened reconnecting MCP control client (TCP keepalive, heartbeat, half-open recovery), and a
  **live module-error feed** where the co-GM offers a likely cause/fix on new errors.
- **Distribution & CI** — manifest-URL install from the published fork + GitHub Releases
  (`release.yml`, tag `v*`); `ci.yml` runs build/checks.

---

## Remaining

### Near term

- **Re-verify the roll-request button** on the current dnd5e / Foundry after each system bump — the
  bug is fixed, but it's the kind of thing that drifts; smoke-test per upgrade.
- **Version-robustness.** Keep pinning behavior to the installed system version and lean on the test
  bench after each Foundry/dnd5e update (status classification, `uses.spent` vs `value`, chat
  `style` vs `type` were the historical drift points).
- ✅ **Dashboard design overhaul** _(shipped v0.15.0)_ — "Modern Command Center" redesign: refined
  typography/spacing/density, reworked diagnostics pane + status bar, and a graduated responsive
  layout that fixes the mobile overflow. See [COGM-DASHBOARD.md](COGM-DASHBOARD.md).

### Medium term

- ✅ **Dashboard calls tools _back_ into Foundry** _(shipped v0.15.0)_ — a GM control surface:
  confirm-gated `/api/tool` proxy (read/write/destructive classification + master GM-Actions switch),
  a generic schema-driven Tool Runner for every bridge tool, and a curated combat panel with
  multi-select combatants and a batch action bar.
- **`wait-for-game-event` long-poll tool** _(optional)_ — the in-Claude-Desktop alternative for
  "while I'm chatting, keep me posted." The dashboard supersedes it for live/autonomous use; only
  build it if the in-chat loop is specifically wanted. Analysis below.

### Make it my own (next major push — added 2026-06-15)

- **Player vs. GM views (role split).** Two views of the dashboard: a **GM view** (everything —
  Tool Runner + GM Actions — behind auth) and a **player view** showing only what players should see:
  public combat order, the public feed, no diagnostics, no hidden enemy HP/notes, no write actions.
  Critical: filter GM-only data **server-side** (the SSE stream and REST endpoints, _not_ just CSS),
  and gate the write surface behind auth server-side. Players using it means exposing the dashboard
  beyond `localhost` (LAN/tunnel), so auth + network binding become real security concerns — the
  bridge can mutate the live game. Auth options to weigh: a shared GM password/token (cookie),
  separate ports per role, or per-role tokens.
- **Redesign the GitHub front page (README) from scratch.** The README is still the upstream one;
  rewrite it around this fork's identity and the co-GM dashboard — what it is, the dashboard feature
  set, screenshots (reuse the `docs/COGM-DASHBOARD.md` assets), install/run, supported systems.
- **Detach from upstream & make it original.** Stop tracking the `origin` (adambdooley) remote and
  reimplement the codebase as _its own thing built from the idea_ rather than a fork of the original
  source. Licensing note (not legal advice — worth confirming): upstream is MIT-licensed, so a
  genuine from-scratch reimplementation that shares no original code can carry your own
  authorship/license; any retained original code must keep its MIT copyright + license. Also rebrand
  the manifest (`module.json` authors/title/id) and docs. Large, staged effort — sequence it
  module-by-module.

---

## The "live update in a Claude session" question (why the dashboard exists)

**Verdict: not possible inside Claude Desktop today** — which is exactly why the co-GM dashboard is a
separate app. Researched against the MCP spec and Anthropic's docs:

- The MCP protocol _does_ define server→client push (notifications, resource subscriptions,
  `sampling/createMessage`). But Anthropic's connector docs list **resource subscriptions and sampling
  as "not yet supported,"** and tools are strictly request/response — **nothing can wake the model
  unprompted.** Even if sampling shipped, the spec mandates human approval per call, so no silent
  autonomous reactions.

### Options, ranked

1. **Best for genuinely live + autonomous — a standalone co-GM dashboard + the Anthropic Messages API
   (streaming). ✅ SHIPPED (`packages/cogm-dashboard`, v0.13.0).** The AI commentary lives outside the
   Claude chat window: the dashboard pulls the game feed off the bridge control channel and calls the
   Messages API with streaming, pushing commentary (and now live module-error diagnostics) to a
   dashboard page, with optional post-back into Foundry chat. Prompt caching on the campaign/system
   context controls cost.
2. **In-Claude-Desktop, polling-simulated — a `wait-for-game-event` long-poll tool.** A tool that
   blocks server-side until the next Foundry event (or a timeout) and returns it; instruct the model to
   call it in a loop. The only in-chat option, but the model must keep choosing to loop, it consumes
   context each iteration, latency = poll interval, and a user turn must start it. Not built — the
   dashboard covers the live/autonomous case.
3. **Don't bother (yet):** Claude Code background watchers / Routines — MCP notifications land in logs,
   not the model's context, so the async loop doesn't close; Routines run cloud-side and can't reach a
   local Foundry. Waiting on Claude Desktop to support sampling won't help either (human-in-the-loop).

---

## Longer term / bigger bets

- **A dedicated co-GM client app.** The dashboard is the foundation; "taken further" means it owns the
  conversation, subscribes to the game feed, streams reactions, and calls tools back into Foundry — a
  purpose-built AI-GM surface rather than the general-purpose Claude Desktop chat.

## Operational

- **Deployment / distribution.** ✅ Done — manifest-URL install from the published fork + GitHub
  Releases (`release.yml`), so updates don't require manual file replacement on the host.
- **CI.** ✅ `ci.yml` (build/checks on push) + `release.yml` (tag-driven release that builds and
  attaches the module zip).
