# Deployment

The bridge has two halves that are deployed differently:

1. **Foundry module** — installs into the Foundry server (incl. hosted, e.g. Molten-Hosting).
2. **MCP server** — runs locally next to Claude Desktop.

---

## 1. Foundry module — Manifest URL install (recommended)

The module is published as a GitHub Release on the fork, so it installs like any other Foundry module.

**In Foundry:** Setup → **Add-on Modules** → **Install Module** → paste this in the _Manifest URL_
field → Install:

```
https://github.com/Gnuminator/Foundry-VTT-MCP/releases/latest/download/module.json
```

This works on hosted Foundry (Molten-Hosting) — no file-manager/SFTP access needed. Foundry reads the
manifest, downloads `foundry-mcp-bridge.zip`, and installs it. "Check for Updates" will pull future
releases automatically because the manifest uses `releases/latest/download/`.

> The module folder **must** stay named `foundry-mcp-bridge` — the MCP backend routes sockets to that id.

## 2. MCP server — Claude Desktop

The server runs locally. Point Claude Desktop's `claude_desktop_config.json` at the bundled entry:

```json
{
  "mcpServers": {
    "foundry-mcp": {
      "command": "<node>",
      "args": ["<repo>/packages/mcp-server/dist/index.bundle.cjs"],
      "env": {}
    }
  }
}
```

Build it with `npm run build && npm run bundle:server`. Restart Claude Desktop after changing the config.
(Packaging the server with its own installer/release is future work — see ROADMAP.)

---

## Cutting a new release (maintainers)

`dist/` is git-ignored, so the **built** module ships as release assets, not in the repo tree.

1. Bump the version in `packages/foundry-module/module.json` and the four `package.json` files.
2. Build + package:
   ```bash
   npm run build
   npm run bundle:server          # refreshes dist/index.bundle.cjs for the MCP server
   ```
   Then stage the module (manifest + built dist + lang/styles/templates) and zip it so `module.json`
   sits at the archive root, producing `foundry-mcp-bridge.zip`.
3. Create a GitHub Release tagged `vX.Y.Z` on `main` and upload **two assets**, named exactly:
   - `module.json` (the fork-URL manifest)
   - `foundry-mcp-bridge.zip`

   The asset names must match the `manifest`/`download` URLs in `module.json`
   (`releases/latest/download/module.json` and `.../foundry-mcp-bridge.zip`).

   Via the web UI: drag-drop both files onto a new release. Via `gh`:

   ```bash
   gh release create vX.Y.Z module.json foundry-mcp-bridge.zip -t "vX.Y.Z" -n "<notes>"
   ```

4. Verify: `curl -sIL .../releases/latest/download/module.json` returns HTTP 200.

## Repository

- Remote `fork` → `https://github.com/Gnuminator/Foundry-VTT-MCP` (default branch `main`).
- Remote `origin` → upstream `adambdooley/foundry-vtt-mcp` (for pulling upstream changes).
- Push work with `git push fork <branch>:main`.
