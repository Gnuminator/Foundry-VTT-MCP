import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

interface SessionLogToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

/**
 * 3H: Session event log — the "memory" layer. Returns a structured log of
 * significant events accumulated by the Foundry module for the current browser
 * session (combat start/end, HP changes, deaths/stabilizations, conditions,
 * resource spend, scene changes, journal create/update).
 */
export class SessionLogTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor(options: SessionLogToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger.child({ component: 'SessionLogTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'get-session-log',
        description:
          'Return the structured event log for the current session: combat start/end, HP changes (damage/healing), deaths and stabilizations, conditions applied/removed, resources expended, scene changes, and journal entries created/updated. Use this as a session memory layer to recap what has happened.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'integer',
              description: 'Maximum number of events to return (default 100).',
              default: 100,
            },
            eventType: {
              type: 'string',
              description:
                'Optional event type filter (e.g. "combat-start", "combat-end", "damage", "healing", "death", "stabilize", "condition-applied", "condition-removed", "resource-spent", "scene-change", "journal-created", "journal-updated").',
            },
            actorName: {
              type: 'string',
              description: 'Optional actor name filter (partial match).',
            },
          },
        },
      },
    ];
  }

  async handleGetSessionLog(args: any) {
    const schema = z.object({
      limit: z.number().int().min(1).max(1000).optional(),
      eventType: z.string().optional(),
      actorName: z.string().optional(),
    });
    try {
      const params = schema.parse(args ?? {});
      const response = await this.foundryClient.query('foundry-mcp-bridge.getSessionLog', params);
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to get session log');
      }
      return response;
    } catch (error) {
      this.logger.error('Error getting session log', error);
      throw error;
    }
  }
}
