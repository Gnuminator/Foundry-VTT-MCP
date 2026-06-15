# Plan: Detach from upstream & make it your own

A staged plan to take this from "a fork of `adambdooley/foundry-vtt-mcp`" to **your own project**,
safely, across multiple sessions. Open this cold in a new session and start at "Start here."

## The honest size of it

| Package                   | Files | ~LOC    | Origin            |
| ------------------------- | ----- | ------- | ----------------- |
| `packages/mcp-server`     | 68    | ~22,300 | upstream-derived  |
| `packages/foundry-module` | 13    | ~18,000 | upstream-derived  |
| `packages/cogm-dashboard` | 12    | ~2,400  | **already yours** |
| `shared`                  | —     | ~740    | mostly upstream   |

History: 200 commits rooted in adambdooley's "Initial release" (2025‑08‑27); the GitHub repo is a
**fork** (shows "forked from"). So a literal clean-room rewrite of the bridge is ~40K LOC of working,
multi-system code — a multi-**month** effort. This plan separates the cheap, high-impact "it's mine"
work from the expensive "rewritten from scratch" work so you can stop at whatever depth you want.

---

## Phase 0 — Decisions (do first; ~30 min, no code)

1. **Identity:** project name, Foundry module `id`, npm scope (`@foundry-mcp/*` → `@you/*`), author,
   GitHub repo name.
2. **License:** keep `LICENSE` (MIT) + attribution while _any_ upstream code remains; add your own
   copyright line; license code you write yourself however you like. (Not legal advice — the safe,
   good-faith path is "keep MIT + credit upstream until nothing original remains.")
3. **Repo strategy** — ✅ DECIDED: **(b) fresh standalone repo.** New home created at
   **https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool** (standalone, not a GitHub fork). Push the
   code there and make it canonical; retire the old fork (`Gnuminator/Foundry-VTT-MCP`).
4. **History** — ✅ DECIDED: **keep my own dev commits, drop the upstream ones.** The lineage is clean
   for this — the fork point is **`dba53ec`** (Adam Dooley, 2026-06-07) and the **30 commits after it
   are all mine (Gnuminator)**. So collapse everything up to `dba53ec` into a single **baseline** commit
   and replay my 30 commits on top: the new repo reads "Baseline (forked from upstream, MIT)" + my 30
   dev commits, **no Adam-authored commits**. ⚠️ This drops Adam's _commits/lineage_, not his _code_ —
   the baseline still contains the upstream code my commits build on; actually replacing that code is
   the Phase 4 reimplementation. Credit upstream in `CREDITS.md`/`NOTICE` + the baseline commit message.
5. **Rewrite scope** — pick one:
   - **Rebrand + reorganize (recommended first):** make it unmistakably yours (identity, README,
     structure; the dashboard is already original) _without_ rewriting the engine. Fast, low-risk,
     gets ~80% of the "this is mine" feeling.
   - **Staged reimplementation (the real goal):** additionally reimplement the upstream-derived code
     module-by-module "from the idea," behind stable contracts, over many sessions.
   - **Avoid:** a big-bang rewrite — too risky for a tool you run live.

---

## Phase 1 — Git / remote detach + clean history (~30–45 min)

Goal: the new repo's history = one **baseline** commit + my 30 dev commits, with no Adam-authored
commits. Fork point is `dba53ec`; the 30 commits in `dba53ec..HEAD` are all mine. Recipe:

1. **Safety first:** `git branch backup-full-history` (nothing is lost if the rewrite goes sideways).
2. **Build the clean history:**
   - `git checkout --orphan new-main dba53ec` — working tree = fork-point tree, no parent commit
   - `git commit -m "Baseline: forked from adambdooley/foundry-vtt-mcp @ dba53ec (MIT) — see CREDITS.md"`
   - `git rebase --onto new-main dba53ec main` — replays my 30 commits onto the baseline (applies
     cleanly: identical tree, so no conflicts), preserving their original author/date/messages
   - Verify: `git log --oneline` shows the baseline + 30 commits; `npm run build` still passes.
3. **Remotes:** `git remote add aitool https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool.git`;
   remove upstream `git remote remove origin`; retire the old `fork`.
4. **Push** the cleaned `main` to the new repo (only on my confirm): `git push -u aitool main`.
5. Update the remotes/release notes in `CLAUDE.md` so future sessions target the new repo, not upstream.

## Phase 2 — Rebrand (~half a day, mostly mechanical)

