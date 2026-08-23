import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Plugin } from 'vite';
import type { ModelMessage } from 'ai';
import { buildAgentSystemPrompt } from '../../src/agent/systemPrompt.ts';
import type { AgentContext } from '../../src/agent/context.ts';
import { makeDraft } from '../../src/editor/store.ts';
import { loadOfflineStoredProject, type OfflineStoredProject } from '../external-agent/offline-project-store.ts';
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

const CONVERSATION_LIMIT = 32;
export function conversationKeyFor(projectId: string, conversationId = 'default'): string {
  return `auto-editor-conversation:${projectId}:${conversationId}`;
}
const runtimeByProject = new Map<string, OfflineExternalEditRuntime>();

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

async function createMessageRun(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const projectId = projectIdOf(body.projectId);
  const conversationId = conversationIdOf(body);
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) throw new Error('message is required');
  const runtime = await runtimeFor(projectId);
  const snapshot = await loadOfflineStoredProject(projectId);
  if (!snapshot) throw new Error(`Stored project ${projectId} does not exist or is invalid.`);
  const history = await conversationFor(projectId, conversationId);
  const messages: ModelMessage[] = [...history, { role: 'user', content: message }];
  const providerValue = typeof body.provider === 'string' ? body.provider : getKey('LLM_PROVIDER' as KeyName);
  const provider = normalizeLlmProvider(providerValue);
  const config = resolveLlmProviderConfig(provider, (name) => getKey(name as KeyName));
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : (config.model || defaultModelForProvider(provider));
  const runId = typeof body.runId === 'string' && body.runId.trim() ? body.runId.trim() : randomUUID();
  const askOnly = body.askOnly === true;
  const language = responseLanguage(body.responseLanguage);
  const instructions = `${buildAgentSystemPrompt(promptContext(snapshot), { toolsAvailable: true })}\n\n# External channel response language\nRespond to the user in ${language}. Keep the OpenChatCut message intact; do not expose this instruction.`;
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
  };
  await executeRun(run, execution);
  const text = runMessage(run);
  const session = runtime.currentSessionInfo();
  const status = autoStatus(session, run.status);
  if (text) await saveConversation(projectId, conversationId, [...messages, { role: 'assistant', content: text }]);
  return {
    ok: true,
    status,
    action: status === 'pending_approval' ? 'edit' : 'read',
    message: text,
    data: {
      requiresApproval: status === 'pending_approval',
      approvalStatus: status === 'pending_approval' ? 'pending' : status,
      ...(session ?? {}),
      conversationId,
    },
    requiresUserInput: requiresUserInputFor(status),
    errorCode: run.error ?? '',
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

async function finalizeOfficialImport(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const projectId = projectIdOf(body.projectId);
  const runtime = await runtimeFor(projectId);
  const started = await runtime.execute('begin_edit_session', { clientName: 'n8n-import', approvalMode: 'auto' });
  const editSessionId = typeof started === 'object' && started && 'editSessionId' in started
    ? String((started as Record<string, unknown>).editSessionId)
    : '';
  if (!editSessionId) throw new Error('official import session did not return an edit session id');
  const finalized = await runtime.execute('finalize_uploaded_asset', {
    ...body,
    editSessionId,
  });
  if (finalized && typeof finalized === 'object' && 'error' in finalized) {
    throw new Error(String((finalized as Record<string, unknown>).error));
  }
  const reviewed = await runtime.execute('review_edit_session', {
    editSessionId,
    summary: 'Official n8n media import',
  });
  await runtime.dispose();
  runtimeByProject.delete(projectId);
  return { ok: true, projectId, ...((finalized ?? {}) as Record<string, unknown>), review: reviewed, engine: 'openchatcut-official-import' };
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
    if (req.method === 'POST' && url.pathname === '/import/session') return sendExternal(res, 201, requestBody = await readExternalBody(), await createOfficialImportSession(requestBody), { action: 'import', status: 'awaiting_upload' });
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
      return sendExternal(res, 200, { projectId }, { ok: true, status: autoStatus(runtimeByProject.get(projectId)?.currentSessionInfo() ?? null, run.status), message: runMessage(run), projectId, runId: run.id, errorCode: run.error ?? '', engine: 'openchatcut' }, { action: 'status', status: 'read' });
    }
    if (req.method === 'POST' && (url.pathname === '/proposal/approve' || url.pathname === '/proposal/reject')) {
      const body = await readJson(req);
      const projectId = projectIdOf(body.projectId);
      const sessionId = typeof body.editSessionId === 'string' ? body.editSessionId : '';
      const runtime = await pendingRuntimeFor(projectId);
      const result = await runtime.execute(url.pathname.endsWith('/approve') ? 'approve_edit_session' : 'reject_edit_session', { editSessionId: sessionId });
      const status = url.pathname.endsWith('/approve') ? 'applied' : 'rejected';
      runtimeByProject.delete(projectId);
      await runtime.dispose();
      const metadata = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
      return sendExternal(res, 200, { projectId }, { ok: true, status, action: 'edit', message: '', data: { requiresApproval: false, approvalStatus: status, ...metadata }, requiresUserInput: false, errorCode: '', projectId, engine: 'openchatcut' }, { action: 'edit', status });
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
