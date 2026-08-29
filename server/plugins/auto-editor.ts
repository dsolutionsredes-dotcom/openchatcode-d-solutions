import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Plugin } from 'vite';
import type { ModelMessage } from 'ai';
import { buildAgentSystemPrompt } from '../../src/agent/systemPrompt.ts';
import type { AgentContext } from '../../src/agent/context.ts';
import { makeDraft } from '../../src/editor/store.ts';
import { execFinalizeUpload } from '../../src/agent/tools/upload-finalize.ts';
import { loadOfflineStoredProject, type OfflineStoredProject } from '../external-agent/offline-project-store.ts';
import { claimOfflineProjectOwnership, releaseProjectEditOwnership, renewProjectEditOwnership } from '../external-agent/project-edit-ownership.ts';
import { commitOfflineStoredProject } from '../external-agent/offline-project-store.ts';
import { OfflineExternalEditRuntime } from '../external-agent/offline-runtime.ts';
import { offlineExternalToolSchemas } from '../external-agent/offline-tools.ts';
import { activateOfflineAgentRuntimeBackend } from '../external-agent/agent-runtime-persistence.ts';
import { externalMcpAuthorized } from '../editor-auth.ts';
import { getKey, type KeyName } from '../keystore.ts';
import { resolveLlmProviderConfig } from '../llm-config.ts';
import { defaultModelForProvider, normalizeLlmProvider, normalizeOpenAiApiMode } from '../../shared/llm-providers.ts';
import { kvGet, kvSet } from '../../src/persist/sharedKv.ts';
import {
  executeRun,
  type ServerRunInput,
} from '../agent-runs/executor.ts';
import { createRunWithCapability, getRun, recoverServerRun } from '../agent-runs/store.ts';
import { mintImportUpload } from '../external-agent/import-token.ts';
import { createExternalProject, deleteExternalProjectWithMedia, listExternalProjects, renameExternalProject } from '../external-agent/projects.ts';
import { externalUploadMediaType } from '../../src/media/uploadMediaType.ts';
import { googleDriveFileMetadata, googleDriveFileStream } from '../google-drive-service-account.ts';
import { normalizeUploadedMedia } from './normalize-media.ts';
import { processUploadReceiptAction } from '../external-agent/upload-receipt-action.ts';

const CONVERSATION_LIMIT = 32;
export function conversationKeyFor(projectId: string, conversationId = 'default'): string {
  return `auto-editor-conversation:${projectId}:${conversationId}`;
}
const runtimeByProject = new Map<string, OfflineExternalEditRuntime>();

/** A one-shot upload receipt must never be retried through the edit runtime. */
class DriveImportRetryRequiredError extends Error {
  constructor() {
    super('The project revision changed after the upload receipt was finalized.');
    this.name = 'DriveImportRetryRequiredError';
  }
}

type ExternalResponseDefaults = {
  action: string;
  status: string;
  message?: string;
  requiresUserInput?: boolean;
  engine?: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeExternalResponse(
  body: Record<string, unknown>,
  value: unknown,
  defaults: ExternalResponseDefaults,
): Record<string, unknown> {
  const source = record(value);
  const sourceData = record(source.data);
  const data: Record<string, unknown> = { ...sourceData };
  const contractKeys = new Set([
    'ok', 'status', 'action', 'message', 'data', 'requiresUserInput',
    'errorCode', 'projectId', 'runId', 'engine',
  ]);
  for (const [key, entry] of Object.entries(source)) {
    if (!contractKeys.has(key)) data[key] = entry;
  }
  if (typeof source.conversationId === 'string') data.conversationId = source.conversationId;
  const projectId = typeof source.projectId === 'string'
    ? source.projectId
    : typeof body.projectId === 'string' ? body.projectId : '';
  const runId = typeof source.runId === 'string'
    ? source.runId
    : typeof body.runId === 'string' ? body.runId : undefined;
  return {
    ok: source.ok !== false,
    status: typeof source.status === 'string' ? source.status : defaults.status,
    action: typeof source.action === 'string' ? source.action : defaults.action,
    message: typeof source.message === 'string' ? source.message : (defaults.message ?? ''),
    data,
    requiresUserInput: source.requiresUserInput === true || defaults.requiresUserInput === true,
    errorCode: typeof source.errorCode === 'string' ? source.errorCode : '',
    projectId,
    ...(runId ? { runId } : {}),
    engine: typeof source.engine === 'string' ? source.engine : (defaults.engine ?? 'openchatcut'),
  };
}

function sendExternal(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
  value: unknown,
  defaults: ExternalResponseDefaults,
): void {
  send(res, status, normalizeExternalResponse(body, value, defaults));
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) throw new Error('request body too large');
    chunks.push(buffer);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('body must be a JSON object');
  return value as Record<string, unknown>;
}

function projectIdOf(value: unknown): string {
  const projectId = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(projectId)) throw new Error('valid projectId is required');
  return projectId;
}

type ProjectEnsureDependencies = {
  list: typeof listExternalProjects;
  create: typeof createExternalProject;
};