- `packages/foundry-module/module.json`: `id`, `title`, `authors`, `description`, URLs.
- `package.json` files: package names + `author`; `LICENSE` (+ a `NOTICE`/`CREDITS` crediting upstream).
- README rewrite (this is the separate "redesign the front page" todo — do it here).
- CI/release workflow names; any branded strings.
- ⚠️ **Load-bearing identifiers:** the module `id`, the socket channel name, settings namespace, and
  the `foundry-mcp-bridge.*` query method names are wire contracts — the in-Foundry module, the
  control channel, and the dashboard all depend on them, and existing installs key off the module id.
  **Recommendation:** rebrand the _surface_ (name/title/docs/repo) first and keep the wire identifiers
  stable; do a true rename later as its own change with a migration note (it breaks existing installs).

## Phase 3 — Architecture from the idea (write the spec)

- Author `docs/ARCHITECTURE.md` describing the system from first principles — the IDEA, not the code:
  an MCP server that exposes Foundry as tools; an in-Foundry module that bridges over a socket; the
  JSON-lines control channel; system adapters; the job queue; security/GM-gating. This becomes the
  spec you reimplement against and the evidence that the design is yours.

## Phase 4 — Staged reimplementation (the long pole; many sessions)

Reimplement **behind stable external contracts** so the dashboard + Foundry keep working throughout.
Suggested order (low-risk → high-value):

1. `shared` types — small; sets the vocabulary.
2. **Control-channel / socket-bridge protocol** — the contract everything depends on. Design + rewrite
   carefully (this is the part most worth Opus-level attention).
3. Foundry module `data-access` / `queries` layer.
4. **Tool layer, domain-by-domain** (combat, scene, compendium, actor-creation, effects, …). Each is a
   self-contained chunk; use `TOOL_INVENTORY.md` as the parity checklist.
5. System adapters (dnd5e / pf2e / dsa5 / wfrp4e / cosmere) **last, one at a time.**

Per chunk: capture current behavior in tests first → reimplement → verify parity (the test bench +
a mock-bridge harness like the `temp/cogm-*.cjs` scripts) → ship. **Never leave it broken between
sessions.** Keep a "rewritten vs still-upstream" tracker so a fresh session resumes cleanly.

## Phase 5 — Cutover & docs

- New README/CREDITS, migration notes (if the module id changed), release under the new identity,
  live smoke test (Foundry open + bridge connected + dashboard).

---

## Working method (safe + resumable)

- **Contracts first**, then swap implementations behind them — the dashboard never sees a difference.
- **One module per session/chunk**; each ends green: typecheck + lint + build + tests + a mock-bridge
  or live smoke test.
- Reuse the verification harnesses in `temp/` (mock bridge speaks the JSON-lines protocol; run with
  `ANTHROPIC_API_KEY=''` + `MCP_CONTROL_PORT=<mock>` so it never touches the live bridge on 31414).
- Track progress in a checklist doc; treat the parity checklist as the definition of done.

## Model choice (Opus 4.8 vs Sonnet 4.6)

**Sonnet 4.6 is fine for most of this.** The bulk is well-specified reimplementation, mechanical
rebranding, and test-writing — Sonnet is fast, capable, and much cheaper, and the cost/speed compounds
over a multi-session grind. **Reserve Opus 4.8 (or fast-mode Opus) for the ~20% where mistakes are
expensive or the reasoning is deep:** the architecture/contract design (Phase 3), the socket-bridge /
transaction / concurrency rewrite (Phase 4 step 2), parity-decision calls, and reviewing each chunk.
Best pattern: **Opus plans/designs/reviews, Sonnet executes** — either switch with `/model` per
session, or have an Opus session orchestrate and spawn **Sonnet** subagents/workflows for the
per-module labor (per-agent model is selectable). Keeps judgment high where it counts and cost low
on the 40K-LOC grind.

---

## Start here (new-session kickoff)

1. Answer the **Phase 0** questions (identity, license, repo strategy, rewrite scope).
2. Do **Phase 1** (git detach) and **Phase 2** (surface rebrand + README) — these alone make it feel
   like yours, are low-risk, and ship in ~1 day.
3. Only then decide whether to commit to **Phase 4** (the staged rewrite).

Suggested opening prompt for the new session:

> "Read docs/DETACH-PLAN.md. Let's do Phase 0 + Phase 1 + Phase 2: help me pick the new identity,
> detach the git remote, and rebrand the surface (module.json, package names, LICENSE/credits) while
> keeping the wire identifiers stable. Use Sonnet; escalate to Opus only for the architecture spec."
