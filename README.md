# Foundry VTT MCP Bridge

Connect Foundry VTT to Claude Desktop for AI-powered campaign management through the Model Context Protocol (MCP). It currently supports Dungeons and Dragons Fifth Edition, Pathfinder Second Edition, Das Schwarze Augen Fifth Edition, Cosmere RPG System, & Warhammer Fantasy Roleplay 4th Edition. The majority of MCP tools are system agnostic or have features that are aware of the system it is working with, excluding some DSA 5 specific tools.

## Overview

The Foundry MCP Bridge enables natural AI conversations with your Foundry VTT game data:

- **Quest Creation**: [Create quests from prompts that incorporate what exists in your world and journals](https://www.youtube.com/watch?v=NqyB_z2AKME)
- **Character Management**: Query character stats, abilities, and information
- **Compendium Search**: Find items, spells, and creatures using natural language
- **Content Creation**: Generate actors, NPCs, and quest journals from simple prompts
- **Scene Information**: Access current scene data and world details
- **Dice Coordination**: Interactive roll requests with player targeting
- **Campaign Management**: Multi-part quest and campaign tracking
- **Map Generation**: Create maps from prompts and automatically upload them into scenes in Foundry VTT using the optional ComfyUI component

## Installation

### Prerequisites

- **Foundry VTT v13 or v14**
- **Claude Desktop** with MCP support
- **Windows** (for automated installer) or **Node.js 18+** for manual installation

### Option 1: Windows Installer

[Video guide for Windows Installer](https://youtu.be/Se04A21wrbE)

1. Download the latest `FoundryMCPServer-Setup-vx.x.x.exe` from [Releases](https://github.com/adambdooley/foundry-vtt-mcp/releases)
2. Run the installer - it will:
   - Install the MCP server with bundled Node.js runtime
   - Configure the Claude Desktop MCP server settings
   - Optionally install the Foundry module and ComfyUI Map Generation to your VTT installation
   - Choose Cuda version for your GPU type during install
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

### Option 3: Manual Installation

#### Install the Foundry Module

1. Open Foundry VTT (v13 or v14)
2. Select install module in the Foundry Add-ons menu
3. At the bottom of the window, add the Manifest URL as: https://github.com/adambdooley/foundry-vtt-mcp/blob/master/packages/foundry-module/module.json and click install
4. Enable "Foundry MCP Bridge" in Module Management
   - **Do not change the module ID or folder name.** The MCP backend and the Claude integration both expect the module to live in a directory called `foundry-mcp-bridge`. Renaming the ID in `module.json` breaks socket routing and stops Claude from seeing the backend.

#### Install the MCP Server

```bash
# Clone repository
git clone https://github.com/adambdooley/foundry-vtt-mcp.git
cd foundry-vtt-mcp

# Install dependencies and build
npm install
npm run build

```

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

Starting Claude Desktop will start the MCP Server.

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

- **56 MCP Tools** that allow Claude to interact with Foundry
- **Combat Play-by-Play & Chat Log**: A live in-memory buffer of chat messages (rolls, damage, flavor, crit/fumble, advantage) plus a structured round-by-round combat summary
- **In-Character Chat**: Post messages to Foundry chat as a specific character or the GM (ic/ooc/emote/whisper)
- **Resource Tracking**: Clean, queryable spell slots, class resources (Ki, Rage, Sorcery Points…), item charges, concentration, hit dice, and death saves — with safe updates
- **Active Effect & Condition Management**: Read all effects with durations and modifiers; clear expired or named conditions after a fight
- **Initiative & Turn Tracker**: Read full combat state, advance turns, and set initiative
- **Movement & Positioning**: Token positions on a scene and grid-aware distance measurement
- **Session Event Log**: A persistent per-session memory of combats, HP changes, deaths, conditions, resources, scene changes, and journals
- **D&D 5e NPC Creation Suite**: Build complete NPCs from prompts — stat block, attacks, saves, auras, and spellcasting
- **WFRP4e Support**: Character reading for Warhammer Fantasy Roleplay 4e
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
- **38** dnd5e-create-npc (D&D 5e Only)
- **39** dnd5e-add-feature (D&D 5e Only)
- **40** dnd5e-add-features-from-compendium (D&D 5e Only)
- **41** get-chat-log
- **42** get-combat-play-by-play
- **43** send-chat-message
- **44** get-character-resources
- **45** update-character-resource
- **46** get-active-effects
- **47** clear-stale-conditions
- **48** get-combat-state
- **49** advance-combat-turn
- **50** set-initiative
- **51** get-token-positions
- **52** measure-distance
- **53** request-ability-check
- **54** request-attack-roll
- **55** roll-npc-check
- **56** get-session-log

## Combat, Chat & Session Tools (v0.9.0)

These tools add chat-log access, combat play-by-play, resource/effect tracking,
an initiative tracker, movement helpers, and a session memory layer. The chat-log
and session-event buffers live in the Foundry module (browser memory) and are
requested on demand by the MCP server over the existing WebRTC/WebSocket channel.

### Chat log & play-by-play (3A)

- **`get-chat-log`** — Buffered chat messages.
  - Params: `limit` (int, default 50, max 200), `speakerName` (string, partial match), `messageType` (`roll` | `damage` | `all`), `sinceTimestamp` (ISO string).
  - Returns: `{ success, count, messages: [{ id, timestamp, speakerName, actorId, messageType, isRoll, content, flavor, roll: { formula, total, dice:[{faces,results}], isCritical, isFumble, advantage }, damage: { total, types[] }, whisperTo[] }] }`.
- **`get-combat-play-by-play`** — Structured summary of the current/most-recent combat.
  - Params: none.
  - Returns: `{ success, combatActive, totalRounds, rounds:[{ round, turns:[{ combatant, actions:[{ actor, summary, timestamp, rollTotal, damage }] }] }], significantEvents:[{ type, description, actor, timestamp }], summary:{ totalRounds, damageByActor:{ [actor]: total }, note } }`.
- **`send-chat-message`** — Post a message as an actor or the GM.
  - Params: `message` (required), `speakerActorId`, `speakerActorName`, `messageType` (`ic` | `ooc` | `emote` | `whisper`, default `ic`), `whisperTargets` (string[] of user names).
  - Returns: `{ success, messageId, speaker, messageType, whisperedTo[] }`.

### Resource tracking (3C)

- **`get-character-resources`** — Limited-use resources for an actor.
  - Params: `identifier` (name or ID).
  - Returns: `{ success, actorId, actorName, system, spellSlots:{ levelN:{ max, current, expended }, pact? }, classResources:[{ key, label, max, current }], itemCharges:[{ itemName, charges, max, recharge }], concentration:{ active, spell, remaining }, hitDice:{ total, available, dieType }, deathSaves:{ successes, failures } | null }`.
- **`update-character-resource`** — Update a single resource (validated to 0..max).
  - Params: `identifier`, `resourceName` (e.g. `spell3`, `pact`, a class-resource label/key, or an item name), `newValue` (int).
  - Returns: `{ success, actorId, actorName, resourceName, newValue, max }`.

### Active effects / conditions (3D)

- **`get-active-effects`** — All active effects on an actor.
  - Params: `identifier`.
  - Returns: `{ success, actorId, actorName, count, effects:[{ id, name, icon, disabled, isCondition, type, statuses[], duration:{ rounds, turns, seconds, remaining }, changes:[{ key, mode, value }], requiresConcentration }] }`.
- **`clear-stale-conditions`** — Remove expired or listed conditions.
  - Params: `identifier`, `conditionNames` (optional string[]). With no list, removes only expired conditions.
  - Returns: `{ success, actorId, actorName, removedCount, removed[] }`.

### Combat tracker (3E)

- **`get-combat-state`** — Full current combat state.
  - Params: none.
  - Returns: `{ success, active, round, turn, current, combatants:[{ id, name, initiative, isCurrentTurn, hasActed, hp:{ value, max, temp }, conditions[], isPC, category, defeated, deathSaves }], downed[] }`.
- **`advance-combat-turn`** — Advance to the next combatant, or jump to one.
  - Params: `skipTo` (optional combatant name or actor ID).
  - Returns: `{ success, round, turn, current }`.
- **`set-initiative`** — Set/override a combatant's initiative.
  - Params: `combatantName`, `initiative` (number).
  - Returns: `{ success, combatant, initiative }`.

### Movement & positioning (3F)

- **`get-token-positions`** — Tokens on a scene.
  - Params: `sceneId` (optional; defaults to active scene).
  - Returns: `{ success, sceneId, sceneName, gridSize, gridDistance, gridUnits, tokenCount, tokens:[{ tokenId, name, actorId, x, y, gridX, gridY, elevation, category, hidden, hp:{ value, max }, conditions[] }] }`.
- **`measure-distance`** — Distance between two tokens.
  - Params: `fromTokenName`, `toTokenName`.
  - Returns: `{ success, from, to, distance, units }`.

### Extended roll requests / NPC rolls (3G)

- **`request-ability-check`** — Post an ability-check button to a player (shows DC).
  - Params: `targetPlayer`, `ability` (`str`/`dex`/`con`/`int`/`wis`/`cha`), `dc` (optional int), `isPublic` (bool), `reason` (optional).
- **`request-attack-roll`** — Post a weapon/spell attack-roll button to a player.
  - Params: `targetPlayer`, `weaponOrSpellName`, `isPublic` (bool).
- **`roll-npc-check`** — Roll directly for an NPC and post the result.
  - Params: `actorName`, `rollType` (`ability` | `save` | `skill` | `attack`), `rollTarget`, `isPublic` (bool).
  - Returns: `{ success, actorName, rollType, rollTarget, formula, total, isPublic }`.

### Session event log (3H)

- **`get-session-log`** — Structured session memory.
  - Params: `limit` (int, default 100), `eventType` (optional), `actorName` (optional).
  - Returns: `{ success, count, events:[{ id, timestamp, eventType, actorName, actorId, description, details }] }`.
  - Event types: `combat-start`, `combat-end`, `damage`, `damage-roll`, `healing`, `death`, `stabilize`, `condition-applied`, `condition-removed`, `resource-spent`, `scene-change`, `journal-created`, `journal-updated`.

## Settings

<img width="964" height="803" alt="image" src="https://github.com/user-attachments/assets/bfd435d5-2df4-40a6-a79b-87e98121db3f" />

- **Enhanced Creature Index** Configure Enhanced Index button leads to Enhanced Creature Index sub-menu (Details below)
- **Map Generation Service Configuration** Configure Map Generation button leads to Map Generation Service sub-menu (Details below)
- **Enable MCP Bridge** This should be checked by default and the status should show as connected. It can be used to turn off the MCP Bridge connection within the game without the need to disable the add-on itself.
- **Connection Type** Can be set to Auto for automatic detection of connection type. Can also be set to force either WebRTC for Internet connections or Websocket for Local connections.
- **Websocket Server Host** IP Address of Claude Desktop MCP Server location. Only used for local network websocket connections. Remote Servers use WebRT. Defaults to localhost.
- **Allow Write Operations** This will prevent Claude from making any changes to world content and restrict it to reading only
- **Max Actors Per Request** This is a failsafe to stop a massive amount of actors being created from one single request. It does not limit the amount of characters being created by multiple requests
- **Chat Log Buffer Size** How many recent chat messages the module keeps in memory for the `get-chat-log` and `get-combat-play-by-play` tools (default 200)
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

- **Foundry Module**: Provides secure data access within Foundry VTT
- **MCP Server**: External Node.js server handling Claude Desktop communication
- **Map Generation Service**: A headless ComfyUI backend that is spawned by Claude Desktop
- **No API Keys Required**: Uses your existing Claude Desktop subscription

## Security & Permissions

- **GM-Only Access**: All functionality restricted to Game Master users
- **Configurable Permissions**: Control what data Claude can access and modify
- **Session-Based Authentication**: Uses Foundry's built-in authentication system

## System Requirements

- **Foundry VTT**: Version 13
- **Claude Desktop**: Latest version with MCP support
- **Claude Pro/Max Plan**: Required to connect to MCP servers
- **Operating System**: Windows 10/11 (installer), or other OSes/manual Windows install with Node.js 18+ (manual)
- **GPU Requirements**: A GPU with at least 8GB of VRAM

## Schema Smoke Test

The MCP schema smoke test verifies that tool schemas load correctly and do not enforce overly strict `additionalProperties` defaults.

```bash
npm -w @foundry-mcp/server run build
npm run test:mcp:schema
```

## Support & Development

- **Issues**: Report bugs on [GitHub Issues](https://github.com/adambdooley/foundry-vtt-mcp/issues)
- **YouTube Channel**: [Subscribe for updates and tutorials](https://www.youtube.com/channel/UCVrSC-FzuAk5AgvfboJj0WA)
- **Documentation**: Built with TypeScript, comprehensive documentation included
- **License**: MIT License (Additional Third Party licenses are included for bundled components for the installers)