type ProjectRenameDependencies = {
  rename: typeof renameExternalProject;
};

function externalProjectNameOf(body: Record<string, unknown>): string {
  const value = body.externalProjectName ?? body.name;
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length > 160) throw new Error('externalProjectName/name must be 160 characters or fewer');
  return name;
}

export async function ensureExternalProjectWith(
  body: Record<string, unknown>,
  dependencies: ProjectEnsureDependencies = { list: listExternalProjects, create: createExternalProject },
): Promise<Record<string, unknown>> {
  const requestedProjectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
  if (requestedProjectId) {
    const projectId = projectIdOf(requestedProjectId);
    const projects = await dependencies.list(false);
    const exact = projects.find((project) => project.id === projectId);
    if (exact) return { ok: true, projectId: exact.id, reused: true, created: false, project: exact };
    const matches = projects.filter((project) => project.id.startsWith(projectId));
    if (matches.length === 1) return { ok: true, projectId: matches[0].id, reused: true, created: false, project: matches[0] };
    if (matches.length > 1) throw new Error('projectId prefix is ambiguous; send the full OpenChatCut projectId');
    throw new Error(`OpenChatCut projectId ${projectId} was not found`);
  }

  if (body.externalProjectId != null) {
    throw new Error('externalProjectId cannot be associated by the official project API; provide externalProjectName/name to bootstrap, then persist and send the returned OpenChatCut projectId');
  }
  const name = externalProjectNameOf(body);
  if (!name) throw new Error('projectId or externalProjectName/name is required; persist the returned projectId for subsequent requests');
  const projects = await dependencies.list(false);
  const matches = projects.filter((project) => project.name === name);
  if (matches.length > 1) throw new Error(`multiple OpenChatCut projects have the name ${name}; send the returned projectId`);
  if (matches.length === 1) {
    const project = matches[0];
    return { ok: true, projectId: project.id, reused: true, created: false, project, externalProjectName: name };
  }
  const project = await dependencies.create({
    name,
    ...(typeof body.description === 'string' ? { description: body.description } : {}),
    ...(typeof body.fps === 'number' ? { fps: body.fps } : {}),
    ...(typeof body.compositionWidth === 'number' ? { compositionWidth: body.compositionWidth } : {}),
    ...(typeof body.compositionHeight === 'number' ? { compositionHeight: body.compositionHeight } : {}),
  });
  return { ok: true, projectId: project.id, reused: false, created: true, project, externalProjectName: name };
}

export async function renameExternalProjectWith(
  body: Record<string, unknown>,
  dependencies: ProjectRenameDependencies = { rename: renameExternalProject },
): Promise<Record<string, unknown>> {
  const projectId = projectIdOf(body.projectId);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw new Error('name is required');
  const project = await dependencies.rename(projectId, name);
  if (!project) {
    return {
      ok: false,
      status: 'not_found',
      action: 'project_rename',
      message: 'project not found',
      requiresUserInput: false,
      errorCode: 'project_not_found',
      projectId,
      engine: 'openchatcut',
    };
  }
  return {
    ok: true,
    status: 'applied',
    action: 'project_rename',
    message: 'project renamed',
    data: { project },
    requiresUserInput: false,
    errorCode: '',
    projectId,
    engine: 'openchatcut',
  };
}

export function externalMessageOf(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('message is required');
  return value;
}

export function conversationIdOf(body: Record<string, unknown>): string {
  const raw = body.conversationId ?? body.chatId ?? 'default';
  const conversationId = typeof raw === 'string' ? raw.trim() : '';
  if (!conversationId) return 'default';
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(conversationId)) {
    throw new Error('conversationId/chatId must contain only letters, numbers, _ or -');
  }
  return conversationId;
}

function publicOrigin(): string {
  return process.env.OPENCHATCUT_PUBLIC_ORIGIN?.trim() || `http://127.0.0.1:${process.env.PORT || '5199'}`;
}

function internalOrigin(): string {
  return `http://127.0.0.1:${process.env.PORT || '5199'}`;
}

async function runtimeFor(projectId: string): Promise<OfflineExternalEditRuntime> {
  const current = runtimeByProject.get(projectId);
  if (current) return current;
  activateOfflineAgentRuntimeBackend();
  const runtime = await OfflineExternalEditRuntime.create(projectId, `${publicOrigin()}/#/editor/${encodeURIComponent(projectId)}`);
  runtimeByProject.set(projectId, runtime);
  return runtime;
}

export async function conversationFor(projectId: string, conversationId = 'default'): Promise<ModelMessage[]> {
  const value = await kvGet<unknown>(conversationKeyFor(projectId, conversationId));
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ModelMessage => (
    Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)
    && ((entry as Record<string, unknown>).role === 'user' || (entry as Record<string, unknown>).role === 'assistant')
    && typeof (entry as Record<string, unknown>).content === 'string'
  )).slice(-CONVERSATION_LIMIT);
}

export async function saveConversation(projectId: string, conversationId: string, messages: ModelMessage[]): Promise<void> {
  await kvSet(conversationKeyFor(projectId, conversationId), messages.slice(-CONVERSATION_LIMIT));
}

