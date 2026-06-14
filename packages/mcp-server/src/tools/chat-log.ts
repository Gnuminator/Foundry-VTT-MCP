import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

interface ChatLogToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

/**
 * 3A: Chat log / combat play-by-play / in-character chat tools.
 *
 * The chat-log buffer itself lives in the Foundry module (browser memory); these
 * tools request it on demand over the existing WebRTC/WebSocket query channel.
 */
export class ChatLogTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor(options: ChatLogToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger.child({ component: 'ChatLogTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'get-chat-log',
        description:
          "Retrieve recent Foundry chat messages from the module's in-memory buffer. This is where dice rolls, ability uses, damage events, and combat narration live. Each message includes the speaker, message type, content, flavor text, and—for rolls—the formula, total, individual die results, critical/fumble status, advantage/disadvantage, and any damage total and types. Use this to follow what happened in the game.",
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'integer',
              description: 'Maximum number of messages to return (default 50, max 200).',
              default: 50,
            },
            speakerName: {
              type: 'string',
              description: 'Filter to messages from this actor/speaker name (partial match).',
            },
            messageType: {
              type: 'string',
              description: 'Filter by message type.',
              enum: ['roll', 'damage', 'all'],
              default: 'all',
            },
            sinceTimestamp: {
              type: 'string',
              description: 'ISO timestamp; only return messages created after this time.',
            },
          },
        },
      },
      {
        name: 'get-combat-play-by-play',
        description:
          'Return a structured, human-readable summary of the current or most recent combat encounter, reconstructed from the chat-log buffer and the recorded turn timeline. Includes each round broken into turns (who acted and what they did with roll/damage results), significant events (downed/dead/stabilized combatants, conditions applied/removed), and a final summary with total rounds and total damage dealt by each actor.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'send-chat-message',
        description:
          'Post a message to the Foundry chat as a specific character or as the GM/world. Supports in-character (ic), out-of-character (ooc), emote, and whisper message types.',
        inputSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'The message text to post.',
            },
            speakerActorId: {
              type: 'string',
              description:
                'Actor ID to post as. If omitted (and no name given), posts as the GM/world.',
            },
            speakerActorName: {
              type: 'string',
              description: 'Actor name to post as (alternative to speakerActorId).',
            },
            messageType: {
              type: 'string',
              description: 'Type of message.',
              enum: ['ic', 'ooc', 'emote', 'whisper'],
              default: 'ic',
            },
            whisperTargets: {
              type: 'array',
              items: { type: 'string' },
              description: 'When messageType is "whisper", the user names to whisper to.',
            },
          },
          required: ['message'],
        },
      },
    ];
  }

  async handleGetChatLog(args: any) {
    const schema = z.object({
      limit: z.number().int().min(1).max(200).optional(),
      speakerName: z.string().optional(),
      messageType: z.enum(['roll', 'damage', 'all']).optional(),
      sinceTimestamp: z.string().optional(),
    });
    try {
      const params = schema.parse(args ?? {});
      const response = await this.foundryClient.query('foundry-mcp-bridge.getChatLog', params);
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to get chat log');
      }
      return response;
    } catch (error) {
      this.logger.error('Error getting chat log', error);
      throw error;
    }
  }

  async handleGetCombatPlayByPlay(_args: any) {
    try {
      const response = await this.foundryClient.query('foundry-mcp-bridge.getCombatPlayByPlay', {});
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to get combat play-by-play');
      }
      return response;
    } catch (error) {
      this.logger.error('Error getting combat play-by-play', error);
      throw error;
    }
  }

  async handleSendChatMessage(args: any) {
    const schema = z.object({
      message: z.string().min(1),
      speakerActorId: z.string().optional(),
      speakerActorName: z.string().optional(),
      messageType: z.enum(['ic', 'ooc', 'emote', 'whisper']).optional(),
      whisperTargets: z.array(z.string()).optional(),
    });
    try {
      const params = schema.parse(args ?? {});
      const response = await this.foundryClient.query('foundry-mcp-bridge.sendChatMessage', params);
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to send chat message');
      }
      return response;
    } catch (error) {
      this.logger.error('Error sending chat message', error);
      if (error instanceof z.ZodError) {
        return `Parameter error: ${error.errors.map(e => e.message).join(', ')}`;
      }
      throw error;
    }
  }
}
