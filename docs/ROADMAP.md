# Roadmap & Recommendations

My opinionated take on where this fork should go next, including the "live update in a Claude
session" question.

See also: [BUILT.md](BUILT.md), [FIXES.md](FIXES.md), [FEATURE-IDEAS.md](FEATURE-IDEAS.md).

---

## Near term (close the loop on what exists)

1. **Confirm the roll-button fix.** Get the player's console output (see [FIXES.md](FIXES.md) →
   Diagnostics) so we can fix it for real rather than guess. This is the one known broken behavior.
2. **Ship the combat-resolution set** (`apply-damage-and-healing`, `roll-saving-throws`,
   `roll-initiative-for-npcs`, `manage-rest`). These are all small, high-confidence APIs and together
   they let the AI actually _run_ a round instead of only narrating one. This is the highest-leverage
   work available.
3. **Harden version robustness.** The code review flagged dnd5e v3→v5 / Foundry v13→v14 drift points
   (status classification, `uses.spent` vs `value`, chat `style` vs `type`). Most are fixed; keep
   pinning behavior to the installed system version and lean on the test bench after each Foundry/dnd5e
   update.

## Medium term

4. **`get-recent-events` delta feed** — surface the already-tracked hook events as a cheap
   "what changed since timestamp X" query. It's mostly a read layer over existing data and is the
   pragmatic answer to "situational awareness during play" (see live-update section below).
5. **Encounter tooling** — `suggest-balanced-encounter` + `place-measured-template`, which compose
   with the combat-resolution set into a genuine "run the fight" workflow.

---

## The "live update in a Claude session" question

**Verdict: not possible inside Claude Desktop today.** Researched against the MCP spec and Anthropic's
docs:

- The MCP protocol _does_ define server→client push (notifications, resource subscriptions,
  `sampling/createMessage`). But Anthropic's connector docs list **resource subscriptions and sampling
  as "not yet supported,"** and tools are strictly request/response — **nothing can wake the model
  unprompted.** Even if sampling shipped, the spec mandates human approval per call, so no silent
  autonomous reactions.

### Options, ranked

1. **Best for genuinely live + autonomous — a standalone co-GM dashboard + the Anthropic Messages API
   (streaming).** Drop the requirement that the AI commentary lives inside the Claude chat window.
   We already have a WebRTC/WebSocket feed out of the Foundry module; pipe game events to a thin app
   that calls the Messages API with streaming and pushes commentary to a dashboard page (or back into
   Foundry as chat cards). This is the only option that is both real-time **and** autonomous. Use
   prompt caching for the campaign/system context to control cost.
   - _Requires:_ an Anthropic API key + a small backend/serverless app. _Effort:_ M–L.
2. **In-Claude-Desktop, polling-simulated — a `wait-for-game-event` long-poll tool.** A tool that
   blocks server-side until the next Foundry event (or a timeout) and returns it; instruct the model
   to call it in a loop. It's the only in-chat option, but: the model must keep choosing to loop, it
   consumes context each iteration, latency = poll interval, and a user turn must start it. Good for
   "while I'm actively chatting, watch for the next thing." _Effort:_ S–M.
3. **Don't bother (yet):** Claude Code background watchers / Routines — MCP notifications land in logs,
   not the model's context, so the async loop doesn't close; Routines run cloud-side and can't reach a
   local Foundry. Waiting on Claude Desktop to support sampling won't help either (human-in-the-loop).

**Recommendation:** if "react live during play" is the real goal, prototype **option 1** — a small
co-GM commentary dashboard reusing the existing WebRTC feed. If "while I'm chatting, keep me posted"
is enough, add the **`wait-for-game-event`** tool (option 2) — it's cheap and stays in the existing
architecture.

---

## Longer term / bigger bets

- **A dedicated co-GM client app** (option 1 taken further): owns the conversation, subscribes to the
  game feed, streams reactions, and can call tools back into Foundry — a purpose-built AI-GM surface
  rather than the general-purpose Claude Desktop chat.
- **Multi-system parity.** The new tools are D&D 5e-focused with defensive fallbacks; the upstream
  already has PF2e/DSA5/Cosmere/WFRP adapters. Resource/effect/combat tools could grow per-system
  adapters the way character reads already do.

## Operational

- **Deployment / distribution.** Move to manifest-URL install from a published fork + GitHub Releases
  (see the repo README / deployment notes) so updates don't require manual file replacement on the host.
- **CI.** Wire `npm run build` + `npm test` + the schema smoke test into GitHub Actions so regressions
  are caught on every push, and auto-attach the built module zip to releases.