/**
 * Approval and rejection arrive through a separate endpoint from the agent
 * turn.  Record that terminal event in the same conversation so a later turn
 * cannot mistake the old proposal text in its history for an active proposal.
 */
export async function recordProposalResolution(
  projectId: string,
  conversationId: string,
  status: 'applied' | 'rejected',
): Promise<void> {
  const history = await conversationFor(projectId, conversationId);
  const content = status === 'applied'
    ? 'OpenChatCut: la propuesta anterior fue aprobada y aplicada. Puedes continuar con la siguiente solicitud.'
    : 'OpenChatCut: la propuesta anterior fue rechazada. Puedes continuar con la siguiente solicitud.';
  await saveConversation(projectId, conversationId, [...history, { role: 'assistant', content }]);
}

function promptContext(snapshot: OfflineStoredProject): AgentContext {
  const draft = makeDraft(snapshot.doc);
  return {
    commands: draft.commands,
    getState: draft.getState,
    getDoc: draft.getDoc,
    getCreativeMode: () => null,
    templates: [],
    audio: [],
    getProjectId: () => snapshot.projectId,
    getApprovalMode: () => 'manual',
  };
}

function responseLanguage(value: unknown): string {
  if (typeof value !== 'string') return "the user's language";
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z]{2,8}(-[a-z]{2,8})?$/.test(normalized)) return 'the user\'s language';
  return normalized;
}

export function finalVisibleRunMessage(run: { events: readonly { type: string; data: unknown }[] }): string {
  let lastTextStart = -1;
  for (let index = run.events.length - 1; index >= 0; index -= 1) {
    if (run.events[index]?.type === 'text-start') {
      lastTextStart = index;
      break;
    }
  }
  return run.events.slice(lastTextStart + 1)
    .filter((event) => event.type === 'text-delta' && event.data && typeof event.data === 'object')
    .map((event) => (event.data as Record<string, unknown>).text)
    .filter((text): text is string => typeof text === 'string')
    .join('');
}

function runMessage(run: { events: readonly { type: string; data: unknown }[] }): string {
  return finalVisibleRunMessage(run);
}

export function requiresUserInputFor(status: string): boolean {
  return status === 'pending_approval' || status === 'needs_clarification';
}

function autoStatus(runtimeInfo: Record<string, unknown> | null, runStatus: string): string {
  if (runtimeInfo?.status === 'awaiting_review') return 'pending_approval';
  if (runtimeInfo?.status === 'applied') return 'applied';
  if (runtimeInfo?.status === 'rejected') return 'rejected';
  if (runStatus === 'failed') return 'failed';
  if (runStatus === 'awaiting-user') return 'needs_clarification';
  if (runStatus === 'queued') return 'queued';
  if (runStatus === 'running') return 'running';
  return 'read';
}

/**
 * The external bridge must never turn a completed run without a visible answer
 * into a successful editor response.  n8n forwards this message verbatim, so
 * treating an empty terminal response as `read` would let VALE report a result
 * that the engine never produced.
 */
export function messageRunOutcome(
  runtimeInfo: Record<string, unknown> | null,
  runStatus: string,
  message: string,
  runError = '',
): Pick<ExternalResponseDefaults, 'action' | 'status' | 'message' | 'requiresUserInput'> & { ok: boolean; errorCode: string } {
  const status = autoStatus(runtimeInfo, runStatus);
  const terminal = status !== 'queued' && status !== 'running';
  if (status === 'pending_approval' && !message.trim()) {
    return {
      ok: true,
      status,
      action: 'agent_turn',
      message: 'OpenChatCut creó una propuesta pendiente. Responde aprobando o rechazando en texto libre.',
      requiresUserInput: true,
      errorCode: '',
    };
  }
  if (terminal && !message.trim()) {
    return {
      ok: false,
      status: 'failed',
      action: 'agent_turn',
      message: runError || 'OpenChatCut did not return a visible response.',
      requiresUserInput: false,
      errorCode: 'agent_run_failed',
    };
  }
  return {
    ok: status !== 'failed',
    status,
    action: 'agent_turn',
    message,
    requiresUserInput: requiresUserInputFor(status),
    errorCode: runError,
  };
}

/**
 * A model may finish its turn after making changes but before explicitly
 * calling review_edit_session.  That leaves a drafting session locked and the
 * next request cannot proceed.  At the end of a server-side turn, turn such a
 * completed draft into the manual proposal required by the external contract.
 */
export async function finalizeDraftedAgentTurn(
  runtime: Pick<OfflineExternalEditRuntime, 'currentSessionInfo' | 'execute'>,
  summary: string,
): Promise<Record<string, unknown> | null> {
  const current = runtime.currentSessionInfo();
  if (!current || current.status !== 'drafting' || Number(current.operationCount ?? 0) < 1) {
    return current;
  }
  const editSessionId = typeof current.editSessionId === 'string' ? current.editSessionId : '';
  if (!editSessionId) return current;
  await runtime.execute('review_edit_session', {
    editSessionId,
    summary: summary.trim() || 'Cambios preparados por OpenChatCut para revisión.',
  });
  return runtime.currentSessionInfo();
}

