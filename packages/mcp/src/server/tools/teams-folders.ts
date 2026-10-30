import { findTeams } from '@documenso/lib/server-only/team/find-teams';
import { getTeamById } from '@documenso/lib/server-only/team/get-team';
import { ZFindFoldersRequestSchema, ZFindFoldersResponseSchema } from '@documenso/trpc/server/folder-router/schema';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { McpToolContext } from '../context';
import { defineTool, TOOL_ANNOTATIONS } from '../define-tool';

export const ZListTeamsOutputSchema = z.object({
  currentTeam: z.object({
    id: z.number(),
    name: z.string(),
    url: z.string(),
    organisationId: z.string(),
    role: z.string(),
  }),
  teams: z
    .array(
      z.object({
        id: z.number(),
        name: z.string(),
        url: z.string(),
        organisationId: z.string(),
        role: z.string(),
        isCurrent: z.boolean(),
      }),
    )
    .describe('Teams in the same organisation the token user belongs to. Tools always act on currentTeam.'),
});

export const registerTeamAndFolderTools = (server: McpServer, ctx: McpToolContext) => {
  defineTool(server, ctx, {
    name: 'list_teams',
    title: 'List teams',
    description:
      'Show the team this API token is scoped to (every other tool operates on it) and the other teams of the same organisation the token user belongs to. A different team requires a different API token.',
    inputSchema: z.object({}),
    outputSchema: ZListTeamsOutputSchema,
    annotations: TOOL_ANNOTATIONS.readOnly,
    handler: async () => {
      const currentTeam = await getTeamById({ userId: ctx.auth.user.id, teamId: ctx.auth.teamId });

      const result = await findTeams({
        userId: ctx.auth.user.id,
        organisationId: currentTeam.organisationId,
        perPage: 100,
      });

      const teams = result.data.map((team) => ({
        id: team.id,
        name: team.name,
        url: team.url,
        organisationId: team.organisationId,
        role: team.currentTeamRole,
        isCurrent: team.id === currentTeam.id,
      }));

      return {
        structured: {
          currentTeam: {
            id: currentTeam.id,
            name: currentTeam.name,
            url: currentTeam.url,
            organisationId: currentTeam.organisationId,
            role: currentTeam.currentTeamRole,
          },
          teams,
        },
        text: `Current team: ${currentTeam.name} (${currentTeam.url})\n${teams.map((team) => `- ${team.name}${team.isCurrent ? ' (current)' : ''}`).join('\n')}`,
      };
    },
  });

  defineTool(server, ctx, {
    name: 'list_folders',
    title: 'List folders',
    description:
      'List folders of the current team. Pass parentId to list sub-folders, and type DOCUMENT or TEMPLATE to filter by folder kind. Folder IDs can be used when creating or listing envelopes.',
    inputSchema: ZFindFoldersRequestSchema,
    outputSchema: ZFindFoldersResponseSchema,
    annotations: TOOL_ANNOTATIONS.readOnly,
    identifiers: (input) => ({ folderId: input.parentId }),
    handler: async (input) => {
      const result = await ctx.caller.folder.findFolders(input);

      const lines = result.data.map((folder) => `${folder.id} | ${folder.type} | ${folder.name}`).join('\n');

      return { structured: result, text: `${result.count} folder(s)\n${lines || 'No folders.'}` };
    },
  });
};
