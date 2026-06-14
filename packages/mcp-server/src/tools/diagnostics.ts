import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

interface DiagnosticsToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

/**
 * Diagnostics tools for troubleshooting Foundry modules: an inventory of
 * installed modules (versions, dependencies, compatibility) and the captured
 * runtime error/warning buffer (console errors, uncaught errors, unhandled
 * rejections) attributed to the offending module.
 */
export class DiagnosticsTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor(options: DiagnosticsToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger.child({ component: 'DiagnosticsTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'get-modules',
        description:
          'List installed Foundry modules with version, active state, declared compatibility (min/verified/max core), and required-dependency satisfaction — plus the core Foundry and game-system versions. Each module includes an `issues` list (missing/inactive dependencies, version-out-of-range). Use to spot version/dependency/compatibility conflicts.',
        inputSchema: {
          type: 'object',
          properties: {
            activeOnly: { type: 'boolean', description: 'Only return active modules.' },
            withIssuesOnly: {
              type: 'boolean',
              description: 'Only return modules that have detected issues.',
            },
          },
        },
      },
      {
        name: 'get-module-errors',
        description:
          'Return runtime errors/warnings captured from the Foundry client (console.error/warn, uncaught errors, unhandled promise rejections), each with its stack and the module it was attributed to, plus a triage summary of counts by module. Use this when a module misbehaves; filter by module or time.',
        inputSchema: {
          type: 'object',
          properties: {
            level: { type: 'string', enum: ['error', 'warn'], description: 'Filter by severity.' },
            moduleId: {
              type: 'string',
              description: 'Filter to a module/system id (partial match), e.g. "lib-wrapper".',
            },
            sinceTimestamp: { type: 'string', description: 'ISO timestamp; only newer entries.' },
            limit: { type: 'integer', description: 'Max entries (default 100, max 500).' },
          },
        },
      },
      {
        name: 'clear-module-errors',
        description:
          'Clear the captured diagnostics buffer (e.g. before reproducing an issue so only fresh errors remain).',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'get-module-manifest',
        description:
          "Return a single module's full manifest (version, compatibility, relationships/dependencies, authors, url) for deeper inspection.",
        inputSchema: {
          type: 'object',
          properties: {
            moduleId: { type: 'string', description: 'The module id.' },
          },
          required: ['moduleId'],
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

  async handleGetModules(args: any) {
    const schema = z.object({
      activeOnly: z.boolean().optional(),
      withIssuesOnly: z.boolean().optional(),
    });
    try {
      return await this.run('getModules', schema.parse(args ?? {}), 'Failed to get modules');
    } catch (error) {
      this.logger.error('Error getting modules', error);
      throw error;
    }
  }

  async handleGetModuleErrors(args: any) {
    const schema = z.object({
      level: z.enum(['error', 'warn']).optional(),
      moduleId: z.string().optional(),
      sinceTimestamp: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    });
    try {
      return await this.run(
        'getModuleErrors',
        schema.parse(args ?? {}),
        'Failed to get module errors'
      );
    } catch (error) {
      this.logger.error('Error getting module errors', error);
      throw error;
    }
  }

  async handleClearModuleErrors(_args: any) {
    try {
      return await this.run('clearModuleErrors', {}, 'Failed to clear module errors');
    } catch (error) {
      this.logger.error('Error clearing module errors', error);
      throw error;
    }
  }

  async handleGetModuleManifest(args: any) {
    const schema = z.object({ moduleId: z.string() });
    try {
      return await this.run(
        'getModuleManifest',
        schema.parse(args),
        'Failed to get module manifest'
      );
    } catch (error) {
      this.logger.error('Error getting module manifest', error);
      if (error instanceof z.ZodError) {
        return `Parameter error: ${error.errors.map(e => e.message).join(', ')}`;
      }
      throw error;
    }
  }
}