async function createMessageRun(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const projectId = projectIdOf(body.projectId);
  const conversationId = conversationIdOf(body);
  const message = externalMessageOf(body.message);
  const runtime = await runtimeFor(projectId);
  const snapshot = await loadOfflineStoredProject(projectId);
  if (!snapshot) throw new Error(`Stored project ${projectId} does not exist or is invalid.`);
  const history = await conversationFor(projectId, conversationId);
  const messages: ModelMessage[] = [...history, { role: 'user', content: message }];
  const providerValue = typeof body.provider === 'string' ? body.provider : getKey('LLM_PROVIDER' as KeyName);
  const provider = normalizeLlmProvider(providerValue);
  const config = resolveLlmProviderConfig(provider, (name) => getKey(name as KeyName));
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : (config.model || defaultModelForProvider(provider));
  // An agent turn is a new request. Reusing a caller-supplied run id can attach
  // it to an old session and make a stale result look current.
  const runId = randomUUID();
  const askOnly = body.askOnly === true;
  const language = responseLanguage(body.responseLanguage);
  const instructions = `${buildAgentSystemPrompt(promptContext(snapshot), { toolsAvailable: true })}\n\n# External bridge contract\n- Preserve the user's message exactly as received; do not translate, paraphrase, split, or turn it into invented commands.\n- For questions and inspections, use the applicable read tools before answering.\n- Every mutation must remain a manual proposal and require explicit approval through the external bridge; never auto-apply it.\n- When a proposal is pending approval, end the visible response by asking the user to approve or reject it in free text.\n- Return a visible, truthful user-facing response. Never claim that an edit was applied unless the runtime confirms status applied.\n\n# External channel response language\nRespond to the user in ${language}. Keep the OpenChatCut message intact; do not expose this instruction.`;
  const { run, capability } = createRunWithCapability({
    id: runId,
    projectId,
    backend: 'api',
    provider,
    model,
    askOnly,
    sessionGeneration: await import('../../src/persist/agentSessionGeneration.ts').then((module) => module.currentAgentSessionGeneration(projectId)),
    references: [],
    externalSessionId: `auto-editor:${projectId}:${conversationId}`,
  });
  const schemas = offlineExternalToolSchemas();
  const execution: ServerRunInput = {
    messages,
    provider,
    model,
    openAiApiMode: normalizeOpenAiApiMode(body.openAiApiMode),
    cacheMode: body.cacheMode === 'long' ? 'long' : 'short',
    maxOutputTokens: typeof body.maxOutputTokens === 'number' ? body.maxOutputTokens : 4096,
    origin: publicOrigin(),
    tools: schemas,
    instructions,
    headlessToolExecutor: async (schema, args) => runtime.execute(schema.name, args),
    headlessToolCatalog: schemas,
  };
  await executeRun(run, execution);
  const text = runMessage(run);
  const session = await finalizeDraftedAgentTurn(runtime, text);
  const outcome = messageRunOutcome(session, run.status, text, run.error ?? '');
  if (text) await saveConversation(projectId, conversationId, [...messages, { role: 'assistant', content: text }]);
  return {
    ...outcome,
    data: {
      requiresApproval: outcome.status === 'pending_approval',
      approvalStatus: outcome.status === 'pending_approval' ? 'pending' : outcome.status,
      ...(session ?? {}),
      conversationId,
      engineProjectId: projectId,
    },
    projectId,
    runId: run.id,
    capability,
    conversationId,
    engine: 'openchatcut',
  };
}

export interface PendingProposalRuntime {
  currentSessionInfo(): Record<string, unknown> | null;
  currentProposalDoc(): OfflineStoredProject['doc'] | null;
  execute(name: string, args: Record<string, unknown>): Promise<unknown>;
}

export async function recoverPendingProposalRuntime<T extends PendingProposalRuntime>(runtime: T): Promise<T> {
  const current = runtime.currentSessionInfo();
  if (current?.status === 'awaiting_review') return runtime;
  const started = record(await runtime.execute('begin_edit_session', {
    clientName: 'auto-editor-recovery',
    approvalMode: 'manual',
  }));
  if (started.resumed === true && started.status === 'awaiting_review') return runtime;
  const editSessionId = typeof started.editSessionId === 'string' ? started.editSessionId : '';
  if (editSessionId) await runtime.execute('discard_edit_session', { editSessionId }).catch(() => undefined);
  throw new Error('no pending proposal is available for recovery');
}

async function pendingRuntimeFor(projectId: string): Promise<OfflineExternalEditRuntime> {
  const runtime = await runtimeFor(projectId);
  try {
    return await recoverPendingProposalRuntime(runtime);
  } catch (error) {
    const current = runtime.currentSessionInfo();
    const editSessionId = typeof current?.editSessionId === 'string' ? current.editSessionId : '';
    if (editSessionId) await runtime.execute('discard_edit_session', { editSessionId }).catch(() => undefined);
    runtimeByProject.delete(projectId);
    await runtime.dispose();
    throw error;
  }
}

