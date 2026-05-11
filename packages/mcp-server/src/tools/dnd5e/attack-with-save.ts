import { z } from 'zod';
import { FoundryClient } from '../../foundry-client.js';
import { Logger } from '../../logger.js';
import { ErrorHandler } from '../../utils/error-handler.js';
import { detectGameSystem, getCachedSystemId } from '../../utils/system-detection.js';

// ---------------------------------------------------------------------------
// Canonical damage types — soft validation (warning, not error)
// ---------------------------------------------------------------------------

const ATTACK_SAVE_DAMAGE_CANONICAL = new Set([
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning',
  'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
]);

// ---------------------------------------------------------------------------
// Options interface
// ---------------------------------------------------------------------------

export interface DnD5eAttackWithSaveToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

// ---------------------------------------------------------------------------
// Tool class
// ---------------------------------------------------------------------------

export class DnD5eAttackWithSaveTools {
  private foundryClient: FoundryClient;
  private logger: Logger;
  private errorHandler: ErrorHandler;

  constructor({ foundryClient, logger }: DnD5eAttackWithSaveToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'DnD5eAttackWithSaveTools' });
    this.errorHandler = new ErrorHandler(this.logger);
  }

  getToolDefinitions() {
    return [
      {
        name: 'dnd5e-add-attack-with-save',
        description:
          '[D&D 5e only] Add a weapon attack that also triggers a saving throw on a hit. ' +
          'Creates a weapon item with TWO activities: (1) an attack roll (to-hit), and ' +
          '(2) a save effect that applies to the hit target, dealing separate damage.\n\n' +
          'USE THIS TOOL for attacks like:\n' +
          '  - Wyvern Stinger: piercing damage on hit + CON save or take poison damage\n' +
          '  - Bite: piercing damage on hit + CON save or take extra necrotic damage\n' +
          '  - Psychic Claws: slashing on hit + INT save or take additional psychic damage\n' +
          '  - Any attack described as "Hit: X damage. The target must make a DC Y save ' +
          'or take Z damage"\n\n' +
          'DO NOT USE THIS TOOL for:\n' +
          '  - Attack with no save → use dnd5e-add-attack-feature instead\n' +
          '  - Save effect with no attack roll → use dnd5e-add-feature-with-save instead\n' +
          '  - Automatic-damage auras (no to-hit required) → use dnd5e-add-aura-feature instead\n' +
          '  - Passive traits and Multiattack → use dnd5e-add-passive-feature instead\n' +
          '  - Status conditions on failed save (paralyzed, frightened) → not supported in V1;\n' +
          '    create the attack with this tool and apply conditions manually at the table\n\n' +
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
                'Name for the new attack item — must be unique on the actor ' +
                '(e.g. "Stinger", "Venomous Bite", "Psychic Claws")',
            },
            description: {
              type: 'string',
              description: 'HTML description of the attack (optional)',
              default: '',
            },
            activationType: {
              type: 'string',
              enum: ['action', 'bonus', 'reaction', 'legendary', 'lair', 'special'],
              description: 'Action economy type — applies to both the attack and the save activity',
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
              description: 'Weapon category. Use "natural" for monster natural attacks.',
              default: 'natural',
            },
            abilityModifier: {
              type: 'string',
              enum: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
              description:
                'Ability used for to-hit and attack damage. ' +
                'Omit to use the default: STR for melee, DEX for ranged.',
            },
            attackBonus: {
              type: 'number',
              description: 'Magic bonus added to both to-hit and damage (e.g. 1 for a +1 weapon).',
              minimum: 0,
              maximum: 10,
              default: 0,
            },
            proficient: {
              type: 'boolean',
              description: 'Whether the actor is proficient with this weapon.',
              default: true,
            },
            equipped: {
              type: 'boolean',
              description: 'Whether the weapon is equipped.',
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
                'Long range in feet. Must be greater than rangeFt. ' +
                'Only relevant when attackType is "ranged".',
              minimum: 1,
            },
            damageParts: {
              type: 'array',
              description:
                'Damage components for the attack roll (on hit). ' +
                'First entry is the base weapon damage; additional entries are extra on-hit damage.',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  number:      { type: 'number', description: 'Number of dice', minimum: 1 },
                  denomination: {
                    type: 'number',
                    description: 'Die size: 4, 6, 8, 10, 12, 20, or 100',
                    enum: [4, 6, 8, 10, 12, 20, 100],
                  },
                  type: { type: 'string', description: 'Damage type (e.g. "piercing", "slashing")' },
                },
                required: ['number', 'denomination', 'type'],
              },
            },
            properties: {
              type: 'array',
              description: 'Weapon property codes (e.g. ["fin", "lgt"]).',
              items: { type: 'string' },
              default: [],
            },
            // ── Save parameters ──────────────────────────────────────────────
            saveAbility: {
              type: 'string',
              enum: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
              description: 'Ability used for the saving throw triggered on a hit.',
            },
            saveDC: {
              type: 'number',
              description: 'DC for the saving throw (1–30).',
              minimum: 1,
              maximum: 30,
            },
            saveDamageParts: {
              type: 'array',
              description:
                'Damage dealt by the save effect (independent of the attack damage). ' +
                'All parts apply; the target takes this damage on a failed save ' +
                '(or half if saveOnSave is "half").',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  number:      { type: 'number', description: 'Number of dice', minimum: 1 },
                  denomination: {
                    type: 'number',
                    description: 'Die size: 4, 6, 8, 10, 12, 20, or 100',
                    enum: [4, 6, 8, 10, 12, 20, 100],
                  },
                  type: { type: 'string', description: 'Damage type (e.g. "poison", "psychic")' },
                },
                required: ['number', 'denomination', 'type'],
              },
            },
            saveOnSave: {
              type: 'string',
              enum: ['half', 'none'],
              description:
                '"none" — no damage on a successful save (default). ' +
                '"half" — half the save damage on a successful save.',
              default: 'none',
            },
            // ── Source ───────────────────────────────────────────────────────
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
          required: [
            'actorIdentifier', 'featureName', 'attackType', 'damageParts',
            'saveAbility', 'saveDC', 'saveDamageParts',
          ],
        },
      },
    ];
  }

  async handleAddAttackWithSave(args: any): Promise<any> {
    const damagePart = z.object({
      number:       z.number().int().min(1),
      denomination: z.number().int().refine((d) => [4, 6, 8, 10, 12, 20, 100].includes(d), {
        message: 'denomination must be one of 4, 6, 8, 10, 12, 20, 100',
      }),
      type: z.string().min(1, 'damage type cannot be empty'),
    });

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
        damageParts:     z.array(damagePart).min(1, 'at least one damage part is required'),
        properties:      z.array(z.string()).default([]),
        saveAbility:     z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']),
        saveDC:          z.number().int().min(1).max(30),
        saveDamageParts: z.array(damagePart).min(1, 'at least one save damage part is required'),
        saveOnSave:      z.enum(['half', 'none']).default('none'),
        sourceRules:     z.enum(['2014', '2024']).default('2014'),
        sourceBook:      z.string().default(''),
        sourcePage:      z.string().default(''),
      })
      .superRefine((data, ctx) => {
        if (data.attackType === 'ranged' && data.rangeFt === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom, path: ['rangeFt'],
            message: 'rangeFt is required when attackType is "ranged"',
          });
        }
        if (
          data.longRangeFt !== undefined &&
          data.rangeFt    !== undefined &&
          data.longRangeFt <= data.rangeFt
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom, path: ['longRangeFt'],
            message: `longRangeFt (${data.longRangeFt}) must be greater than rangeFt (${data.rangeFt})`,
          });
        }
      });

    const parsed = schema.parse(args);

    // Resolve effective ability modifier — default by attackType
    const effectiveAbility: string =
      parsed.abilityModifier ?? (parsed.attackType === 'melee' ? 'str' : 'dex');

    // -----------------------------------------------------------------------
    // Soft validation — both damage groups
    // -----------------------------------------------------------------------
    const warnings: string[] = [];

    for (const part of [...parsed.damageParts, ...parsed.saveDamageParts]) {
      if (!ATTACK_SAVE_DAMAGE_CANONICAL.has(part.type)) {
        const msg = `Unknown damage type "${part.type}" — verify it matches dnd5e system values`;
        if (!warnings.includes(msg)) warnings.push(msg);
        this.logger.warn(msg, { value: part.type });
      }
    }

    this.logger.info('Adding attack+save feature to D&D 5e actor', {
      actorIdentifier: parsed.actorIdentifier,
      featureName:     parsed.featureName,
      attackType:      parsed.attackType,
      saveAbility:     parsed.saveAbility,
      saveDC:          parsed.saveDC,
      warnings:        warnings.length,
    });

    try {
      const system = await detectGameSystem(this.foundryClient, this.logger);
      if (system !== 'dnd5e') {
        throw new Error(
          `dnd5e-add-attack-with-save requires D&D 5e. ` +
          `Detected system: "${getCachedSystemId() ?? 'unknown'}".`,
        );
      }

      const result = await this.foundryClient.query(
        'foundry-mcp-bridge.addAttackWithSaveToActor',
        { ...parsed, effectiveAbility },
      );

      this.logger.info('Attack+save feature added successfully', {
        actorId: result.actor?.id,
        itemId:  result.item?.id,
      });

      return this.formatResponse(result, { ...parsed, effectiveAbility }, warnings);
    } catch (error) {
      this.errorHandler.handleToolError(
        error,
        'dnd5e-add-attack-with-save',
        'attack+save feature creation',
      );
    }
  }

  private formatResponse(result: any, params: any, warnings: string[]): any {
    const bonusStr = params.attackBonus > 0 ? ` +${params.attackBonus} (magic)` : '';

    const attackDamageDesc = (params.damageParts as any[])
      .map((p) => `${p.number}d${p.denomination} ${p.type}`)
      .join(' + ');

    const saveDamageDesc = (params.saveDamageParts as any[])
      .map((p) => `${p.number}d${p.denomination} ${p.type}`)
      .join(' + ');

    const rangeDesc = params.attackType === 'melee'
      ? `reach ${params.reachFt ?? 5} ft.`
      : `range ${params.rangeFt}${params.longRangeFt ? `/${params.longRangeFt}` : ''} ft.`;

    const summary = `✅ Attack+Save "${result.item.name}" added to "${result.actor.name}"`;

    const details = [
      `**Actor:** ${result.actor.name} (id: \`${result.actor.id}\`)`,
      `**Item:** ${result.item.name} (id: \`${result.item.id}\`)`,
      `**Attack:** ${params.attackType} — ${String(params.effectiveAbility).toUpperCase()} modifier${bonusStr}, ${rangeDesc}`,
      `**Attack damage:** ${attackDamageDesc}`,
      `**Save:** DC ${params.saveDC} ${String(params.saveAbility).toUpperCase()} — ${saveDamageDesc} (${params.saveOnSave === 'half' ? 'half on save' : 'no damage on save'})`,
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
