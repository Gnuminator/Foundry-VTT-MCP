import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

interface ResourceToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

/**
 * 3C: Limited-use resource tracking — spell slots, class resources (Sorcery
 * Points, Ki, Rages, etc.), item charges, concentration, hit dice, death saves.
 */
export class ResourceTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor(options: ResourceToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger.child({ component: 'ResourceTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'get-character-resources',
        description:
          "Get a clean, structured view of a character's limited-use resources: spell slots per level (max/current/expended), class resources (Sorcery Points, Ki, Rages, Bardic Inspiration, Channel Divinity, Superiority Dice, etc.), item charges, current concentration (and on which spell), hit dice, and death save successes/failures when at 0 HP.",
        inputSchema: {
          type: 'object',
          properties: {
            identifier: {
              type: 'string',
              description: 'Character name or actor ID.',
            },
          },
          required: ['identifier'],
        },
      },
      {
        name: 'update-character-resource',
        description:
          'Update a specific limited-use resource on a character (e.g. mark a spell slot as used, reduce Sorcery Points after spending them, decrement item charges). The new value is validated to be within 0 and the resource maximum. resourceName accepts a spell level (e.g. "spell3" or "level 3"), "pact", a class resource label/key (e.g. "Ki Points", "primary"), or an item name.',
        inputSchema: {
          type: 'object',
          properties: {
            identifier: { type: 'string', description: 'Character name or actor ID.' },
            resourceName: {
              type: 'string',
              description:
                'Resource to update: spell level ("spell3"/"level 3"), "pact", class resource label/key, or item name.',
            },
            newValue: {
              type: 'integer',
              description: 'New current value for the resource (0..max).',
            },
          },
          required: ['identifier', 'resourceName', 'newValue'],
        },
      },
    ];
  }

  async handleGetCharacterResources(args: any) {
    const schema = z.object({ identifier: z.string() });
    try {
      const params = schema.parse(args ?? {});
      const response = await this.foundryClient.query(
        'foundry-mcp-bridge.getCharacterResources',
        params
      );
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to get character resources');
      }
      return response;
    } catch (error) {
      this.logger.error('Error getting character resources', error);
      throw error;
    }
  }

  async handleUpdateCharacterResource(args: any) {
    const schema = z.object({
      identifier: z.string(),
      resourceName: z.string(),
      newValue: z.number().int().min(0),
    });
    try {
      const params = schema.parse(args ?? {});
      const response = await this.foundryClient.query(
        'foundry-mcp-bridge.updateCharacterResource',
        params
      );
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to update character resource');
      }
      return response;
    } catch (error) {
      this.logger.error('Error updating character resource', error);
      if (error instanceof z.ZodError) {
        return `Parameter error: ${error.errors.map(e => e.message).join(', ')}`;
      }
      throw error;
    }
  }
}
