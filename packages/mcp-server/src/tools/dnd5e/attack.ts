import { z } from 'zod';
import { FoundryClient } from '../../foundry-client.js';
import { Logger } from '../../logger.js';
import { ErrorHandler } from '../../utils/error-handler.js';
import { detectGameSystem, getCachedSystemId } from '../../utils/system-detection.js';

// ---------------------------------------------------------------------------
// Canonical value sets for soft validation (warnings, not errors)
// ---------------------------------------------------------------------------

const ATTACK_DAMAGE_CANONICAL = new Set([
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning',
  'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
]);

// 2014 weapon property codes — soft-validate; 2024 additions accepted with warning
const ATTACK_PROPERTY_CANONICAL = new Set([
  'ada', 'amm', 'fin', 'fir', 'foc', 'hvy', 'lgt', 'lod', 'mgc',
  'rch', 'ret', 'spc', 'thr', 'two', 'ver',
]);

// ---------------------------------------------------------------------------
// Options interface
// ---------------------------------------------------------------------------

export interface DnD5eAttackToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

// ---------------------------------------------------------------------------
// Tool class
// ---------------------------------------------------------------------------

export class DnD5eAttackTools {
  private foundryClient: FoundryClient;
  private logger: Logger;
  private errorHandler: ErrorHandler;

