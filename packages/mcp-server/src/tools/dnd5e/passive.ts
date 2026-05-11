import { z } from 'zod';
import { FoundryClient } from '../../foundry-client.js';
import { Logger } from '../../logger.js';
import { ErrorHandler } from '../../utils/error-handler.js';
import { detectGameSystem, getCachedSystemId } from '../../utils/system-detection.js';

export interface DnD5ePassiveToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

export class DnD5ePassiveTools {
  private foundryClient: FoundryClient;
  private logger: Logger;
  private errorHandler: ErrorHandler;

  constructor({ foundryClient, logger }: DnD5ePassiveToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'DnD5ePassiveTools' });
    this.errorHandler = new ErrorHandler(this.logger);
  }

  getToolDefinitions() {
    return [
      {
        name: 'dnd5e-add-passive-feature',
        description:
          '[D&D 5e only] Add a passive or descriptive feature to an existing actor ' +
          '(NPC or character). Creates a "feat" item with no mechanical activity — the feature ' +
          'describes a quality of the creature and is displayed on the sheet as flavor/rules text. ' +
          'The GM applies any effects manually.\n\n' +
          'USE THIS TOOL for:\n' +
          '  - Passive traits: "Sunlight Sensitivity", "Torment-Hardened", "Magic Resistance"\n' +
          '  - Multiattack (the single most common use): describes how many attacks the creature\n' +
          '    makes per turn — e.g. "The creature makes three Claw attacks"\n' +
          '  - Always-active qualities: "Undead Nature", "Spider Climb", "Detect Life"\n' +
          '  - Narrative triggers handled by the GM: "when reduced to 0 HP, transforms into...",\n' +
          '    "Spurred by Pain: when it takes damage, it..."\n' +
          '  - Any feature where 5e says "no roll, just describes what happens"\n' +
          '  - Features with mechanical text that the GM resolves manually at the table\n\n' +
          'DO NOT USE THIS TOOL for:\n' +
          '  - Features that allow a saving throw → use dnd5e-add-feature-with-save instead\n' +
          '  - Attacks with a to-hit roll → use dnd5e-add-attack-feature instead\n' +
          '  - Automatic-damage auras and emanations → use dnd5e-add-aura-feature instead\n' +
          '  - Automated status conditions (frightened, charmed, etc.) → not currently supported;\n' +
          '    you can still create a descriptive item here and apply conditions manually\n\n' +
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
                'Name for the new feature — must be unique on the actor ' +
                '(e.g. "Multiattack", "Magic Resistance", "Sunlight Sensitivity")',
            },
            description: {
              type: 'string',
              description:
                'HTML description of the feature. Accepts full HTML formatting. ' +
                'For Multiattack, include the exact attack sequence text.',
              default: '',
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
          required: ['actorIdentifier', 'featureName'],
        },
      },
    ];
  }

  async handleAddPassiveFeature(args: any): Promise<any> {
    const schema = z.object({
      actorIdentifier: z.string().min(1, 'actorIdentifier cannot be empty'),
      featureName:     z.string().min(1, 'featureName cannot be empty'),
      description:     z.string().default(''),
      sourceRules:     z.enum(['2014', '2024']).default('2014'),
      sourceBook:      z.string().default(''),
      sourcePage:      z.string().default(''),
    });

    const parsed = schema.parse(args);

    this.logger.info('Adding passive feature to D&D 5e actor', {
      actorIdentifier: parsed.actorIdentifier,
      featureName:     parsed.featureName,
    });

    try {
      const system = await detectGameSystem(this.foundryClient, this.logger);
      if (system !== 'dnd5e') {
        throw new Error(
          `dnd5e-add-passive-feature requires D&D 5e. ` +
          `Detected system: "${getCachedSystemId() ?? 'unknown'}".`,
        );
      }

      const result = await this.foundryClient.query(
        'foundry-mcp-bridge.addPassiveFeatureToActor',
        parsed,
      );

      this.logger.info('Passive feature added successfully', {
        actorId: result.actor?.id,
        itemId:  result.item?.id,
      });

      return this.formatResponse(result, parsed);
    } catch (error) {
      this.errorHandler.handleToolError(
        error,
        'dnd5e-add-passive-feature',
        'passive feature creation',
      );
    }
  }

  private formatResponse(result: any, params: any): any {
    const summary = `✅ Feature "${result.item.name}" added to "${result.actor.name}"`;

    const details = [
      `**Actor:** ${result.actor.name} (id: \`${result.actor.id}\`)`,
      `**Feature:** ${result.item.name} (id: \`${result.item.id}\`)`,
      `**Type:** passive / descriptive (no activity)`,
      `**Rules:** ${params.sourceRules}${params.sourceBook ? ` — ${params.sourceBook}` : ''}`,
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
