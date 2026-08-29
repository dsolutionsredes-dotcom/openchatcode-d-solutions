import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { ModelMessage } from 'ai';
import {
  conversationFor,
  conversationKeyFor,
  ensureExternalProjectWith,
  externalMessageOf,
  finalizeDraftedAgentTurn,
  messageRunOutcome,
  normalizeExternalResponse,
  recordProposalResolution,
  recoverPendingProposalRuntime,
  saveConversation,
} from './auto-editor.ts';
import { finalVisibleRunMessage } from './auto-editor.ts';
import { offlineExternalToolSchemas } from '../external-agent/offline-tools.ts';
import { isExternalServerDirectTool } from '../../src/agent/external-tool-policy.ts';
import type { OfflineStoredProject } from '../external-agent/offline-project-store.ts';
import { OfflineExternalEditRuntime } from '../external-agent/offline-runtime.ts';
import { MemoryPersistence, editorUrl, projectDoc, projectId as fixtureProjectId } from '../external-agent/offline-runtime.verify-fixtures.ts';

const projectId = `auto-editor-contract-${randomUUID()}`;
const alpha: ModelMessage[] = [{ role: 'user', content: 'alpha' }];
const beta: ModelMessage[] = [{ role: 'user', content: 'beta' }];
await saveConversation(projectId, 'chat-alpha', alpha);
await saveConversation(projectId, 'chat-beta', beta);
assert.notEqual(conversationKeyFor(projectId, 'chat-alpha'), conversationKeyFor(projectId, 'chat-beta'));
assert.deepEqual(await conversationFor(projectId, 'chat-alpha'), alpha);
assert.deepEqual(await conversationFor(projectId, 'chat-beta'), beta);
assert.deepEqual(await conversationFor(projectId, 'chat-missing'), []);
await recordProposalResolution(projectId, 'chat-alpha', 'applied');
assert.match(
  String((await conversationFor(projectId, 'chat-alpha')).at(-1)?.content),
  /propuesta anterior fue aprobada y aplicada/,
  'approval resolution is appended to the same conversation',
);

let createCalls = 0;
const existingProject = { id: 'official-project-1', name: 'Vale project', updatedAt: 1 };
const projectDeps = {
  list: async () => [existingProject],
  create: async (args: Record<string, unknown>) => {
    createCalls += 1;
    return { id: 'official-project-2', name: String(args.name), updatedAt: 2 };
  },
} as never;
const reusedProject = await ensureExternalProjectWith({ projectId: existingProject.id }, projectDeps);
assert.equal(reusedProject.projectId, existingProject.id);
assert.equal(reusedProject.reused, true);
assert.equal(createCalls, 0);
const createdProject = await ensureExternalProjectWith({ externalProjectName: 'New Vale project' }, {
  list: async () => [],
  create: async (args: Record<string, unknown>) => {
    createCalls += 1;
    return { id: 'official-project-3', name: String(args.name), updatedAt: 3 };
  },
} as never);
assert.equal(createdProject.projectId, 'official-project-3');
assert.equal(createdProject.created, true);
assert.equal(createCalls, 1);
assert.equal(normalizeExternalResponse({ projectId: 'official-project-3' }, createdProject, {
  action: 'project_ensure', status: 'created',
}).data.externalProjectName, 'New Vale project');
assert.throws(() => externalMessageOf('  '), /message is required/);
const literalMessage = '  Hazlo más corto.  ';
assert.equal(externalMessageOf(literalMessage), literalMessage, 'message reaches OpenChatCut byte-for-byte as supplied');

const emptyTerminal = messageRunOutcome(null, 'completed', '');
assert.deepEqual(emptyTerminal, {
  ok: false,
  status: 'failed',
  action: 'agent_turn',
  message: 'OpenChatCut did not return a visible response.',
  requiresUserInput: false,
  errorCode: 'agent_run_failed',
}, 'an empty terminal agent turn is failed, never a successful read');
const pendingProposal = messageRunOutcome({ status: 'awaiting_review', editSessionId: 'edit-1' }, 'completed', '');
assert.equal(pendingProposal.ok, true);
assert.equal(pendingProposal.status, 'pending_approval');
assert.equal(pendingProposal.action, 'agent_turn');
assert.equal(pendingProposal.requiresUserInput, true);
assert.equal(pendingProposal.message, 'OpenChatCut creó una propuesta pendiente. Responde aprobando o rechazando en texto libre.');

