import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { addExternalProjectAsset, createExternalProject, getExternalProject, listExternalProjects } from '../external-agent/projects.ts';
import { maxUploadBytes, storeUploadStream } from '../plugins/upload.ts';
import { kindOfDescriptor, type MediaKind } from '../../shared/media-kind.ts';

export interface ExternalAgentApi {
  createRun: (projectId: string, message: string, references: unknown[], conversationId?: string) => Promise<{ runId: string; status: string }>;
  getRun: (runId: string) => Promise<unknown | undefined>;
  applyRun: (runId: string) => Promise<unknown>;
  rejectRun: (runId: string) => Promise<unknown>;
}

const MAX_BODY_BYTES = 64 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function conversationId(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return /^[a-zA-Z0-9:_-]{1,160}$/.test(normalized) ? normalized : null;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function approvalErrorStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  const code = (error as Error & { code?: string }).code;
  return code === 'RUN_NOT_FOUND' ? 404
    : code === 'PROPOSAL_NOT_PENDING' || code === 'PROPOSAL_STALE' || code === 'APPROVAL_CONFLICT' ? 409
      : undefined;
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return typeof value === 'string' ? value : undefined;
}

/** Common authentication for every /api/external/* route. Never logs either key. */
export function isExternalApiAuthorized(req: IncomingMessage): boolean {
  const expected = process.env.OPENCHATCUT_EXTERNAL_API_KEY?.trim();
  const provided = headerValue(req, 'x-api-key')?.trim();
  if (!expected || !provided) return false;
  const expectedBytes = Buffer.from(expected, 'utf8');
  const providedBytes = Buffer.from(provided, 'utf8');
  return expectedBytes.length === providedBytes.length
    && timingSafeEqual(expectedBytes, providedBytes);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(buffer);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new Error('invalid JSON body');
  }
  if (!isRecord(parsed)) throw new Error('body must be a JSON object');
  return parsed;
}

function requestedKind(value: string | null): MediaKind | null | undefined {
  if (value === null) return undefined;
  return value === 'video' || value === 'image' || value === 'audio' || value === 'gif' || value === 'svg'
    ? value
    : null;
}

function contentType(req: IncomingMessage): string {
  const value = req.headers['content-type'];
  return typeof value === 'string' ? value : '';
}

function declaredContentLength(req: IncomingMessage): number | undefined {
  const value = req.headers['content-length'];
  const parsed = typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

async function createExternalAsset(
  req: IncomingMessage,
  res: ServerResponse,
  projectId: string,
  url: URL,
): Promise<void> {
  if (!await getExternalProject(projectId)) {
    sendJson(res, 404, { error: 'project not found' });
    return;
  }
  const originalName = (url.searchParams.get('name') ?? '').trim();
  if (!originalName) {
    sendJson(res, 400, { error: 'name is required' });
    return;
  }
  const requested = requestedKind(url.searchParams.get('kind'));
  if (requested === null) {
    sendJson(res, 400, { error: 'unsupported asset kind' });
    return;
  }
  const detected = kindOfDescriptor(originalName, contentType(req));
  if (!requested && !detected) {
    sendJson(res, 415, { error: 'unsupported media type' });
    return;
  }
  if (requested && detected && requested !== detected) {
    sendJson(res, 400, { error: 'kind does not match the uploaded media type' });
    return;
  }
  const declared = declaredContentLength(req);
  if (declared !== undefined && declared > maxUploadBytes()) {
    sendJson(res, 413, { error: 'file too large' });
    req.resume();
    return;
  }

  const kind = requested ?? detected!;
  const stored = await storeUploadStream(req, {
    originalName,
    assetId: randomUUID(),
    contentType: contentType(req) || undefined,
    maxBytes: maxUploadBytes(),
  });
  const asset = {
    id: randomUUID(),
    name: originalName,
    kind,
    src: stored.path,
    durationInFrames: 150,
  } as const;
  const registered = await addExternalProjectAsset(projectId, asset);
  if (!registered) {
    sendJson(res, 404, { error: 'project not found' });
    return;
  }
  sendJson(res, 201, {
    projectId,
    asset: { id: registered.id, name: registered.name, kind: registered.kind, src: registered.src },
  });
}

export async function handleExternalProjectsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  agentApi?: ExternalAgentApi,
): Promise<void> {
  if (!isExternalApiAuthorized(req)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  const agentRun = url.pathname.match(/^\/agent\/runs\/([^/]+)$/);
  if (req.method === 'GET' && agentRun) {
    const run = await agentApi?.getRun(decodeURIComponent(agentRun[1]));
    if (!run) { sendJson(res, 404, { error: 'run not found' }); return; }
    sendJson(res, 200, run);
    return;
  }
  const agentApproval = url.pathname.match(/^\/agent\/runs\/([^/]+)\/(apply|reject)$/);
  if (req.method === 'POST' && agentApproval) {
    const runId = decodeURIComponent(agentApproval[1]);
    try {
      if (!agentApi) throw new Error('agent runtime unavailable');
      const result = agentApproval[2] === 'apply'
        ? await agentApi.applyRun(runId)
        : await agentApi.rejectRun(runId);
      sendJson(res, 200, result);
    } catch (error) {
      const status = approvalErrorStatus(error);
      if (status) sendJson(res, status, {
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && typeof (error as Error & { code?: unknown }).code === 'string'
          ? { code: (error as Error & { code: string }).code }
          : {}),
      });
      else throw error;
    }
    return;
  }
  const agentMessage = url.pathname.match(/^\/projects\/([^/]+)\/agent\/messages$/);
  if (req.method === 'POST' && agentMessage) {
    const body = await readJson(req);
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) { sendJson(res, 400, { error: 'message is required' }); return; }
    if (body.references !== undefined && !Array.isArray(body.references)) { sendJson(res, 400, { error: 'references must be an array' }); return; }
    const callerConversation = conversationId(body.conversationId);
    if (callerConversation === null) { sendJson(res, 400, { error: 'conversationId is invalid' }); return; }
    const projectId = decodeURIComponent(agentMessage[1]);
    try {
      if (!agentApi) throw new Error('agent runtime unavailable');
      const run = await agentApi.createRun(projectId, message, Array.isArray(body.references) ? body.references : [], callerConversation);
      sendJson(res, 202, { runId: run.runId, status: run.status });
    } catch (error) {
      if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') sendJson(res, 404, { error: 'project not found' });
      else throw error;
    }
    return;
  }
  const match = url.pathname.match(/^\/projects(?:\/([^/]+))?(?:\/assets)?$/);
  if (!match) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }

  const projectId = match[1] ? decodeURIComponent(match[1]) : undefined;
  const isAssetsRoute = url.pathname.endsWith('/assets');
  if (req.method === 'POST' && projectId && isAssetsRoute) {
    await createExternalAsset(req, res, projectId, url);
    return;
  }
  if (req.method === 'POST' && !projectId) {
    const project = await createExternalProject(await readJson(req));
    sendJson(res, 201, project);
    return;
  }
  if (req.method === 'GET' && !match[1]) {
    sendJson(res, 200, await listExternalProjects());
    return;
  }
  if (req.method === 'GET' && projectId && !isAssetsRoute) {
    const project = await getExternalProject(projectId);
    if (!project) {
      sendJson(res, 404, { error: 'project not found' });
      return;
    }
    sendJson(res, 200, project);
    return;
  }
  sendJson(res, 405, { error: 'method not allowed' });
}
