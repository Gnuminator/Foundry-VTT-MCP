import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

interface LootToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

/**
 * Loot / treasure awards.
 */
export class LootTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor(options: LootToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger.child({ component: 'LootTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'drop-loot',
        description:
          'Award loot: add currency (pp/gp/ep/sp/cp) and/or compendium items (by UUID) to a character, and/or announce the loot in chat. To find item UUIDs first, use search-compendium. D&D 5e currency.',
        inputSchema: {
          type: 'object',
          properties: {
            targetCharacter: {
              type: 'string',
              description: 'Character name/ID to receive the loot. Omit to only announce in chat.',
            },
            currency: {
              type: 'object',
              description: 'Coins to add, e.g. { "gp": 50, "sp": 25 }.',
              properties: {
                pp: { type: 'integer' },
                gp: { type: 'integer' },
                ep: { type: 'integer' },
                sp: { type: 'integer' },
                cp: { type: 'integer' },
              },
            },
            itemUuids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Compendium item UUIDs to add (from search-compendium).',
            },
            announce: {
              type: 'boolean',
              description: 'Post a loot summary to chat (default true).',
            },
          },
        },
      },
    ];
  }

  async handleDropLoot(args: any) {
    const schema = z.object({
      targetCharacter: z.string().optional(),
      currency: z.record(z.string(), z.number()).optional(),
      itemUuids: z.array(z.string()).optional(),
      announce: z.boolean().optional(),
    });
    try {
      const params = schema.parse(args ?? {});
      const response = await this.foundryClient.query('foundry-mcp-bridge.dropLoot', params);
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to drop loot');
      }
      return response;
    } catch (error) {
      this.logger.error('Error dropping loot', error);
      if (error instanceof z.ZodError) {
        return `Parameter error: ${error.errors.map(e => e.message).join(', ')}`;
      }
      throw error;
    }
  }
}
