import { z } from 'zod';
import { FoundryClient } from '../../foundry-client.js';
import { Logger } from '../../logger.js';
import { ErrorHandler } from '../../utils/error-handler.js';
import { detectGameSystem, getCachedSystemId } from '../../utils/system-detection.js';

export interface DnD5eFeatureToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

export class DnD5eFeatureTools {
  private foundryClient: FoundryClient;
  private logger: Logger;
  private errorHandler: ErrorHandler;

  constructor({ foundryClient, logger }: DnD5eFeatureToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'DnD5eFeatureTools' });
    this.errorHandler = new ErrorHandler(this.logger);
  }

  getToolDefinitions() {
    return [
      {
        name: 'dnd5e-add-feature-with-save',
        description:
          '[D&D 5e only] Add a saving-throw feature to an existing actor (NPC or character). ' +
          'Creates a "feat" item with a save Activity: specify the save ability (e.g. "dex"), ' +
          'a flat DC, one or more damage components (e.g. 4d8 psychic), whether targets take ' +
          'half damage on a save, and an optional area template (cone, sphere, etc.). ' +
          'Use list-characters or get-character first to find the actorIdentifier. ' +
          'Will error if a feature with the same name already exists on the actor.',
        inputSchema: {
          type: 'object',
          properties: {
            actorIdentifier: {
              type: 'string',
              description: 'Name or ID of the target actor (partial name match supported)',
            },
            featureName: {
              type: 'string',
              description: 'Name for the new feature — must be unique on the actor',
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
            saveAbility: {
              type: 'string',
              enum: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
              description: 'Ability used for the saving throw',
            },
            saveDC: {
              type: 'number',
              description: 'Saving throw DC (1–30)',
              minimum: 1,
              maximum: 30,
            },
            damageParts: {
              type: 'array',
              description: 'One or more damage components',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  number: {
                    type: 'number',
                    description: 'Number of dice (e.g. 4)',
                    minimum: 1,
                  },
                  denomination: {
                    type: 'number',
                    description: 'Die size: 4, 6, 8, 10, 12, 20, or 100',
                    enum: [4, 6, 8, 10, 12, 20, 100],
                  },
                  type: {
                    type: 'string',
                    description: 'Damage type (e.g. "psychic", "fire", "cold")',
                  },
                },
                required: ['number', 'denomination', 'type'],
              },
            },
            halfOnSave: {
              type: 'boolean',
              description: 'Whether the target takes half damage on a successful save',
              default: true,
            },
            areaType: {
              type: 'string',
              enum: ['cone', 'cube', 'cylinder', 'emanation', 'line', 'radius', 'sphere', ''],
              description: 'Area-of-effect template shape; omit or use "" for no template',
              default: '',
            },
            areaSize: {
              type: 'number',
              description: 'Template size in areaUnits. Required when areaType is set.',
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
              description: 'What the area targets',
              default: 'creature',
            },
          },
          required: ['actorIdentifier', 'featureName', 'saveAbility', 'saveDC', 'damageParts'],
        },
      },
    ];
  }

  async handleAddFeatureWithSave(args: any): Promise<any> {
    const schema = z
      .object({
        actorIdentifier: z.string().min(1, 'actorIdentifier cannot be empty'),
        featureName:     z.string().min(1, 'featureName cannot be empty'),
        description:     z.string().default(''),
        activationType:  z
          .enum(['action', 'bonus', 'reaction', 'legendary', 'lair', 'special'])
          .default('action'),
        saveAbility: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']),
        saveDC:      z.number().int().min(1).max(30),
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
        halfOnSave:  z.boolean().default(true),
        areaType:    z.enum(['cone', 'cube', 'cylinder', 'emanation', 'line', 'radius', 'sphere', '']).default(''),
        areaSize:    z.number().positive().optional(),
        areaUnits:   z.enum(['ft', 'm']).default('ft'),
        affectsType: z.enum(['creature', 'object', 'space', '']).default('creature'),
      })
      .superRefine((data, ctx) => {
        if (data.areaType !== '' && data.areaSize === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['areaSize'],
            message: `areaSize is required when areaType is "${data.areaType}"`,
          });
        }
      });

    const parsed = schema.parse(args);

    this.logger.info('Adding save feature to D&D 5e actor', {
      actorIdentifier: parsed.actorIdentifier,
      featureName:     parsed.featureName,
      saveAbility:     parsed.saveAbility,
      saveDC:          parsed.saveDC,
      damageParts:     parsed.damageParts,
      areaType:        parsed.areaType || 'none',
    });

    try {
      const system = await detectGameSystem(this.foundryClient, this.logger);
      if (system !== 'dnd5e') {
        throw new Error(
          `dnd5e-add-feature-with-save requires D&D 5e. ` +
          `Detected system: "${getCachedSystemId() ?? 'unknown'}".`,
        );
      }

      const result = await this.foundryClient.query(
        'foundry-mcp-bridge.addSaveFeatureToActor',
        parsed,
      );

      this.logger.info('Save feature added successfully', {
        actorId: result.actor?.id,
        itemId:  result.item?.id,
      });

      return this.formatResponse(result, parsed);
    } catch (error) {
      this.errorHandler.handleToolError(
        error,
        'dnd5e-add-feature-with-save',
        'feature creation',
      );
    }
  }

  private formatResponse(result: any, params: any): any {
    const damageDesc = (params.damageParts as any[])
      .map((p) => `${p.number}d${p.denomination} ${p.type}`)
      .join(' + ');

    const areaDesc = params.areaType
      ? `, ${params.areaSize}${params.areaUnits} ${params.areaType}`
      : '';

    const saveDesc   = `DC ${params.saveDC} ${String(params.saveAbility).toUpperCase()} save`;
    const onSaveDesc = params.halfOnSave ? 'half damage on save' : 'no damage on save';

    const summary = `✅ Feature "${result.item.name}" added to "${result.actor.name}"`;

    const details = [
      `**Actor:** ${result.actor.name} (id: \`${result.actor.id}\`)`,
      `**Feature:** ${result.item.name} (id: \`${result.item.id}\`)`,
      `**Save:** ${saveDesc} — ${onSaveDesc}`,
      `**Damage:** ${damageDesc}${areaDesc}`,
      `**Activation:** ${params.activationType}`,
    ].join('\n');

    return {
      summary,
      success: true,
      item:    result.item,
      actor:   result.actor,
      message: `${summary}\n\n${details}`,
    };
  }
}
