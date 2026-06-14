import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

interface SceneControlToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

/**
 * Scene-control tools: scene mood (lighting/playlist), map pins, token vision/light.
 */
export class SceneControlTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor(options: SceneControlToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger.child({ component: 'SceneControlTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'set-scene-mood',
        description:
          'Set the mood of the active scene: adjust darkness (0=bright … 1=dark) and/or global illumination, and optionally play or stop a playlist by name. Use to shift atmosphere as the narrative changes.',
        inputSchema: {
          type: 'object',
          properties: {
            darkness: { type: 'number', description: 'Darkness level 0..1.' },
            globalLight: { type: 'boolean', description: 'Enable/disable global illumination.' },
            playlistName: { type: 'string', description: 'Playlist to control by name.' },
            playlistAction: {
              type: 'string',
              enum: ['play', 'stop'],
              description: 'Play (default) or stop the named playlist.',
            },
          },
        },
      },
      {
        name: 'add-map-note',
        description:
          'Drop a labeled map pin (Note) on the active scene, optionally linked to a journal entry by name. Position is x/y pixels or the position of a named token.',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Label text for the pin.' },
            x: { type: 'number', description: 'X in pixels (or use tokenName).' },
            y: { type: 'number', description: 'Y in pixels (or use tokenName).' },
            tokenName: {
              type: 'string',
              description: 'Place the pin at this token instead of x/y.',
            },
            journalName: {
              type: 'string',
              description: 'Link the pin to an existing journal entry by name.',
            },
            entryId: {
              type: 'string',
              description: 'Link to a journal entry by id (alternative).',
            },
            icon: { type: 'string', description: 'Icon path (default icons/svg/book.svg).' },
            iconSize: { type: 'integer', description: 'Icon size in px (default 40).' },
          },
        },
      },
      {
        name: 'set-token-vision-light',
        description:
          "Set a token's vision and/or emitted light on the active scene — e.g. give a token a torch (dim/bright light) or toggle its sight for a blinded creature.",
        inputSchema: {
          type: 'object',
          properties: {
            tokenName: { type: 'string', description: 'Token name or ID.' },
            sightEnabled: { type: 'boolean', description: "Enable/disable the token's vision." },
            sightRange: { type: 'number', description: 'Vision range in grid units.' },
            visionMode: { type: 'string', description: 'Vision mode, e.g. "basic", "darkvision".' },
            lightDim: { type: 'number', description: 'Dim light radius in grid units.' },
            lightBright: { type: 'number', description: 'Bright light radius in grid units.' },
            lightColor: { type: 'string', description: 'Light color hex, e.g. "#ff9329".' },
            lightAnimation: {
              type: 'string',
              description: 'Light animation type, e.g. "torch", "pulse", "flame".',
            },
          },
          required: ['tokenName'],
        },
      },
      {
        name: 'delete-map-note',
        description:
          'Remove a map pin (Note) from the active scene by noteId (from add-map-note) or by exact label text. Does not delete all notes (to protect pre-existing pins).',
        inputSchema: {
          type: 'object',
          properties: {
            noteId: { type: 'string', description: 'Note ID to delete.' },
            text: {
              type: 'string',
              description: 'Delete the pin(s) whose label matches this text.',
            },
          },
        },
      },
    ];
  }

  private async run(method: string, params: any, failMsg: string) {
    const response = await this.foundryClient.query(`foundry-mcp-bridge.${method}`, params);
    if (response?.success === false) {
      throw new Error(response.error || failMsg);
    }
    return response;
  }

  async handleSetSceneMood(args: any) {
    const schema = z.object({
      darkness: z.number().min(0).max(1).optional(),
      globalLight: z.boolean().optional(),
      playlistName: z.string().optional(),
      playlistAction: z.enum(['play', 'stop']).optional(),
    });
    try {
      return await this.run('setSceneMood', schema.parse(args ?? {}), 'Failed to set scene mood');
    } catch (error) {
      this.logger.error('Error setting scene mood', error);
      if (error instanceof z.ZodError) {
        return `Parameter error: ${error.errors.map(e => e.message).join(', ')}`;
      }
      throw error;
    }
  }

  async handleAddMapNote(args: any) {
    const schema = z.object({
      text: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      tokenName: z.string().optional(),
      journalName: z.string().optional(),
      entryId: z.string().optional(),
      icon: z.string().optional(),
      iconSize: z.number().int().optional(),
    });
    try {
      return await this.run('addMapNote', schema.parse(args ?? {}), 'Failed to add map note');
    } catch (error) {
      this.logger.error('Error adding map note', error);
      throw error;
    }
  }

  async handleSetTokenVisionLight(args: any) {
    const schema = z.object({
      tokenName: z.string(),
      sightEnabled: z.boolean().optional(),
      sightRange: z.number().optional(),
      visionMode: z.string().optional(),
      lightDim: z.number().optional(),
      lightBright: z.number().optional(),
      lightColor: z.string().optional(),
      lightAnimation: z.string().optional(),
    });
    try {
      return await this.run(
        'setTokenVisionLight',
        schema.parse(args),
        'Failed to set token vision/light'
      );
    } catch (error) {
      this.logger.error('Error setting token vision/light', error);
      if (error instanceof z.ZodError) {
        return `Parameter error: ${error.errors.map(e => e.message).join(', ')}`;
      }
      throw error;
    }
  }

  async handleDeleteMapNote(args: any) {
    const schema = z.object({
      noteId: z.string().optional(),
      text: z.string().optional(),
    });
    try {
      return await this.run('deleteMapNote', schema.parse(args ?? {}), 'Failed to delete map note');
    } catch (error) {
      this.logger.error('Error deleting map note', error);
      throw error;
    }
  }
}
