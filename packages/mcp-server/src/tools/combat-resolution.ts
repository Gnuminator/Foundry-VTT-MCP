import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

interface CombatResolutionToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

/**
 * D&D 5e combat-resolution tools: apply damage/healing, roll NPC saves/checks,
 * use an NPC attack/activity, and run rests. These let the AI co-GM actually
 * resolve a combat round rather than only observe it. dnd5e only.
 */
export class CombatResolutionTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor(options: CombatResolutionToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger.child({ component: 'CombatResolutionTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'apply-damage-and-healing',
        description:
          "Apply damage, healing, or temporary HP to one or more tokens/actors, using dnd5e's automatic resistance/vulnerability/immunity math (the target's own traits drive the reduction). Targets are token names (preferred, so unlinked NPC tokens use their own HP) or actor names/IDs. D&D 5e only.",
        inputSchema: {
          type: 'object',
          properties: {
            targets: {
              type: 'array',
              items: { type: 'string' },
              description: 'Token names (preferred) or actor names/IDs to affect.',
            },
            amount: { type: 'integer', description: 'Amount of damage/healing/temp HP (>= 0).' },
            kind: {
              type: 'string',
              enum: ['damage', 'healing', 'temp'],
              description: 'damage (default), healing, or temp (temporary HP).',
            },
            type: {
              type: 'string',
              description:
                'Damage type for resistance math (e.g. "fire", "slashing"). Omit for untyped.',
            },
            multiplier: {
              type: 'number',
              description: 'Optional multiplier (e.g. 2 for a critical hit, 0.5 for half).',
            },
            ignoreResistance: {
              type: 'boolean',
              description: "If true, ignore the target's resistances/immunities (raw damage).",
            },
          },
          required: ['targets', 'amount'],
        },
      },
      {
        name: 'roll-saving-throws',
        description:
          'Roll saving throws (or ability checks / skill checks) for one or more NPC actors using dnd5e system rules, optionally against a DC, reporting each total and pass/fail. Use for "all the goblins roll a DEX save vs DC 15". D&D 5e only.',
        inputSchema: {
          type: 'object',
          properties: {
            targets: {
              type: 'array',
              items: { type: 'string' },
              description: 'Token names (preferred) or actor names/IDs to roll for.',
            },
            rollType: { type: 'string', enum: ['save', 'check', 'skill'] },
            ability: {
              type: 'string',
              description: 'Ability key for save/check (str/dex/con/int/wis/cha).',
            },
            skill: {
              type: 'string',
              description: 'Skill key for skill rolls (e.g. "ste", "prc").',
            },
            dc: { type: 'integer', description: 'Optional difficulty class to test against.' },
            isPublic: {
              type: 'boolean',
              description: 'Public roll (true) or whispered to the GM (false, default).',
            },
          },
          required: ['targets', 'rollType'],
        },
      },
      {
        name: 'use-npc-activity',
        description:
          "Trigger an NPC's attack (or other item activity) and report the attack roll total, hit/miss vs an AC, critical, and damage. Use for running the monster side of combat. D&D 5e only.",
        inputSchema: {
          type: 'object',
          properties: {
            actorName: { type: 'string', description: 'NPC actor name or ID.' },
            itemName: {
              type: 'string',
              description: 'Name of the weapon/feature/spell to use (e.g. "Scimitar").',
            },
            targetAC: {
              type: 'integer',
              description: 'Optional target AC to compute hit/miss against.',
            },
            isPublic: { type: 'boolean', description: 'Public roll (default true behavior).' },
          },
          required: ['actorName', 'itemName'],
        },
      },
      {
        name: 'manage-rest',
        description:
          'Run a short or long rest for one or more characters — restoring HP, hit dice, spell slots, and limited-use features per 5e rules — without opening dialogs. D&D 5e only.',
        inputSchema: {
          type: 'object',
          properties: {
            targets: {
              type: 'array',
              items: { type: 'string' },
              description: 'Character names or IDs to rest.',
            },
            restType: { type: 'string', enum: ['short', 'long'] },
            newDay: {
              type: 'boolean',
              description:
                'Whether this rest starts a new day (resets daily uses). Defaults true for long rests.',
            },
          },
          required: ['targets', 'restType'],
        },
      },
    ];
  }

  private async query(method: string, params: any, failMsg: string) {
    const response = await this.foundryClient.query(`foundry-mcp-bridge.${method}`, params);
    if (response?.success === false) {
      throw new Error(response.error || failMsg);
    }
    return response;
  }

  async handleApplyDamageAndHealing(args: any) {
    const schema = z.object({
      targets: z.array(z.string()).min(1),
      amount: z.number().int().min(0),
      kind: z.enum(['damage', 'healing', 'temp']).optional(),
      type: z.string().optional(),
      multiplier: z.number().optional(),
      ignoreResistance: z.boolean().optional(),
    });
    try {
      return await this.query(
        'applyDamageAndHealing',
        schema.parse(args),
        'Failed to apply damage/healing'
      );
    } catch (error) {
      this.logger.error('Error applying damage/healing', error);
      if (error instanceof z.ZodError) {
        return `Parameter error: ${error.errors.map(e => e.message).join(', ')}`;
      }
      throw error;
    }
  }

  async handleRollSavingThrows(args: any) {
    const schema = z.object({
      targets: z.array(z.string()).min(1),
      rollType: z.enum(['save', 'check', 'skill']),
      ability: z.string().optional(),
      skill: z.string().optional(),
      dc: z.number().int().optional(),
      isPublic: z.boolean().optional(),
    });
    try {
      return await this.query(
        'rollSavingThrows',
        schema.parse(args),
        'Failed to roll saving throws'
      );
    } catch (error) {
      this.logger.error('Error rolling saving throws', error);
      if (error instanceof z.ZodError) {
        return `Parameter error: ${error.errors.map(e => e.message).join(', ')}`;
      }
      throw error;
    }
  }

  async handleUseNpcActivity(args: any) {
    const schema = z.object({
      actorName: z.string(),
      itemName: z.string(),
      targetAC: z.number().int().optional(),
      isPublic: z.boolean().optional(),
    });
    try {
      return await this.query('useNpcActivity', schema.parse(args), 'Failed to use NPC activity');
    } catch (error) {
      this.logger.error('Error using NPC activity', error);
      if (error instanceof z.ZodError) {
        return `Parameter error: ${error.errors.map(e => e.message).join(', ')}`;
      }
      throw error;
    }
  }

  async handleManageRest(args: any) {
    const schema = z.object({
      targets: z.array(z.string()).min(1),
      restType: z.enum(['short', 'long']),
      newDay: z.boolean().optional(),
    });
    try {
      return await this.query('manageRest', schema.parse(args), 'Failed to manage rest');
    } catch (error) {
      this.logger.error('Error managing rest', error);
      if (error instanceof z.ZodError) {
        return `Parameter error: ${error.errors.map(e => e.message).join(', ')}`;
      }
      throw error;
    }
  }
}