  constructor({ foundryClient, logger }: DnD5eAttackToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'DnD5eAttackTools' });
    this.errorHandler = new ErrorHandler(this.logger);
  }

  getToolDefinitions() {
    return [
      {
        name: 'dnd5e-add-attack-feature',
        description:
          '[D&D 5e only] Add a weapon attack to an existing actor (NPC or character). ' +
          'Creates a weapon item with an attack Activity: specify whether it\'s melee or ranged, ' +
          'the ability modifier used for to-hit and damage (defaults to STR for melee, DEX for ranged), ' +
          'one or more damage components (first is the base damage die; additional parts stack on top), ' +
          'an optional magic bonus that applies to both to-hit and damage (+1, +2, etc.), weapon class ' +
          '("natural" for monster claws/bite/touch attacks), properties, and range. ' +
          'Use list-characters or get-character first to find the actorIdentifier. ' +
          'Will error if an item with the same name already exists on the actor. ' +
          'For saving-throw features (no to-hit roll), use dnd5e-add-feature-with-save instead.',
        inputSchema: {
          type: 'object',
          properties: {
            actorIdentifier: {
              type: 'string',
              description: 'Name or ID of the target actor (partial name match supported)',
            },
            featureName: {
              type: 'string',
              description: 'Name for the new attack item — must be unique on the actor (e.g. "Claw", "Scimitar", "Bite")',
            },
            description: {
              type: 'string',
              description: 'HTML description of the attack (optional)',
              default: '',
            },
            activationType: {
              type: 'string',
              enum: ['action', 'bonus', 'reaction', 'legendary', 'lair', 'special'],
              description: 'Action economy type',
              default: 'action',
            },
            attackType: {
              type: 'string',
              enum: ['melee', 'ranged'],
              description: '"melee" for reach-based attacks; "ranged" for bow/thrown attacks',
            },
            weaponClass: {
              type: 'string',
              enum: ['natural', 'simpleM', 'martialM', 'simpleR', 'martialR'],
              description: 'Weapon category. Use "natural" for monster natural attacks (claws, bite, touch, etc.)',
              default: 'natural',
            },
            abilityModifier: {
              type: 'string',
              enum: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
              description: 'Ability used for both to-hit and damage rolls. Omit to use the default: STR for melee, DEX for ranged.',
            },
            attackBonus: {
              type: 'number',
              description: 'Magic bonus added to both to-hit and damage (e.g. 1 for a +1 weapon). Use 0 for no bonus.',
              minimum: 0,
              maximum: 10,
              default: 0,
            },
            proficient: {
              type: 'boolean',
              description: 'Whether the actor is proficient with this weapon (adds proficiency bonus to to-hit)',
              default: true,
            },
            equipped: {
              type: 'boolean',
              description: 'Whether the weapon is equipped and available for attack rolls',
              default: true,
            },
            reachFt: {
              type: 'number',
              description: 'Melee reach in feet. Only relevant when attackType is "melee".',
              minimum: 5,
              default: 5,
            },
            rangeFt: {
              type: 'number',
              description: 'Normal range in feet. Required when attackType is "ranged".',
              minimum: 1,
            },
            longRangeFt: {
              type: 'number',
              description:
                'Long range in feet — attacks beyond rangeFt up to this distance are made at disadvantage. ' +
                'Must be greater than rangeFt. Only relevant when attackType is "ranged".',
              minimum: 1,
            },
            damageParts: {
              type: 'array',
              description:
                'One or more damage components. The first entry is the base weapon damage die. ' +
                'Additional entries represent extra damage (e.g. +1d6 fire on a flame-touched weapon).',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  number: {
                    type: 'number',
                    description: 'Number of dice (e.g. 2)',
                    minimum: 1,
                  },
                  denomination: {
                    type: 'number',
                    description: 'Die size: 4, 6, 8, 10, 12, 20, or 100',
                    enum: [4, 6, 8, 10, 12, 20, 100],
                  },
                  type: {
                    type: 'string',
                    description: 'Damage type (e.g. "slashing", "piercing", "fire")',
                  },
                },
                required: ['number', 'denomination', 'type'],
              },
            },
            properties: {
              type: 'array',
              description:
                'Weapon property codes (e.g. ["fin", "lgt"]). ' +
                'Canonical 2014 codes: ada, amm, fin, fir, foc, hvy, lgt, lod, mgc, rch, ret, spc, thr, two, ver. ' +
                'Non-canonical values are accepted with a warning.',
              items: { type: 'string' },
              default: [],
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
          required: ['actorIdentifier', 'featureName', 'attackType', 'damageParts'],
        },
      },
    ];
  }

  async handleAddAttackFeature(args: any): Promise<any> {
    const schema = z
      .object({
        actorIdentifier: z.string().min(1, 'actorIdentifier cannot be empty'),
        featureName:     z.string().min(1, 'featureName cannot be empty'),
        description:     z.string().default(''),
        activationType:  z
          .enum(['action', 'bonus', 'reaction', 'legendary', 'lair', 'special'])
          .default('action'),
        attackType:      z.enum(['melee', 'ranged']),
        weaponClass:     z
          .enum(['natural', 'simpleM', 'martialM', 'simpleR', 'martialR'])
          .default('natural'),
        abilityModifier: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']).optional(),
        attackBonus:     z.number().int().min(0).max(10).default(0),
        proficient:      z.boolean().default(true),
        equipped:        z.boolean().default(true),
        reachFt:         z.number().int().min(5).default(5),
        rangeFt:         z.number().int().min(1).optional(),
        longRangeFt:     z.number().int().min(1).optional(),
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
        properties:  z.array(z.string()).default([]),
        sourceRules: z.enum(['2014', '2024']).default('2014'),
        sourceBook:  z.string().default(''),
        sourcePage:  z.string().default(''),
      })
      .superRefine((data, ctx) => {
        if (data.attackType === 'ranged' && data.rangeFt === undefined) {
          ctx.addIssue({
            code:    z.ZodIssueCode.custom,
            path:    ['rangeFt'],
            message: 'rangeFt is required when attackType is "ranged"',
          });
        }
        if (
          data.longRangeFt !== undefined &&
          data.rangeFt    !== undefined &&
          data.longRangeFt <= data.rangeFt
        ) {
          ctx.addIssue({
            code:    z.ZodIssueCode.custom,
            path:    ['longRangeFt'],
            message: `longRangeFt (${data.longRangeFt}) must be greater than rangeFt (${data.rangeFt})`,
          });
        }
      });

    const parsed = schema.parse(args);

    // Resolve effective ability modifier — default by attackType, never empty string
    const effectiveAbility: string =
      parsed.abilityModifier ?? (parsed.attackType === 'melee' ? 'str' : 'dex');

    // -----------------------------------------------------------------------
    // Soft validation — collect warnings, do NOT block creation
    // -----------------------------------------------------------------------
    const warnings: string[] = [];

    for (const part of parsed.damageParts) {
      if (!ATTACK_DAMAGE_CANONICAL.has(part.type)) {
        const msg = `Unknown damage type "${part.type}" — verify it matches dnd5e system values`;
        warnings.push(msg);
        this.logger.warn(msg, { value: part.type });
      }
    }
    for (const prop of parsed.properties) {
      if (!ATTACK_PROPERTY_CANONICAL.has(prop)) {
        const msg = `Unknown weapon property "${prop}" — verify it matches dnd5e system values`;
        warnings.push(msg);
        this.logger.warn(msg, { value: prop });
      }
    }

    this.logger.info('Adding attack feature to D&D 5e actor', {
      actorIdentifier: parsed.actorIdentifier,
      featureName:     parsed.featureName,
      attackType:      parsed.attackType,
      weaponClass:     parsed.weaponClass,
      ability:         effectiveAbility,
      damageParts:     parsed.damageParts,
      warnings:        warnings.length,
    });

    try {
      const system = await detectGameSystem(this.foundryClient, this.logger);
      if (system !== 'dnd5e') {
        throw new Error(
          `dnd5e-add-attack-feature requires D&D 5e. ` +
          `Detected system: "${getCachedSystemId() ?? 'unknown'}".`,
        );
      }

      const result = await this.foundryClient.query(
        'foundry-mcp-bridge.addAttackToActor',
        { ...parsed, effectiveAbility },
      );

      this.logger.info('Attack feature added successfully', {
        actorId: result.actor?.id,
        itemId:  result.item?.id,
      });

      return this.formatResponse(result, { ...parsed, effectiveAbility }, warnings);
    } catch (error) {
      this.errorHandler.handleToolError(
        error,
        'dnd5e-add-attack-feature',
        'attack feature creation',
      );
    }
  }

  private formatResponse(result: any, params: any, warnings: string[]): any {
    const bonusStr = params.attackBonus > 0 ? ` +${params.attackBonus} (magic)` : '';

    const damageDesc = (params.damageParts as any[])
      .map((p) => `${p.number}d${p.denomination} ${p.type}`)
      .join(' + ');

    const rangeDesc = params.attackType === 'melee'
      ? `reach ${params.reachFt ?? 5} ft.`
      : `range ${params.rangeFt}${params.longRangeFt ? `/${params.longRangeFt}` : ''} ft.`;

    const summary = `✅ Attack "${result.item.name}" added to "${result.actor.name}"`;

    const details = [
      `**Actor:** ${result.actor.name} (id: \`${result.actor.id}\`)`,
      `**Item:** ${result.item.name} (id: \`${result.item.id}\`)`,
      `**Attack:** ${params.attackType} — ${String(params.effectiveAbility).toUpperCase()} modifier${bonusStr}`,
      `**Damage:** ${damageDesc}`,
      `**Range/Reach:** ${rangeDesc}`,
      `**Weapon class:** ${params.weaponClass}`,
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
