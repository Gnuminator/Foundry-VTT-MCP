import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

interface EffectsToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

/**
 * 3D: Condition / status effect management (read + clear).
 */
export class EffectsTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor(options: EffectsToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger.child({ component: 'EffectsTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'get-active-effects',
        description:
          'List all active effects on an actor: name and icon, whether each is a condition (Blinded, Poisoned, etc.) vs a buff/debuff (Mage Armor, Haste, etc.), remaining duration (rounds/turns/seconds) where tracked, which attributes it modifies and by how much, and whether it requires concentration.',
        inputSchema: {
          type: 'object',
          properties: {
            identifier: { type: 'string', description: 'Actor name or ID.' },
          },
          required: ['identifier'],
        },
      },
      {
        name: 'clear-stale-conditions',
        description:
          'Remove expired or explicitly-listed conditions from an actor. With no conditionNames, removes only conditions whose tracked duration has expired. With conditionNames, removes those specific conditions regardless of duration. Primary use: clearing leftover combat conditions (Prone, Petrified, etc.) after a fight.',
        inputSchema: {
          type: 'object',
          properties: {
            identifier: { type: 'string', description: 'Actor name or ID.' },
            conditionNames: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional list of specific condition names/statuses to remove.',
            },
          },
          required: ['identifier'],
        },
      },
    ];
  }

  async handleGetActiveEffects(args: any) {
    const schema = z.object({ identifier: z.string() });
    try {
      const params = schema.parse(args ?? {});
      const response = await this.foundryClient.query(
        'foundry-mcp-bridge.getActiveEffects',
        params
      );
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to get active effects');
      }
      return response;
    } catch (error) {
      this.logger.error('Error getting active effects', error);
      throw error;
    }
  }

  async handleClearStaleConditions(args: any) {
    const schema = z.object({
      identifier: z.string(),
      conditionNames: z.array(z.string()).optional(),
    });
    try {
      const params = schema.parse(args ?? {});
      const response = await this.foundryClient.query(
        'foundry-mcp-bridge.clearStaleConditions',
        params
      );
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to clear stale conditions');
      }
      return response;
    } catch (error) {
      this.logger.error('Error clearing stale conditions', error);
      throw error;
    }
  }
}
