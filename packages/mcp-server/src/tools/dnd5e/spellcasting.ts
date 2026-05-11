import { z } from 'zod';
import { FoundryClient } from '../../foundry-client.js';
import { Logger } from '../../logger.js';
import { ErrorHandler } from '../../utils/error-handler.js';
import { detectGameSystem, getCachedSystemId } from '../../utils/system-detection.js';

// ---------------------------------------------------------------------------
// Default spellcasting ability per class (used when caller omits the field)
// ---------------------------------------------------------------------------

const CLASS_DEFAULT_ABILITY: Record<string, string> = {
  wizard:    'int',
  artificer: 'int',
  cleric:    'wis',
  druid:     'wis',
  ranger:    'wis',
  sorcerer:  'cha',
  warlock:   'cha',
  bard:      'cha',
  paladin:   'cha',
};

// ---------------------------------------------------------------------------
// Options interface
// ---------------------------------------------------------------------------

export interface DnD5eSpellcastingToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

// ---------------------------------------------------------------------------
// Tool class
// ---------------------------------------------------------------------------

export class DnD5eSpellcastingTools {
  private foundryClient: FoundryClient;
  private logger: Logger;
  private errorHandler: ErrorHandler;

  constructor({ foundryClient, logger }: DnD5eSpellcastingToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'DnD5eSpellcastingTools' });
    this.errorHandler = new ErrorHandler(this.logger);
  }

  getToolDefinitions() {
    return [
      {
        name: 'dnd5e-set-actor-spellcasting',
        description:
          '[D&D 5e only] Set up spellcasting on an existing actor — configures the casting ' +
          'ability and spell slot counts. Run this BEFORE using dnd5e-add-spells-to-actor ' +
          'to add individual spells.\n\n' +
          'This tool sets:\n' +
          '  - The spellcasting ability (INT / WIS / CHA, with class-appropriate defaults)\n' +
          '  - Spell slot counts for all 9 levels using the correct SRD table for the class ' +
          'and level\n' +
          '  - Pact Magic slots for Warlocks (correct slot count and slot level, not regular ' +
          'spell slots — all regular slots are reset to 0)\n\n' +
          'Spell save DC and spell attack bonus are automatically computed by Foundry from the ' +
          "actor's ability scores and proficiency bonus — no need to pass them.\n\n" +
          'USE THIS TOOL when you need to:\n' +
          '  - Add spellcasting capability to a new NPC from scratch\n' +
          "  - Update an existing NPC's spell slot counts after changing their level\n" +
          '  - Set the casting ability on an actor before calling dnd5e-add-spells-to-actor\n\n' +
          'DO NOT USE THIS TOOL for:\n' +
          '  - Adding specific spells to an actor → use dnd5e-add-spells-to-actor instead\n' +
          '  - Multiclass spellcasting (two classes simultaneously) → not supported in V1\n' +
          '  - Non-slot casting variants (psionics, channel divinity) → not supported\n\n' +
          'Use list-characters or get-character first to find the actorIdentifier.',
        inputSchema: {
          type: 'object',
          properties: {
            actorIdentifier: {
              type: 'string',
              description: 'Name or ID of the target actor (partial name match supported)',
            },
            spellcastingClass: {
              type: 'string',
              enum: [
                'artificer', 'bard', 'cleric', 'druid', 'paladin',
                'ranger', 'sorcerer', 'warlock', 'wizard',
              ],
              description:
                'The spellcasting class — determines the slot table and the default ' +
                'casting ability. Warlock uses Pact Magic (separate slot system).',
            },
            spellcastingLevel: {
              type: 'number',
              description: 'Class level (1–20). Determines how many slots the actor receives.',
              minimum: 1,
              maximum: 20,
            },
            spellcastingAbility: {
              type: 'string',
              enum: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
              description:
                'Override the casting ability. Omit to use the class default: ' +
                'wizard/artificer → INT, cleric/druid/ranger → WIS, ' +
                'sorcerer/warlock/bard/paladin → CHA.',
            },
            sourceRules: {
              type: 'string',
              enum: ['2014', '2024'],
              description: 'Rules edition (used for source metadata only; slot tables are SRD)',
              default: '2014',
            },
          },
          required: ['actorIdentifier', 'spellcastingClass', 'spellcastingLevel'],
        },
      },
    ];
  }

  async handleSetActorSpellcasting(args: any): Promise<any> {
    const schema = z.object({
      actorIdentifier:     z.string().min(1, 'actorIdentifier cannot be empty'),
      spellcastingClass:   z.enum([
        'artificer', 'bard', 'cleric', 'druid', 'paladin',
        'ranger', 'sorcerer', 'warlock', 'wizard',
      ]),
      spellcastingLevel:   z.number().int().min(1).max(20),
      spellcastingAbility: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']).optional(),
      sourceRules:         z.enum(['2014', '2024']).default('2014'),
    });

    const parsed = schema.parse(args);

    const effectiveAbility =
      parsed.spellcastingAbility ?? CLASS_DEFAULT_ABILITY[parsed.spellcastingClass];

    this.logger.info('Setting actor spellcasting', {
      actorIdentifier:   parsed.actorIdentifier,
      spellcastingClass: parsed.spellcastingClass,
      spellcastingLevel: parsed.spellcastingLevel,
      ability:           effectiveAbility,
    });

    try {
      const system = await detectGameSystem(this.foundryClient, this.logger);
      if (system !== 'dnd5e') {
        throw new Error(
          `dnd5e-set-actor-spellcasting requires D&D 5e. ` +
          `Detected system: "${getCachedSystemId() ?? 'unknown'}".`,
        );
      }

      const result = await this.foundryClient.query(
        'foundry-mcp-bridge.setActorSpellcasting',
        { ...parsed, effectiveAbility },
      );

      this.logger.info('Actor spellcasting set successfully', {
        actorId: result.actor?.id,
      });

      return this.formatResponse(result, { ...parsed, effectiveAbility });
    } catch (error) {
      this.errorHandler.handleToolError(
        error,
        'dnd5e-set-actor-spellcasting',
        'spellcasting setup',
      );
    }
  }

  private formatResponse(result: any, params: any): any {
    const isWarlock = params.spellcastingClass === 'warlock';

    const slotsDesc = isWarlock
      ? `Pact Magic: ${result.spellcasting.slots.pact.max} slot(s) of level ${result.spellcasting.slots.pact.level}`
      : Object.entries(result.spellcasting.slots as Record<string, number>)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `L${k.replace('spell', '')}: ${n}`)
          .join(', ') || 'no slots';

    const summary =
      `✅ Spellcasting configured on "${result.actor.name}" — ` +
      `${params.spellcastingClass} level ${params.spellcastingLevel}`;

    const details = [
      `**Actor:** ${result.actor.name} (id: \`${result.actor.id}\`)`,
      `**Class:** ${params.spellcastingClass} — level ${params.spellcastingLevel}`,
      `**Ability:** ${String(params.effectiveAbility).toUpperCase()}`,
      `**Slots:** ${slotsDesc}`,
    ].join('\n');

    const warningSection = (result.warnings as string[]).length > 0
      ? `\n\n⚠️ **Warnings:**\n${(result.warnings as string[]).map((w: string) => `- ${w}`).join('\n')}`
      : '';

    return {
      summary,
      success:      true,
      actor:        result.actor,
      spellcasting: result.spellcasting,
      warnings:     result.warnings,
      message:      `${summary}\n\n${details}${warningSection}`,
    };
  }
}
