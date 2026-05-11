import { z } from 'zod';
import { FoundryClient } from '../../foundry-client.js';
import { Logger } from '../../logger.js';
import { ErrorHandler } from '../../utils/error-handler.js';
import { detectGameSystem, getCachedSystemId } from '../../utils/system-detection.js';

// ---------------------------------------------------------------------------
// Options interface
// ---------------------------------------------------------------------------

export interface DnD5eSpellsToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

// ---------------------------------------------------------------------------
// Tool class
// ---------------------------------------------------------------------------

export class DnD5eSpellsTools {
  private foundryClient: FoundryClient;
  private logger: Logger;
  private errorHandler: ErrorHandler;

  constructor({ foundryClient, logger }: DnD5eSpellsToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'DnD5eSpellsTools' });
    this.errorHandler = new ErrorHandler(this.logger);
  }

  getToolDefinitions() {
    return [
      {
        name: 'dnd5e-add-spells-to-actor',
        description:
          '[D&D 5e only] Import spells from an official compendium pack onto an actor (NPC or PC). ' +
          'Each spell is looked up by EXACT name (case-insensitive) in the specified compendium ' +
          'packs and embedded onto the actor as-is from the compendium data.\n\n' +
          'USE THIS TOOL when you need to:\n' +
          '  - Add named SRD/official spells to an actor by name\n' +
          '  - Equip an NPC spellcaster with their full spell list\n' +
          '  - Example: "add Fireball, Cone of Cold, and Ice Storm to Xardorok"\n' +
          '  - Example: "give this wizard their prepared spell list"\n\n' +
          '⚠️ IMPORTANT — spell names must be in English: the compendium uses English names. ' +
          'Translate BEFORE calling this tool if the user provided names in another language. ' +
          'Examples: "Palla di fuoco" → "Fireball"; "Dardo incantato" → "Magic Missile".\n\n' +
          '⚠️ IMPORTANT — call dnd5e-set-actor-spellcasting FIRST to configure spell slots. ' +
          'Spells added without prior spellcasting setup will exist on the actor but cannot ' +
          'be cast (no slots will be configured).\n\n' +
          'compendiumPacks controls which pack(s) to search (priority order, first match wins):\n' +
          '  - Default ["dnd5e.spells"]                   → SRD 2014 only\n' +
          '  - ["dnd5e.spells24"]                         → 2024 rules only\n' +
          '  - ["dnd5e.spells", "dnd5e.spells24"]         → 2014 first, 2024 as fallback\n\n' +
          'DO NOT USE THIS TOOL for:\n' +
          '  - Setting spellcasting ability or slot counts → use dnd5e-set-actor-spellcasting\n' +
          '  - Creating custom/homebrew spells from scratch → compendium-only, no homebrew\n' +
          '  - Adding weapon attacks, auras, or passive features → use the dedicated dnd5e-add-* tools\n' +
          '  - Non-dnd5e systems → this tool is dnd5e-exclusive\n\n' +
          'Returns a detailed report: spells added ✅, skipped (already on actor) ⏭️, ' +
          'not found in compendium ❌, and failed during import ⚠️.\n' +
          'Use list-characters or get-character first to find the actorIdentifier.',
        inputSchema: {
          type: 'object',
          properties: {
            actorIdentifier: {
              type: 'string',
              description: 'Name or ID of the target actor (partial name match supported)',
            },
            spellNames: {
              type: 'array',
              description:
                'English spell names to import (exact match, case-insensitive). ' +
                'Maximum 50 per call.',
              minItems: 1,
              maxItems: 50,
              items: { type: 'string', minLength: 1 },
            },
            compendiumPacks: {
              type: 'array',
              description:
                'Compendium pack IDs to search, in priority order (first match wins). ' +
                'Defaults to ["dnd5e.spells"] (SRD 2014). ' +
                'Use "dnd5e.spells24" for 2024 rules, or both for cross-edition fallback.',
              items: { type: 'string', minLength: 1 },
              default: ['dnd5e.spells'],
            },
          },
          required: ['actorIdentifier', 'spellNames'],
        },
      },
    ];
  }

  async handleAddSpellsToActor(args: any): Promise<any> {
    const schema = z.object({
      actorIdentifier: z.string().min(1, 'actorIdentifier cannot be empty'),
      spellNames:      z.array(z.string().min(1)).min(1).max(50),
      compendiumPacks: z.array(z.string().min(1)).default(['dnd5e.spells']),
    });

    const parsed = schema.parse(args);

    this.logger.info('Adding spells to D&D 5e actor', {
      actorIdentifier: parsed.actorIdentifier,
      spellCount:      parsed.spellNames.length,
      packs:           parsed.compendiumPacks,
    });

    try {
      const system = await detectGameSystem(this.foundryClient, this.logger);
      if (system !== 'dnd5e') {
        throw new Error(
          `dnd5e-add-spells-to-actor requires D&D 5e. ` +
          `Detected system: "${getCachedSystemId() ?? 'unknown'}".`,
        );
      }

      const result = await this.foundryClient.query(
        'foundry-mcp-bridge.addSpellsToActor',
        parsed,
      );

      this.logger.info('Spells import complete', {
        actorId:  result.actor?.id,
        added:    result.added?.length,
        skipped:  result.skipped?.length,
        notFound: result.notFound?.length,
        failed:   result.failed?.length,
      });

      return this.formatResponse(result, parsed);
    } catch (error) {
      this.errorHandler.handleToolError(
        error,
        'dnd5e-add-spells-to-actor',
        'spell import',
      );
    }
  }

  private formatResponse(result: any, params: any): any {
    const added    = result.added    as Array<{ name: string; packId: string; packLabel: string; itemId: string }>;
    const skipped  = result.skipped  as Array<{ name: string; reason: string }>;
    const notFound = result.notFound as string[];
    const failed   = result.failed   as Array<{ name: string; error: string }>;
    const warnings = result.warnings as string[];

    const totalRequested = (params.spellNames as string[]).length;

    // ── Summary line ──────────────────────────────────────────────────────────
    const parts: string[] = [];
    if (added.length > 0)    parts.push(`${added.length} added`);
    if (skipped.length > 0)  parts.push(`${skipped.length} skipped`);
    if (notFound.length > 0) parts.push(`${notFound.length} not found`);
    if (failed.length > 0)   parts.push(`${failed.length} failed`);

    const statusIcon = failed.length > 0 ? '⚠️' : notFound.length > 0 ? '🔍' : '✅';
    const summary =
      `${statusIcon} Spells imported to "${result.actor.name}" — ` +
      (parts.length > 0 ? parts.join(', ') : 'nothing changed');

    // ── Sections ──────────────────────────────────────────────────────────────
    const lines: string[] = [
      `**Actor:** ${result.actor.name} (id: \`${result.actor.id}\`)`,
      `**Requested:** ${totalRequested} — Added: ${added.length}, Skipped: ${skipped.length}, Not found: ${notFound.length}${failed.length > 0 ? `, Failed: ${failed.length}` : ''}`,
    ];

    if (added.length > 0) {
      lines.push('\n✅ **Added:**');
      for (const s of added) {
        lines.push(`  - ${s.name} *(${s.packLabel}, item \`${s.itemId}\`)*`);
      }
    }

    if (skipped.length > 0) {
      lines.push('\n⏭️ **Skipped:**');
      for (const s of skipped) {
        lines.push(`  - ${s.name} — *${s.reason}*`);
      }
    }

    if (notFound.length > 0) {
      lines.push('\n❌ **Not found in compendium:**');
      for (const name of notFound) {
        lines.push(`  - ${name}`);
      }
    }

    if (failed.length > 0) {
      lines.push('\n⚠️ **Failed during import:**');
      for (const f of failed) {
        lines.push(`  - ${f.name} — *${f.error}*`);
      }
    }

    if (warnings.length > 0) {
      lines.push(`\n⚠️ **Warnings:**`);
      for (const w of warnings) {
        lines.push(`  - ${w}`);
      }
    }

    return {
      summary,
      success:  added.length > 0 || (notFound.length === 0 && failed.length === 0),
      actor:    result.actor,
      added,
      skipped,
      notFound,
      failed,
      warnings,
      message:  `${summary}\n\n${lines.join('\n')}`,
    };
  }
}
