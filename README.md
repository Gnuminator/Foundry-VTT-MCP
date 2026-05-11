# Foundry VTT MCP Bridge — D&D 5e NPC Creation Suite (Fork)

> **This is a fork of [adambdooley/foundry-vtt-mcp](https://github.com/adambdooley/foundry-vtt-mcp).**
> It extends the original project with **8 new MCP tools** for building D&D 5e NPCs directly from Claude Desktop — no Foundry UI required.
> See the [What's New in This Fork](#whats-new-in-this-fork) section below.

---

# Foundry VTT MCP Bridge

Connect Foundry VTT to Claude Desktop for AI-powered campaign management through the Model Context Protocol (MCP). It currently supports Dungeons and Dragons Fifth Edition, Pathfinder Second Edition, Das Schwarze Augen Fifth Edition, & Cosmere RPG System. The majority of MCP tools are system agnostic or have features that are aware of the system it is working with, excluding some DSA 5 specific tools.

---

## What's New in This Fork

This fork adds a **D&D 5e NPC Creation Suite** — 8 new MCP tools that allow Claude to build complete, playable NPCs from scratch through natural conversation, without opening Foundry at all.

### New Tools

| Tool | Description |
|------|-------------|
| `dnd5e-create-npc` | Create an NPC actor from scratch with a full stat block (HP, AC, abilities, CR, etc.) |
| `dnd5e-add-passive-feature` | Add descriptive traits: Multiattack, Sunlight Sensitivity, Pack Tactics, etc. |
| `dnd5e-add-feature-with-save` | Add saving throw features with damage (e.g. Dragon Breath, cone AoE) |
| `dnd5e-add-attack-feature` | Add a standard weapon attack with attack roll (type A) |
| `dnd5e-add-attack-with-save` | Add an attack that triggers a secondary saving throw on hit (type B) |
| `dnd5e-add-aura-feature` | Add an automatic-damage aura or emanation (no save required) |
| `dnd5e-set-actor-spellcasting` | Configure spellcasting class, ability score, and spell slots |
| `dnd5e-add-spells-to-actor` | Import spells by name from official compendium packs |

### How It Works

Each tool follows the same 4-layer architecture as the rest of the project:

1. **`mcp-server/src/tools/dnd5e/`** — Zod schema, JSON Schema, tool description with USE/DON'T USE routing
2. **`mcp-server/src/backend.ts`** — registration and handler routing
3. **`foundry-module/src/queries.ts`** — query handler + registration
4. **`foundry-module/src/data-access.ts`** — Foundry data layer

All tools were verified against the real Foundry VTT 5e data schema (not just the TypeScript types) and tested end-to-end via Claude Desktop.

### Example Workflow

Build a complete NPC in ~5 minutes from a description:

```
1. "Create Frater Velreth, a corrupted monk, CR 8, 110 HP, AC 16"
   → dnd5e-create-npc

2. "Add Multiattack: two Corrupting Touch attacks"
   → dnd5e-add-passive-feature

3. "Add Corrupting Touch: melee 5ft, +7 to hit, 2d8 psychic,
    secondary WIS save DC 14 or 3d6 extra"
   → dnd5e-add-attack-with-save

4. "Add Signal Aura: 10ft radius, 1d6 psychic automatic each turn"
   → dnd5e-add-aura-feature

5. "Make him a CHA-based caster, 5th level"
   → dnd5e-set-actor-spellcasting

6. "Give him Disguise Self, Mirror Image, Hypnotic Pattern, Major Image"
   → dnd5e-add-spells-to-actor
```

### Known Limitations

- **`dnd5e-add-feature-with-save` has schema drift**: ~6 minor mismatches between the Zod schema and the real Foundry 5e data model (annotated as TODO in source). The tool works in practice — no visible breakage — but a cleanup pass is planned.
- **`emanation` area type**: may need verification in `add-feature-with-save` (confirmed correct in `add-aura-feature`).
- Tool descriptions use explicit **negative routing** (`DO NOT USE THIS FOR`) to help Claude choose the right tool in ambiguous cases. If you notice routing mistakes, check the `description` field in the relevant `.ts` file first.

---

## Overview

The Foundry MCP Bridge enables natural AI conversations with your Foundry VTT game data:

* **Quest Creation**: [Create quests from prompts that incorporate what exists in your world and journals](https://www.youtube.com/watch?v=NqyB_z2AKME)
* **Character Management**: Query character stats, abilities, and information
* **Compendium Search**: Find items, spells, and creatures using natural language
* **Content Creation**: Generate actors, NPCs, and quest journals from simple prompts
* **Scene Information**: Access current scene data and world details
* **Dice Coordination**: Interactive roll requests with player targeting
* **Campaign Management**: Multi-part quest and campaign tracking
* **Map Generation**: Create maps from prompts and automatically upload them into scenes in Foundry VTT using the optional ComfyUI component

This project was built with the assistance of Claude Code. If you like the original project, consider [supporting it on Patreon](https://www.patreon.com/c/Adambdooley).

## Installation

### Prerequisites

* **Foundry VTT v13**
* **Claude Desktop** with MCP support
* **Windows** (for automated installer) or **Node.js 18+** for manual installation

### Option 1: Windows Installer

[Video guide for Windows Installer](https://youtu.be/Se04A21wrbE)

1. Download the latest `FoundryMCPServer-Setup-vx.x.x.exe` from [Releases](https://github.com/adambdooley/foundry-vtt-mcp/releases)
2. Run the installer
3. Restart Claude Desktop
4. Enable "Foundry MCP Bridge" in your Foundry Module Management

### Option 2: Mac Installer

1.  Download the latest `FoundryMCPServer-vx.x.x.dmg` from [Releases](https://github.com/adambdooley/foundry-vtt-mcp/releases)
2.  Run the package installer inside the dmg - it will:
    - Open DMG and double-click the PKG installer
    - Configure the Claude Desktop MCP server settings
    - Optionally install the Foundry module and ComfyUI Map Generation to your Foundry VTT installation
3.  Restart Claude Desktop
4.  Enable "Foundry MCP Bridge" in your Foundry Module Management

### Option 3: Manual Installation (required for this fork)

#### Install the MCP Server

```bash
# Clone this fork
git clone https://github.com/YOUR_USERNAME/foundry-vtt-mcp.git
cd foundry-vtt-mcp

# Install dependencies and build
npm install
npm run build
```

#### Deploy the Foundry Module

Copy `packages/foundry-module/dist/` to your Foundry modules directory:

```
AppData/Local/FoundryVTT/Data/modules/foundry-mcp-bridge/dist/
```

> ⚠️ **Do not change the module ID or folder name.** The MCP backend and the Claude integration both expect the module to live in a directory called `foundry-mcp-bridge`.

#### Configure Claude Desktop

Add this to your Claude Desktop configuration (claude_desktop_config.json) file:

```json
{
  "mcpServers": {
    "foundry-mcp": {
      "command": "node",
      "args": ["path/to/foundry-vtt-mcp/packages/mcp-server/dist/index.js"],
      "env": {
        "FOUNDRY_HOST": "localhost",
        "FOUNDRY_PORT": "31415"
      }
    }
  }
}
```

#### After any code change

> **Windows Store / MSIX installs:** If you installed Claude Desktop from the Microsoft Store, it reads its config from a virtualised path, not `%APPDATA%\Claude\`. Edit `claude_desktop_config.json` here instead:
> `%LOCALAPPDATA%\Packages\<...Claude...>\LocalCache\Roaming\Claude\claude_desktop_config.json`
> The automated Windows installer (v0.8.1+) writes to both locations for you. Note that a major Claude Desktop update can reset this container — if your tools disappear after an update, re-run the installer or re-add the `mcpServers` block at that path.

### Getting Started

1. Start Foundry VTT and load your world
2. Open Claude Desktop
3. Chat with Claude about your currently loaded Foundry World

## Example Usage

Once connected, ask Claude Desktop:

- _"Show me my character Clark's stats"_
- _"Find all CR 12 humanoid creatures for an encounter"_
- _"Create a quest about investigating missing villagers"_
- _"Roll a stealth check for Tulkas"_
- _"What's in the current Foundry scene?"_
- _"Create me a small map of a Riverside Cottage in Foundry"_

## Features

- **37 MCP Tools** that allow Claude to interact with Foundry
- **Character Management**: Access stats, abilities, inventory, and detailed entity information
- **Token Manipulation**: Move, update, delete tokens and manage status conditions
- **Enhanced Compendium Search**: Instant filtering by CR, type, abilities, and more
- **Content Creation**: Generate actors, NPCs, and quest journals (with optional folder organisation)
- **World Item Management**: Create, list, and update world-level Items; attach items directly to actors
- **Campaign Management**: Multi-part quest tracking with progress dashboards
- **Interactive Dice System**: Send different dice roll requests to players from Claude
- **Actor Ownership**: Manage player permissions for characters and tokens
- **GM-Only**: MCP Bridge only connects to Game Master users
- **Map Generation**: A portable ComfyUI backend that generates battlemaps from prompts
- **Remote Connections**: WebRTC connections initiated through browser (Tested with Google Chrome) to MCP server and ComfyUI
- **Windows and Mac Installers** Automated installation of Foundry MCP Server for Claude Dekstop, Foundry MCP Bridge Foundry VTT Module, and ComfyUI backend with dependencies

## MCP Tools

- **1** get-world-info
- **2** list-scenes
- **3** get-current-scene
- **4** get-available-conditions  
- **5** list-compendium-packs
- **6** list-characters
- **7** get-character  
- **8** search-character-items  
- **9** get-character-entity
- **10** get-token-details
- **11** toggle-token-condition (add)  
- **12** toggle-token-condition (remove)
- **13** update-token
- **14** search-compendium
- **15** get-compendium-item
- **16** get-compendium-entry-full
- **17** list-creatures-by-criteria  
- **18** list-journals  
- **19** create-quest-journal
- **20** update-quest-journal
- **21** search-journals
- **22** link-quest-to-npc
- **23** list-actor-ownership
- **24** assign-actor-ownership
- **25** remove-actor-ownership
- **26** move-token
- **27** use-item
- **28** request-player-rolls
- **29** generate-map
- **30** check-map-status
- **31** cancel-map-job
- **32** switch-scene  
- **33** create-actor-from-compendium
- **34** list-dsa5-archetypes (DSA5 Only)
- **35** create-dsa5-character-from-archetype (DSA5 Only)
- **36** create-campaign-dashboard
- **37** manage-world-items (create / list / update world items, add items to actor)

## Settings

<img width="964" height="803" alt="image" src="https://github.com/user-attachments/assets/bfd435d5-2df4-40a6-a79b-87e98121db3f" />

- **Enhanced Creature Index** Configure Enhanced Index button leads to Enhanced Creature Index sub-menu (Details below)
- **Map Generation Service Configuration** Configure Map Generation button leads to Map Generation Service sub-menu (Details below)
- **Enable MCP Bridge** This should be checked by default and the status should show as connected. It can be used to turn off the MCP Bridge connection within the game without the need to disable the add-on itself.
- **Connection Type** Can be set to Auto for automatic detection of connection type. Can also be set to force either WebRTC for Internet connections or Websocket for Local connections.
- **Websocket Server Host** IP Address of Claude Desktop MCP Server location. Only used for local network websocket connections. Remote Servers use WebRT. Defaults to localhost.
- **Allow Write Operations** This will prevent Claude from making any changes to world content and restrict it to reading only
- **Max Actors Per Request** This is a failsafe to stop a massive amount of actors being created from one single request. It does not limit the amount of characters being created by multiple requests
- **Show Connection Messages** This can turn off the banner messages for connections for Foundry MCP Bridge
- **Auto-Reconnect on Disconnect** Will automatically attempt to reconnect if the connection is lost
- **Connection Check Frequency** How often it will check connection status

### Enhanced Creature Index Sub-menu

<img width="497" height="604" alt="image" src="https://github.com/user-attachments/assets/bf1a6fdb-9bd5-4256-b922-d28cf65b1e7d" />

- **Rebuild Creature Index** This button will rebuild the creature index if there is an issue or it is out of sync with changes in your compendiums
- **Enable Enhanced Creature Index** This should be left on as Claude builds additional metadata in the world files to give it better searches
- **Auto-Rebuild Index on Pack Changes** Experimental feature that hasn't been fully tested yet

### Map Generation Service Sub-menu

<img width="489" height="779" alt="image" src="https://github.com/user-attachments/assets/a43d3a3d-266f-41c9-b40a-236d14cfcba9" />

- **Service Status** There are three buttons for Check Status, Start Service, and Stop Service. These buttons help monitor and control the connection from the Foundry MCP Bridge to the ComfyUI backend which is started by the Claude Desktop application.
- **Auto-start Map Generation Service** Controls whether ComfyUI service connection is automatically connected at startup of the Foundry world.
- **Generation Quality** Controls the quality of the maps generated by the SDXL checkpoints wiht ComfyUI. Low uses 8 steps of generation, Medium uses 20 steps of generation, and High uses 35 steps. The D&D Battlemaps SDXL Upscale v1.0 Checkpoint used in this image generation recommends using 35 steps but on low end GPUs or GPUs with out CUDA, this generation will take several minutes. These options can give you a trade off to have maps generated faster at the expense of quality.

## Architecture

```
Claude Desktop ↔ MCP Protocol ↔ MCP Server ↔ WebSocket ↔ Foundry Module ↔ Foundry VTT
                                     ↓
                              ComfyUI Service
                              (AI Map Generation)
```

## Security & Permissions

* **GM-Only Access**: All functionality restricted to Game Master users
* **Configurable Permissions**: Control what data Claude can access and modify
* **Session-Based Authentication**: Uses Foundry's built-in authentication system

## System Requirements

* **Foundry VTT**: Version 13
* **Claude Desktop**: Latest version with MCP support
* **Claude Pro/Max Plan**: Required to connect to MCP servers
* **Operating System**: Windows 10/11 or other OSes with Node.js 18+

## Schema Smoke Test

The MCP schema smoke test verifies that tool schemas load correctly and do not enforce overly strict `additionalProperties` defaults.

```bash
npm -w @foundry-mcp/server run build
npm run test:mcp:schema
```


## Support & Development

* **Original project issues**: [GitHub Issues (upstream)](https://github.com/adambdooley/foundry-vtt-mcp/issues)
* **Fork-specific issues**: Open an issue on this repository
* **License**: MIT
