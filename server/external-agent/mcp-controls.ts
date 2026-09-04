import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const MCP_CONTROL_TOOLS: Tool[] = [
  {
    name: 'openchatcut_status',
    description: 'Show connected OpenChatCut editors, this transport session binding, and capability status.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'list_projects',
    description: 'List OpenChatCut projects, newest first.',
    inputSchema: {
      type: 'object',
      properties: {
        includeDeleted: { type: 'boolean' },
        editorBaseUrl: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'create_project',
    description: 'Create an empty OpenChatCut project with one active timeline and one video track.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        compositionWidth: { type: 'number' },
        compositionHeight: { type: 'number' },
        fps: { type: 'number' },
        editorBaseUrl: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'target_project',
    description: 'Permanently bind this MCP transport to a live browser editor, or to an existing stored project through the offline fallback.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' }, editorBaseUrl: { type: 'string' } },
      required: ['projectId'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'get_editor_url',
    description: 'Return the OpenChatCut editor URL for this session project or an explicitly named project.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' }, editorBaseUrl: { type: 'string' } },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'agent_message',
    description: 'Send one complete natural-language instruction to the OpenChatCut internal agent through the single connected editor. The agent chooses its own tools and returns a truthful proposal, result, or reconciliation status.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'OpenChatCut project id. Exactly this project must be the only connected editor.' },
        message: { type: 'string', description: 'Complete user instruction. Preserve it exactly; do not split it into tool calls.' },
        conversationId: { type: 'string', description: 'Stable external conversation id, for example the Telegram chat id plus project id.' },
        responseLanguage: { type: 'string', description: 'Language for the visible response, for example Spanish.' },
      },
      required: ['projectId', 'message'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'resolve_agent_proposal',
    description: 'Approve or reject the exact pending proposal previously returned by agent_message for the same live editor project.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        editSessionId: { type: 'string' },
        decision: { type: 'string', enum: ['approve', 'reject'] },
      },
      required: ['projectId', 'editSessionId', 'decision'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'reconcile_agent_state',
    description: 'Read the real state of the single connected editor after an interrupted request. This never repeats or applies an edit.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

export const MCP_CONTROL_TOOL_NAMES: Record<string, true> = Object.fromEntries(
  MCP_CONTROL_TOOLS.map((tool) => [tool.name, true]),
);
