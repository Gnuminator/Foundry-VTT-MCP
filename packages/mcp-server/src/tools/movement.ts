import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

interface MovementToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

/**
 * 3F: Movement and token positioning.
 */
export class MovementTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor(options: MovementToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger.child({ component: 'MovementTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'get-token-positions',
        description:
          'List all tokens on a scene with their positions and status. For each token: name, actor ID, token ID, grid coordinates (x/y and grid cell), elevation, category (player character / npc / enemy), visibility (hidden or visible), current HP, and conditions. Defaults to the active scene.',
        inputSchema: {
          type: 'object',
          properties: {
            sceneId: {
              type: 'string',
              description: 'Optional scene ID; defaults to the active scene.',
            },
          },
        },
      },
      {
        name: 'measure-distance',
        description:
          "Measure the distance in the scene's grid units (e.g. feet) between two tokens on the active scene, using the scene's grid configuration.",
        inputSchema: {
          type: 'object',
          properties: {
            fromTokenName: { type: 'string', description: 'Name of the first token.' },
            toTokenName: { type: 'string', description: 'Name of the second token.' },
          },
          required: ['fromTokenName', 'toTokenName'],
        },
      },
      {
        name: 'get-targets',
        description:
          "Return the tokens the GM currently has targeted in Foundry, with each target's AC and HP. Useful before use-npc-activity so an attack can resolve hit/miss against the actual target's AC.",
        inputSchema: { type: 'object', properties: {} },
      },
    ];
  }

  async handleGetTargets(_args: any) {
    try {
      const response = await this.foundryClient.query('foundry-mcp-bridge.getTargets', {});
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to get targets');
      }
      return response;
    } catch (error) {
      this.logger.error('Error getting targets', error);
      throw error;
    }
  }

  async handleGetTokenPositions(args: any) {
    const schema = z.object({ sceneId: z.string().optional() });
    try {
      const params = schema.parse(args ?? {});
      const response = await this.foundryClient.query(
        'foundry-mcp-bridge.getTokenPositions',
        params
      );
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to get token positions');
      }
      return response;
    } catch (error) {
      this.logger.error('Error getting token positions', error);
      throw error;
    }
  }

  async handleMeasureDistance(args: any) {
    const schema = z.object({
      fromTokenName: z.string(),
      toTokenName: z.string(),
    });
    try {
      const params = schema.parse(args ?? {});
      const response = await this.foundryClient.query('foundry-mcp-bridge.measureDistance', params);
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to measure distance');
      }
      return response;
    } catch (error) {
      this.logger.error('Error measuring distance', error);
      if (error instanceof z.ZodError) {
        return `Parameter error: ${error.errors.map(e => e.message).join(', ')}`;
      }
      throw error;
    }
  }
}