async function officialRender(body: Record<string, unknown>, preview: boolean): Promise<Record<string, unknown>> {
  const projectId = projectIdOf(body.projectId);
  let project: OfflineStoredProject['doc'] | null;
  if (preview) {
    project = (await pendingRuntimeFor(projectId)).currentProposalDoc();
    if (!project) throw new Error('no pending proposal is available for preview');
  } else {
    project = (await loadOfflineStoredProject(projectId))?.doc ?? null;
    if (!project) throw new Error(`Stored project ${projectId} does not exist or is invalid.`);
  }
  const requestBody = {
    project,
    timelineId: project.activeTimelineId,
    format: 'video',
    codec: 'h264',
    resolution: preview ? '480p' : body.resolution,
    name: typeof body.name === 'string' ? body.name : preview ? 'auto-editor-preview' : 'auto-editor-render',
    ...(typeof body.fps === 'number' ? { fps: body.fps } : {}),
    ...(typeof body.videoBitrate === 'number' ? { videoBitrate: body.videoBitrate } : {}),
  };
  const response = await fetch(`${internalOrigin()}/export/job`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof value?.error === 'string' ? value.error : `official export failed: HTTP ${response.status}`);
  return { ok: true, projectId, preview, ...value, engine: 'openchatcut-official-export' };
}

async function officialRenderStatus(renderId: string, method: 'GET' | 'DELETE' = 'GET'): Promise<Record<string, unknown>> {
  const response = await fetch(`${internalOrigin()}/export/job/${encodeURIComponent(renderId)}`, { method });
  if (method === 'DELETE') return { ok: response.ok, renderId };
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof value?.error === 'string' ? value.error : `official export status failed: HTTP ${response.status}`);
  return { ok: true, ...value, engine: 'openchatcut-official-export' };
}

async function createOfficialImportSession(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const projectId = projectIdOf(body.projectId);
  const snapshot = await loadOfflineStoredProject(projectId);
  if (!snapshot) throw new Error(`Stored project ${projectId} does not exist or is invalid.`);
  const assetType = typeof body.assetType === 'string' ? body.assetType : '';
  const filename = typeof body.filename === 'string' ? body.filename : '';
  const contentType = typeof body.contentType === 'string' ? body.contentType : '';
  const expectedBytes = body.size;
  const requested = typeof body.assetId === 'string' ? body.assetId.trim() : '';
  const existing = requested
    ? (snapshot.doc.assets ?? []).find((asset) => asset.id === requested || asset.id.startsWith(requested))
    : undefined;
  if (requested && !existing) throw new Error(`asset not found: ${requested}`);
  const assetId = existing?.id ?? randomUUID();
  const sessionId = `sess_${randomUUID()}`;
  const handoff = mintImportUpload({
    sessionId,
    assetId,
    assetType,
    filename,
    projectId,
    method: 'POST',
    contentType,
    expectedBytes,
  });
  return {
    ok: true,
    action: 'create_session',
    projectId,
    sessionId,
    assetId,
    existingAsset: Boolean(existing),
    ...handoff,
    uploadUrl: new URL(handoff.uploadUrl, publicOrigin()).href,
    headers: { 'Content-Type': contentType, 'Content-Length': String(expectedBytes) },
    state: 'awaiting_upload',
    next: 'POST the exact bytes to uploadUrl, then call /api/auto-editor/import/finalize with the opaque receipt and measured metadata.',
  };
}

async function finalizeOfficialImportWithRuntime(
  runtime: OfflineExternalEditRuntime,
  projectId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const started = await runtime.execute('begin_edit_session', { clientName: 'n8n-import', approvalMode: 'auto' });
  const editSessionId = typeof started === 'object' && started && 'editSessionId' in started
    ? String((started as Record<string, unknown>).editSessionId)
    : '';
  if (!editSessionId) throw new Error('official import session did not return an edit session id');
  let finalized: unknown;
  try {
    finalized = await runtime.execute('finalize_uploaded_asset', {
      ...body,
      editSessionId,
    });
  } catch (error) {
    // The tool commits the receipt before the runtime validates its project
    // ownership. A stale result here therefore cannot be retried with that
    // same receipt; the Drive caller must mint a new one and transfer again.
    if (isStaleOfflineRevision(error)) throw new DriveImportRetryRequiredError();
    throw error;
  }
  if (finalized && typeof finalized === 'object' && 'error' in finalized) {
    throw new Error(String((finalized as Record<string, unknown>).error));
  }
  let reviewed: unknown;
  try {
    reviewed = await runtime.execute('review_edit_session', {
      editSessionId,
      summary: 'Official n8n media import',
    });
  } catch (error) {
    // The receipt was already committed above.  Retrying this whole method
    // would claim that one-shot receipt for a second time.
    if (isStaleOfflineRevision(error)) throw new DriveImportRetryRequiredError();
    throw error;
  }
  return { ok: true, projectId, ...((finalized ?? {}) as Record<string, unknown>), review: reviewed, engine: 'openchatcut-official-import' };
}