let draftSession: Record<string, unknown> | null = {
  status: 'drafting', operationCount: 1, editSessionId: 'draft-1',
};
const draftCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const finalizedDraft = await finalizeDraftedAgentTurn({
  currentSessionInfo: () => draftSession,
  execute: async (name, args) => {
    draftCalls.push({ name, args });
    draftSession = { status: 'awaiting_review', operationCount: 1, editSessionId: 'draft-1' };
    return draftSession;
  },
}, 'Renombrar el archivo de prueba.');
assert.equal(draftCalls[0]?.name, 'review_edit_session');
assert.equal(draftCalls[0]?.args.editSessionId, 'draft-1');
assert.equal(finalizedDraft?.status, 'awaiting_review');

const appliedProposal = messageRunOutcome({ status: 'applied' }, 'completed', 'OpenChatCut applied the approved proposal.');
assert.equal(appliedProposal.ok, true);
assert.equal(appliedProposal.status, 'applied');
assert.equal(appliedProposal.action, 'agent_turn');

const contractCases = [
  { body: { projectId: 'p' }, value: { ok: true, renderId: 'r1' }, action: 'render', status: 'queued', field: 'renderId' },
  { body: { projectId: 'p' }, value: { ok: true, state: 'awaiting_upload', assetId: 'a1' }, action: 'import', status: 'awaiting_upload', field: 'assetId' },
  { body: { projectId: 'p' }, value: { ok: true, progress: 0.5 }, action: 'render_status', status: 'running', field: 'progress' },
  { body: { projectId: 'p' }, value: { ok: true, status: 'applied' }, action: 'edit', status: 'applied', field: undefined },
] as const;
for (const test of contractCases) {
  const normalized = normalizeExternalResponse(test.body, test.value, { action: test.action, status: test.status });
  for (const key of ['ok', 'status', 'action', 'message', 'data', 'requiresUserInput', 'errorCode', 'projectId', 'engine']) {
    assert.ok(key in normalized, `${test.action} contract has ${key}`);
  }
  if (test.field) assert.equal((normalized.data as Record<string, unknown>)[test.field], test.value[test.field]);
}

const pendingDoc = { projectId: 'p', doc: {} as OfflineStoredProject['doc'], revision: 'r' };
const recoveredActions: string[] = [];
const fakeRecovered = {
  currentSessionInfo: () => null,
  currentProposalDoc: () => pendingDoc.doc,
  execute: async (name: string) => {
    recoveredActions.push(name);
    if (name === 'begin_edit_session') return { resumed: true, status: 'awaiting_review', editSessionId: 'edit-recovered' };
    return { status: name.startsWith('approve') ? 'applied' : 'rejected' };
  },
};
const recovered = await recoverPendingProposalRuntime(fakeRecovered);
assert.equal(recovered.currentProposalDoc(), pendingDoc.doc, 'recovered proposal is available for preview');
await recovered.execute('approve_edit_session', { editSessionId: 'edit-recovered' });
await recovered.execute('reject_edit_session', { editSessionId: 'edit-recovered' });
assert.deepEqual(recoveredActions, ['begin_edit_session', 'approve_edit_session', 'reject_edit_session']);

const exposed = new Set(offlineExternalToolSchemas().map((schema) => schema.name));
assert.equal(exposed.has('transcribe_track'), true, 'transcribe_track is in server-direct catalog');
assert.equal(isExternalServerDirectTool('transcribe_track'), true, 'transcribe_track is server-direct');

let invokedTool = '';
const transcriptionRuntime = await OfflineExternalEditRuntime.create(fixtureProjectId, editorUrl, {
  persistence: new MemoryPersistence(projectDoc()),
  isBrowserConnected: () => false,
  executeTool: async (name) => {
    invokedTool = name;
    return { ok: true, provider: 'openai' };
  },
});
const transcriptionSession = await transcriptionRuntime.execute('begin_edit_session', {
  clientName: 'auto-editor-test', approvalMode: 'manual',
}) as Record<string, unknown>;
await transcriptionRuntime.execute('transcribe_track', {
  editSessionId: String(transcriptionSession.editSessionId), provider: 'openai', track: 'A1',
});
assert.equal(invokedTool, 'transcribe_track', 'external runtime invokes headless transcription');
await transcriptionRuntime.dispose();

assert.equal(finalVisibleRunMessage({ events: [
  { type: 'text-start', data: {} },
  { type: 'text-delta', data: { text: 'internal' } },
  { type: 'text-start', data: {} },
  { type: 'text-delta', data: { text: 'visible' } },
] }), 'visible');

console.log('auto-editor contract, conversation, recovery, and headless exposure verification passed');
