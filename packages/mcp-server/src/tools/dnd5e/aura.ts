import { z } from 'zod';
import { FoundryClient } from '../../foundry-client.js';
import { Logger } from '../../logger.js';
import { ErrorHandler } from '../../utils/error-handler.js';
import { detectGameSystem, getCachedSystemId } from '../../utils/system-detection.js';

// ---------------------------------------------------------------------------
// Canonical damage types — soft validation (warning, not error)
// ---------------------------------------------------------------------------

const AURA_DAMAGE_CANONICAL = new Set([
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning',
  'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
]);

// ---------------------------------------------------------------------------
// Options interface
// ---------------------------------------------------------------------------

export interface DnD5eAuraToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

// ---------------------------------------------------------------------------
// Tool class
// ---------------------------------------------------------------------------

export class DnD5eAuraTools {
  private foundryClient: FoundryClient;
  private logger: Logger;
  private errorHandler: ErrorHandler;

  constructor({ foundryClient, logger }: DnD5eAuraToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'DnD5eAuraTools' });
    this.errorHandler = new ErrorHandler(this.logger);
  }

  getToolDefinitions() {
    return [
      {
        name: 'dnd5e-add-aura-feature',
        description:
          '[D&D 5e only] Add an automatic-damage aura or emanation feature to an existing actor ' +
          '(NPC or character). Creates a "feat" item with a single "damage" Activity — damage is ' +
          'unconditional, with no attack roll and no saving throw. An area template is required ' +
          '(this is an area effect, not a single-target attack).\n\n' +
          'USE THIS TOOL when the feature says things like:\n' +
          '  - "every creature within X feet takes Y damage"\n' +
          '  - "all creatures in the area take damage automatically"\n' +
          '  - "creatures in the emanation / aura / pulse / field take damage — no save, no attack roll"\n' +
          '  - "the damage just happens to anyone in range"\n\n' +
          'DO NOT USE THIS TOOL for:\n' +
          '  - Attacks with a to-hit roll → use dnd5e-add-attack-feature instead\n' +
          '  - Effects that allow a saving throw (even if damage is involved) ' +
          '→ use dnd5e-add-feature-with-save instead\n' +
          '  - Conditions or status effects without damage → not currently supported\n\n' +
          'Use list-characters or get-character first to find the actorIdentifier. ' +
          'Will error if an item with the same name already exists on the actor.',
        inputSchema: {
          type: 'object',
          properties: {
            actorIdentifier: {
              type: 'string',
              description: 'Name or ID of the target actor (partial name match supported)',
            },
            featureName: {
              type: 'string',
              description:
                'Name for the new aura feature — must be unique on the actor ' +
                '(e.g. "Cold Aura", "Psychic Emanation", "Corrupting Pulse")',
            },
            description: {
              type: 'string',
              description: 'HTML description of the feature (optional)',
              default: '',
            },
            activationType: {
              type: 'string',
              enum: ['action', 'bonus', 'reaction', 'legendary', 'lair', 'special'],
              description: 'Action economy type',
              default: 'action',
            },
            damageParts: {
              type: 'array',
              description:
                'One or more damage components dealt automatically to all creatures in the area. ' +
                'Multiple parts stack (e.g. 2d6 cold + 1d8 necrotic).',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  number: {
                    type: 'number',
                    description: 'Number of dice (e.g. 3)',
                    minimum: 1,
                  },
                  denomination: {
                    type: 'number',
                    description: 'Die size: 4, 6, 8, 10, 12, 20, or 100',
                    enum: [4, 6, 8, 10, 12, 20, 100],
                  },
                  type: {
                    type: 'string',
                    description: 'Damage type (e.g. "cold", "psychic", "necrotic")',
                  },
                },
                required: ['number', 'denomination', 'type'],
              },
            },
            areaType: {
              type: 'string',
              enum: ['cone', 'cube', 'cylinder', 'emanation', 'line', 'radius', 'sphere'],
              description:
                'Area-of-effect template shape. Required — an aura must have an explicit area. ' +
                'Use "emanation" or "sphere" for standard radial auras, "cone" for directional blasts.',
            },
            areaSize: {
              type: 'number',
              description: 'Template size in areaUnits (e.g. 30 for a 30 ft emanation). Must be > 0.',
              exclusiveMinimum: 0,
            },
            areaUnits: {
              type: 'string',
              enum: ['ft', 'm'],
              description: 'Units for areaSize',
              default: 'ft',
            },
            affectsType: {
              type: 'string',
              enum: ['creature', 'object', 'space', ''],
              description: 'What the area affects',
              default: 'creature',
            },
            sourceRules: {
              type: 'string',
              enum: ['2014', '2024'],
              description: 'Rules edition',
              default: '2014',
            },
            sourceBook: {
              type: 'string',
              description: 'Source book abbreviation (e.g. "MM\'14")',
              default: '',
            },
            sourcePage: {
              type: 'string',
              description: 'Page number in the source book',
              default: '',
            },
          },
          required: ['actorIdentifier', 'featureName', 'damageParts', 'areaType', 'areaSize'],
        },
      },
    ];
  }

  async handleAddAuraFeature(args: any): Promise<any> {
    const schema = z.object({
      actorIdentifier: z.string().min(1, 'actorIdentifier cannot be empty'),
      featureName:     z.string().min(1, 'featureName cannot be empty'),
      description:     z.string().default(''),
      activationType:  z
        .enum(['action', 'bonus', 'reaction', 'legendary', 'lair', 'special'])
        .default('action'),
      damageParts: z
        .array(
          z.object({
            number:       z.number().int().min(1),
            denomination: z
              .number()
              .int()
              .refine((d) => [4, 6, 8, 10, 12, 20, 100].includes(d), {
                message: 'denomination must be one of 4, 6, 8, 10, 12, 20, 100',
              }),
            type: z.string().min(1, 'damage type cannot be empty'),
          }),
        )
        .min(1, 'at least one damage part is required'),
      areaType:  z.enum(['cone', 'cube', 'cylinder', 'emanation', 'line', 'radius', 'sphere']),
      areaSize:  z.number().positive('areaSize must be greater than 0'),
      areaUnits: z.enum(['ft', 'm']).default('ft'),
      affectsType: z.enum(['creature', 'object', 'space', '']).default('creature'),
      sourceRules: z.enum(['2014', '2024']).default('2014'),
      sourceBook:  z.string().default(''),
      sourcePage:  z.string().default(''),
    });
    // No superRefine needed: areaType and areaSize are both directly required

    const parsed = schema.parse(args);

    // -----------------------------------------------------------------------
    // Soft validation — collect warnings, do NOT block creation
    // -----------------------------------------------------------------------
    const warnings: string[] = [];

    for (const part of parsed.damageParts) {
      if (!AURA_DAMAGE_CANONICAL.has(part.type)) {
        const msg = `Unknown damage type "${part.type}" — verify it matches dnd5e system values`;
        warnings.push(msg);
        this.logger.warn(msg, { value: part.type });
      }
    }

    this.logger.info('Adding aura feature to D&D 5e actor', {
      actorIdentifier: parsed.actorIdentifier,
      featureName:     parsed.featureName,
      areaType:        parsed.areaType,
      areaSize:        parsed.areaSize,
      damageParts:     parsed.damageParts,
      warnings:        warnings.length,
    });

    try {
      const system = await detectGameSystem(this.foundryClient, this.logger);
      if (system !== 'dnd5e') {
        throw new Error(
          `dnd5e-add-aura-feature requires D&D 5e. ` +
          `Detected system: "${getCachedSystemId() ?? 'unknown'}".`,
        );
      }

      const result = await this.foundryClient.query(
        'foundry-mcp-bridge.addAuraToActor',
        parsed,
      );

      this.logger.info('Aura feature added successfully', {
        actorId: result.actor?.id,
        itemId:  result.item?.id,
      });

      return this.formatResponse(result, parsed, warnings);
    } catch (error) {
      this.errorHandler.handleToolError(
        error,
        'dnd5e-add-aura-feature',
        'aura feature creation',
      );
    }
  }

  private formatResponse(result: any, params: any, warnings: string[]): any {
    const damageDesc = (params.damageParts as any[])
      .map((p) => `${p.number}d${p.denomination} ${p.type}`)
      .join(' + ');

    const areaDesc = `${params.areaSize}${params.areaUnits} ${params.areaType}`;

    const summary = `✅ Aura "${result.item.name}" added to "${result.actor.name}"`;

    const details = [
      `**Actor:** ${result.actor.name} (id: \`${result.actor.id}\`)`,
      `**Feature:** ${result.item.name} (id: \`${result.item.id}\`)`,
      `**Damage:** ${damageDesc} (automatic — no attack roll, no saving throw)`,
      `**Area:** ${areaDesc}, affects: ${params.affectsType || 'any'}`,
      `**Activation:** ${params.activationType}`,
    ].join('\n');

    const warningSection = warnings.length > 0
      ? `\n\n⚠️ **Warnings (${warnings.length}):**\n${warnings.map((w) => `- ${w}`).join('\n')}`
      : '';

    return {
      summary,
      success:  true,
      item:     result.item,
      actor:    result.actor,
      warnings,
      message:  `${summary}\n\n${details}${warningSection}`,
    };
  }
}