async function releaseOfficialImportRuntime(projectId: string, runtime: OfflineExternalEditRuntime): Promise<void> {
  if (runtimeByProject.get(projectId) === runtime) runtimeByProject.delete(projectId);
  await runtime.dispose().catch(() => undefined);
}

function isStaleOfflineRevision(error: unknown): boolean {
  return error instanceof Error && error.message.includes('changed ownership or revision during the offline edit');
}

async function finalizeDriveReceiptIntoCurrentProject(
  projectId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // Drive import is not an editor instruction.  Claim the project only for
  // this short final registration, after the long file transfer has finished.
  const claimed = await claimOfflineProjectOwnership(projectId, randomUUID());
  if (claimed.status !== 'claimed') {
    throw new Error(claimed.status === 'busy'
      ? 'El proyecto está siendo editado en este momento; vuelve a intentar cuando termine esa edición.'
      : 'OpenChatCut no pudo reservar el proyecto para registrar el archivo.');
  }
  const draft = makeDraft(claimed.doc);
  const context: AgentContext = {
    commands: draft.commands,
    getState: draft.getState,
    getDoc: draft.getDoc,
    getCreativeMode: () => null,
    templates: [],
    audio: [],
    getProjectId: () => projectId,
  };
  // Video normalization can take longer than the normal 90-second ownership
  // lease. Keep this short-lived import reservation alive while the receipt is
  // finalized, rather than extending the lease globally or letting another
  // writer replace the project beneath this import.
  let activeClaim = claimed.claim;
  let heartbeatStopped = false;
  let heartbeatFailure: Error | null = null;
  let renewalChain: Promise<void> = Promise.resolve();
  const renewOwnership = () => {
    renewalChain = renewalChain.then(async () => {
      if (heartbeatStopped || heartbeatFailure) return;
      const renewed = await renewProjectEditOwnership(activeClaim);
      if (renewed.status !== 'renewed') {
        heartbeatFailure = new Error('El proyecto cambió mientras se preparaba el archivo; no se volvió a transferir el video.');
        return;
      }
      activeClaim = renewed.claim;
    }).catch((error) => {
      heartbeatFailure = error instanceof Error ? error : new Error(String(error));
    });
  };
  const ownershipHeartbeat = setInterval(renewOwnership, 30_000);
  try {
    const finalized = await execFinalizeUpload(body, context, {
      normalizeUploadedVideo: normalizeUploadedMedia,
      postReceiptAction: async (receiptBody) => {
        const result = processUploadReceiptAction(receiptBody);
        return new Response(JSON.stringify(result.body), {
          status: result.status,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    if (!finalized || typeof finalized !== 'object' || Array.isArray(finalized)) {
      throw new Error('OpenChatCut no pudo finalizar el archivo recibido desde Drive.');
    }
    if ('error' in finalized) throw new Error(String(finalized.error));
    heartbeatStopped = true;
    clearInterval(ownershipHeartbeat);
    await renewalChain;
    if (heartbeatFailure) throw heartbeatFailure;
    const renewed = await renewProjectEditOwnership(activeClaim);
    if (renewed.status !== 'renewed') {
      throw new Error('El proyecto cambió mientras se preparaba el archivo; no se volvió a transferir el video.');
    }
    const committed = await commitOfflineStoredProject({
      projectId,
      expectedRevision: claimed.revision,
      doc: draft.getDoc(),
      ownership: renewed.claim,
      canCommit: () => true,
    });
    if (committed.status !== 'applied') {
      throw new Error('El proyecto cambió mientras se registraba el archivo; no se volvió a transferir el video.');
    }
    return {
      ...(finalized as Record<string, unknown>),
      projectId,
      review: { status: 'applied', automaticVersionCreated: committed.automaticVersionCreated === true },
      engine: 'openchatcut-official-import',
    };
  } finally {
    heartbeatStopped = true;
    clearInterval(ownershipHeartbeat);
    await renewalChain.catch(() => undefined);
    await releaseProjectEditOwnership(activeClaim).catch(() => undefined);
  }
}

async function importOfficialDriveAsset(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const projectId = projectIdOf(body.projectId);
  const assetType = typeof body.assetType === 'string' ? body.assetType.trim() : '';
  const driveId = typeof body.driveId === 'string' ? body.driveId.trim() : '';
  const metadata = await googleDriveFileMetadata(driveId);
  if (!metadata.canDownload) throw new Error('Google Drive indica que este archivo no se puede descargar.');
  if (!externalUploadMediaType(assetType, metadata.mimeType)) {
    throw new Error(`El archivo de Drive no es compatible con assetType=${assetType || '(vacío)'} y MIME=${metadata.mimeType || '(vacío)'}.`);
  }

  const session = await createOfficialImportSession({
    projectId,
    assetType,
    filename: metadata.name,
    contentType: metadata.mimeType,
    size: metadata.size,
  });
  const publicUploadUrl = typeof session.uploadUrl === 'string' ? session.uploadUrl : '';
  const handoff = new URL(publicUploadUrl);
  const driveStream = await googleDriveFileStream(metadata.id);
  const uploadResponse = await fetch(`${internalOrigin()}${handoff.pathname}${handoff.search}`, {
    method: 'POST',
    headers: {
      'content-type': metadata.mimeType,
      'content-length': String(metadata.size),
    },
    body: driveStream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  const upload = await uploadResponse.json().catch(() => ({})) as Record<string, unknown>;
  const receipt = typeof upload.receipt === 'string' ? upload.receipt : '';
  const path = typeof upload.path === 'string' ? upload.path : '';
  if (!uploadResponse.ok || !receipt || !path) {
    const detail = typeof upload.error === 'string' ? upload.error : `HTTP ${uploadResponse.status}`;
    throw new Error(`OpenChatCut no pudo recibir el archivo desde Google Drive: ${detail}`);
  }

  const finalizeBody: Record<string, unknown> = { projectId, receipt, assetType };
  if (assetType === 'audio' || assetType === 'gif' || assetType === 'video') {
    const durationResponse = await fetch(`${internalOrigin()}/api/waveform?src=${encodeURIComponent(path)}`);
    const durationData = await durationResponse.json().catch(() => ({})) as Record<string, unknown>;
    const durationInSeconds = Number(durationData.durationMs) / 1000;
    if (!durationResponse.ok || !Number.isFinite(durationInSeconds) || durationInSeconds <= 0) {
      throw new Error('OpenChatCut no pudo medir la duración del archivo importado desde Google Drive.');
    }
    finalizeBody.durationInSeconds = durationInSeconds;
  }
  const finalized = await finalizeDriveReceiptIntoCurrentProject(projectId, finalizeBody);
  return { ...finalized, driveId: metadata.id, filename: metadata.name, contentType: metadata.mimeType, size: metadata.size };
}

async function finalizeOfficialImport(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const projectId = projectIdOf(body.projectId);
  // Imports are self-contained operations. Reusing an idle agent runtime can
  // carry an old project revision from a browser/editor turn; a stale review
  // would consume the one-shot upload receipt and make a retry impossible.
  // A pending proposal is user-owned, so never discard it just to import.
  const cached = runtimeByProject.get(projectId);
  if (cached) {
    const pending = cached.currentSessionInfo();
    if (pending?.status === 'drafting' || pending?.status === 'awaiting_review') {
      throw new Error('OpenChatCut tiene una propuesta pendiente; apruébala o recházala antes de importar un archivo nuevo.');
    }
    await releaseOfficialImportRuntime(projectId, cached);
  }

  let runtime = await runtimeFor(projectId);
  try {
    return await finalizeOfficialImportWithRuntime(runtime, projectId, body);
  } catch (error) {
    if (!isStaleOfflineRevision(error)) throw error;

    const pending = runtime.currentSessionInfo();
    if (pending?.status === 'drafting' || pending?.status === 'awaiting_review') {
      // A pending proposal belongs to the user. Never discard it merely to
      // retry an asset import against a newer project revision.
      throw error;
    }

    // A completed auto-editor turn can leave an idle runtime tied to the
    // previous project revision. Importing must use a fresh snapshot instead
    // of asking n8n (or the user) to restart a session.
    await releaseOfficialImportRuntime(projectId, runtime);
    runtime = await runtimeFor(projectId);
    return await finalizeOfficialImportWithRuntime(runtime, projectId, body);
  } finally {
    // An import runtime is short-lived. It must never poison a later import.
    await releaseOfficialImportRuntime(projectId, runtime);
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!externalMcpAuthorized(req)) {
    return sendExternal(res, 401, {}, { ok: false, errorCode: 'unauthorized', message: 'invalid OpenChatCut MCP token' }, {
      action: 'read', status: 'failed', engine: 'openchatcut',
    });
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  let requestBody: Record<string, unknown> = {};
  const readExternalBody = async (): Promise<Record<string, unknown>> => {
    requestBody = await readJson(req);
    return requestBody;
  };
  try {
    if (req.method === 'POST' && url.pathname === '/project/ensure') {
      const body = await readExternalBody();
      const value = await ensureExternalProjectWith(body);
      return sendExternal(res, 200, body, value, {
        action: 'project_ensure',
        status: value.created === true ? 'created' : 'reused',
      });
    }
    if (req.method === 'POST' && url.pathname === '/project/rename') {
      const body = await readExternalBody();
      const value = await renameExternalProjectWith(body);
      return sendExternal(res, value.ok === true ? 200 : 404, body, value, {
        action: 'project_rename',
        status: value.ok === true ? 'applied' : 'not_found',
      });
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/project/')) {
      const projectId = projectIdOf(url.pathname.slice('/project/'.length));
      const runtime = runtimeByProject.get(projectId);
      if (runtime) {
        runtimeByProject.delete(projectId);
        await runtime.dispose();
      }
      const deletion = await deleteExternalProjectWithMedia(projectId);
      const deleted = deletion.deleted;
      return sendExternal(res, deleted ? 200 : 404, { projectId }, {
        ok: deleted,
        status: deleted ? 'deleted' : 'not_found',
        action: 'project_delete',
        message: deleted ? 'project deleted' : 'project not found',
        data: { deleted, mediaDeleted: deletion.mediaDeleted, previewsDeleted: deletion.previewsDeleted },
        requiresUserInput: false,
        errorCode: deleted ? '' : 'project_not_found',
        projectId,
        engine: 'openchatcut',
      }, { action: 'project_delete', status: deleted ? 'deleted' : 'failed' });
    }
    if (req.method === 'POST' && url.pathname === '/import/session') return sendExternal(res, 201, requestBody = await readExternalBody(), await createOfficialImportSession(requestBody), { action: 'import', status: 'awaiting_upload' });
    if (req.method === 'POST' && url.pathname === '/import/drive') return sendExternal(res, 200, requestBody = await readExternalBody(), await importOfficialDriveAsset(requestBody), { action: 'import', status: 'applied' });
    if (req.method === 'POST' && url.pathname === '/import/finalize') return sendExternal(res, 200, requestBody = await readExternalBody(), await finalizeOfficialImport(requestBody), { action: 'import_finalize', status: 'applied' });
    if (req.method === 'POST' && url.pathname === '/render') return sendExternal(res, 200, requestBody = await readExternalBody(), await officialRender(requestBody, false), { action: 'render', status: 'queued' });
    if (req.method === 'POST' && url.pathname === '/preview') return sendExternal(res, 200, requestBody = await readExternalBody(), await officialRender(requestBody, true), { action: 'preview', status: 'queued' });
    if ((req.method === 'GET' || req.method === 'DELETE') && (url.pathname.startsWith('/render/') || url.pathname.startsWith('/preview/'))) {
      const renderId = url.pathname.split('/').filter(Boolean)[1] ?? '';
      if (!renderId) throw new Error('render id is required');
      const value = await officialRenderStatus(renderId, req.method);
      return sendExternal(res, 200, { projectId: url.searchParams.get('projectId') ?? '' }, value, { action: url.pathname.startsWith('/preview/') ? 'preview_status' : 'render_status', status: 'read' });
    }
    if (req.method === 'POST' && url.pathname === '/message') return sendExternal(res, 200, requestBody = await readExternalBody(), await createMessageRun(requestBody), { action: 'read', status: 'read' });
    const parts = url.pathname.split('/').filter(Boolean);
    if (req.method === 'GET' && parts[0] === 'runs' && parts[1]) {
      const projectId = projectIdOf(url.searchParams.get('projectId'));
      const run = getRun(parts[1]) ?? await recoverServerRun(projectId, parts[1]);
      if (!run || run.projectId !== projectId) return send(res, 404, { ok: false, error: 'run not found' });
      return sendExternal(res, 200, { projectId }, {
        ok: true,
        status: autoStatus(runtimeByProject.get(projectId)?.currentSessionInfo() ?? null, run.status),
        action: 'run_status',
        message: runMessage(run),
        projectId,
        runId: run.id,
        errorCode: run.error ?? '',
        engine: 'openchatcut',
      }, { action: 'run_status', status: 'read' });
    }
    if (req.method === 'POST' && (url.pathname === '/proposal/approve' || url.pathname === '/proposal/reject')) {
      const body = await readJson(req);
      const projectId = projectIdOf(body.projectId);
      const conversationId = conversationIdOf(body);
      const sessionId = typeof body.editSessionId === 'string' ? body.editSessionId : '';
      const runtime = await pendingRuntimeFor(projectId);
      const result = await runtime.execute(url.pathname.endsWith('/approve') ? 'approve_edit_session' : 'reject_edit_session', { editSessionId: sessionId });
      const approved = url.pathname.endsWith('/approve');
      const status = approved ? 'applied' : 'rejected';
      const action = approved ? 'approve' : 'reject';
      runtimeByProject.delete(projectId);
      await runtime.dispose();
      await recordProposalResolution(projectId, conversationId, status).catch((error: unknown) =>
        process.emitWarning(`OpenChatCut could not record the proposal resolution in conversation history: ${
          error instanceof Error ? error.message : String(error)}`));
      const metadata = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
      return sendExternal(res, 200, { projectId }, {
        ok: true,
        status,
        action,
        message: status === 'applied' ? 'OpenChatCut applied the approved proposal.' : 'OpenChatCut rejected the proposal.',
        data: { requiresApproval: false, approvalStatus: status, ...metadata },
        requiresUserInput: false,
        errorCode: '',
        projectId,
        engine: 'openchatcut',
      }, { action, status });
    }
    return sendExternal(res, 404, requestBody, { ok: false, errorCode: 'not_found', message: 'not found' }, { action: 'read', status: 'failed' });
  } catch (error) {
    const errorCode = error instanceof Error ? error.message : String(error);
    return sendExternal(res, 400, requestBody, { ok: false, status: 'failed', errorCode, message: errorCode, engine: 'openchatcut' }, { action: 'error', status: 'failed' });
  }
}

export function autoEditorPlugin(): Plugin {
  return { name: 'openchatcut-auto-editor', configureServer(server) {
    server.middlewares.use('/api/auto-editor', (req, res) => { void handle(req, res); });
  }};
}
