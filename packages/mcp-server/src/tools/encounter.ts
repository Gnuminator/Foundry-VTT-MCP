import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

interface EncounterToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

/**
 * Encounter tooling: XP-budget encounter planning and AoE template placement.
 */
export class EncounterTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor(options: EncounterToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger.child({ component: 'EncounterTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'suggest-balanced-encounter',
        description:
          "Compute the party's XP budget for an encounter difficulty and suggest creature CRs to fill it (uses dnd5e's 2024 encounter math when available, else the 2014 DMG thresholds). Returns the budget and CR suggestions; follow up with list-creatures-by-criteria / search-compendium to pick actual creatures. D&D 5e only.",
        inputSchema: {
          type: 'object',
          properties: {
            partyLevels: {
              type: 'array',
              items: { type: 'integer' },
              description: 'Character levels. If omitted, derived from the player characters.',
            },
            difficulty: {
              type: 'string',
              enum: ['low', 'moderate', 'high'],
              description: 'Encounter difficulty (default "moderate").',
            },
          },
        },
      },
      {
        name: 'place-measured-template',
        description:
          'Place an area-of-effect measured template (circle/cone/ray/rect) on the active scene and report which tokens it covers. Origin is x/y pixels or the center of a named token. Use for "drop a 20-ft fireball on the orcs".',
        inputSchema: {
          type: 'object',
          properties: {
            shape: { type: 'string', enum: ['circle', 'cone', 'ray', 'rect'] },
            distance: {
              type: 'number',
              description: 'Size in grid distance units (radius for circle, length for cone/ray).',
            },
            x: { type: 'number', description: 'Origin X in pixels (or use originTokenName).' },
            y: { type: 'number', description: 'Origin Y in pixels (or use originTokenName).' },
            originTokenName: {
              type: 'string',
              description: 'Center the template on this token instead of x/y.',
            },
            direction: { type: 'number', description: 'Facing in degrees (cone/ray/rect).' },
            angle: { type: 'number', description: 'Cone angle in degrees (default ~53).' },
            width: { type: 'number', description: 'Ray width in grid units (default 5).' },
            fillColor: { type: 'string', description: 'Hex color, e.g. "#ff0000".' },
          },
          required: ['shape', 'distance'],
        },
      },
      {
        name: 'delete-measured-template',
        description:
          'Remove a measured template from the active scene by templateId (from place-measured-template), or clear all templates with all=true. Use to clean up an AoE after resolving it.',
        inputSchema: {
          type: 'object',
          properties: {
            templateId: { type: 'string', description: 'Template ID to delete.' },
            all: { type: 'boolean', description: 'Delete all templates on the scene.' },
          },
        },
      },
    ];
  }

  async handleSuggestBalancedEncounter(args: any) {
    const schema = z.object({
      partyLevels: z.array(z.number().int()).optional(),
      difficulty: z.enum(['low', 'moderate', 'high']).optional(),
    });
    try {
      const params = schema.parse(args ?? {});
      const response = await this.foundryClient.query(
        'foundry-mcp-bridge.suggestBalancedEncounter',
        params
      );
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to suggest encounter');
      }
      return response;
    } catch (error) {
      this.logger.error('Error suggesting encounter', error);
      throw error;
    }
  }

  async handlePlaceMeasuredTemplate(args: any) {
    const schema = z.object({
      shape: z.enum(['circle', 'cone', 'ray', 'rect']),
      distance: z.number(),
      x: z.number().optional(),
      y: z.number().optional(),
      originTokenName: z.string().optional(),
      direction: z.number().optional(),
      angle: z.number().optional(),
      width: z.number().optional(),
      fillColor: z.string().optional(),
    });
    try {
      const params = schema.parse(args);
      const response = await this.foundryClient.query(
        'foundry-mcp-bridge.placeMeasuredTemplate',
        params
      );
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to place template');
      }
      return response;
    } catch (error) {
      this.logger.error('Error placing template', error);
      if (error instanceof z.ZodError) {
        return `Parameter error: ${error.errors.map(e => e.message).join(', ')}`;
      }
      throw error;
    }
  }

  async handleDeleteMeasuredTemplate(args: any) {
    const schema = z.object({
      templateId: z.string().optional(),
      all: z.boolean().optional(),
    });
    try {
      const params = schema.parse(args ?? {});
      const response = await this.foundryClient.query(
        'foundry-mcp-bridge.deleteMeasuredTemplate',
        params
      );
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to delete template');
      }
      return response;
    } catch (error) {
      this.logger.error('Error deleting template', error);
      throw error;
    }
  }
}
