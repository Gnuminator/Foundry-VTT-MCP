import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

interface CombatToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

/**
 * 3E: Initiative and turn tracker (read + manage).
 */
export class CombatTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor(options: CombatToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger.child({ component: 'CombatTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'get-combat-state',
        description:
          'Get the full current combat state: whether combat is active, the round number, whose turn it is (with their initiative, HP, and conditions), and the complete initiative order. For each combatant: name, initiative, current/max HP, conditions, whether they are a player character or NPC/enemy, and whether they have acted this round. Combatants at 0 HP include their death save status.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'advance-combat-turn',
        description:
          "Advance combat to the next combatant's turn. Optionally jump directly to a specific combatant with skipTo (their name or actor ID).",
        inputSchema: {
          type: 'object',
          properties: {
            skipTo: {
              type: 'string',
              description: 'Optional combatant name or actor ID to jump to.',
            },
          },
        },
      },
      {
        name: 'set-initiative',
        description: "Set or override a combatant's initiative value in the active combat.",
        inputSchema: {
          type: 'object',
          properties: {
            combatantName: { type: 'string', description: 'Combatant or actor name.' },
            initiative: { type: 'number', description: 'New initiative value.' },
          },
          required: ['combatantName', 'initiative'],
        },
      },
    ];
  }

  async handleGetCombatState(_args: any) {
    try {
      const response = await this.foundryClient.query('foundry-mcp-bridge.getCombatState', {});
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to get combat state');
      }
      return response;
    } catch (error) {
      this.logger.error('Error getting combat state', error);
      throw error;
    }
  }

  async handleAdvanceCombatTurn(args: any) {
    const schema = z.object({ skipTo: z.string().optional() });
    try {
      const params = schema.parse(args ?? {});
      const response = await this.foundryClient.query(
        'foundry-mcp-bridge.advanceCombatTurn',
        params
      );
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to advance combat turn');
      }
      return response;
    } catch (error) {
      this.logger.error('Error advancing combat turn', error);
      throw error;
    }
  }

  async handleSetInitiative(args: any) {
    const schema = z.object({
      combatantName: z.string(),
      initiative: z.number(),
    });
    try {
      const params = schema.parse(args ?? {});
      const response = await this.foundryClient.query('foundry-mcp-bridge.setInitiative', params);
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to set initiative');
      }
      return response;
    } catch (error) {
      this.logger.error('Error setting initiative', error);
      if (error instanceof z.ZodError) {
        return `Parameter error: ${error.errors.map(e => e.message).join(', ')}`;
      }
      throw error;
    }
  }
}
