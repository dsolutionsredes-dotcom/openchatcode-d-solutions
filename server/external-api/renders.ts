import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadExternalProjectDoc } from '../external-agent/projects.ts';
import { installExternalAgentServerFetch } from '../external-agent/server-fetch.ts';
import { isExternalApiAuthorized } from './projects.ts';

const MAX_RENDER_BODY_BYTES = 32 * 1024;

type RenderBody = {
  format?: 'video' | 'audio';
  codec?: 'h264' | 'vp8' | 'mp3' | 'wav';
  resolution?: '480p' | '720p' | '1080p';
  fps?: 24 | 25 | 30 | 50 | 60;
  name?: string;
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_RENDER_BODY_BYTES) throw new Error('request body too large');
    chunks.push(bytes);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body must be a JSON object');
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message === 'body must be a JSON object') throw error;
    throw new Error('invalid JSON body');
  }
}

function renderOptions(body: Record<string, unknown>): RenderBody {
  const format = body.format;
  const codec = body.codec;
  const resolution = body.resolution;
  const fps = body.fps;
  const name = body.name;

  if (format !== undefined && format !== 'video' && format !== 'audio') {
    throw new Error('format must be video or audio');
  }
  if (codec !== undefined && !['h264', 'vp8', 'mp3', 'wav'].includes(String(codec))) {
    throw new Error('codec must be h264, vp8, mp3, or wav');
  }
  if (resolution !== undefined && !['480p', '720p', '1080p'].includes(String(resolution))) {
    throw new Error('resolution must be 480p, 720p, or 1080p');
  }
  if (fps !== undefined && ![24, 25, 30, 50, 60].includes(Number(fps))) {
    throw new Error('fps must be 24, 25, 30, 50, or 60');
  }
  if (name !== undefined && typeof name !== 'string') {
    throw new Error('name must be a string');
  }

  return {
    ...(format !== undefined ? { format: format as RenderBody['format'] } : {}),
    ...(codec !== undefined ? { codec: codec as RenderBody['codec'] } : {}),
    ...(resolution !== undefined ? { resolution: resolution as RenderBody['resolution'] } : {}),
    ...(fps !== undefined ? { fps: Number(fps) as RenderBody['fps'] } : {}),
    ...(name !== undefined ? { name } : {}),
  };
}

function activeRenderState(
  doc: Awaited<ReturnType<typeof loadExternalProjectDoc>>,
): Record<string, unknown> | null {
  if (!doc) return null;
  const timelines = Array.isArray(doc.timelines) ? doc.timelines : [];
  const active = timelines.find((timeline) => (
    !!timeline
    && typeof timeline === 'object'
    && !Array.isArray(timeline)
    && String((timeline as { id?: unknown }).id ?? '') === doc.activeTimelineId
  )) ?? timelines[0];

  if (!active || typeof active !== 'object' || Array.isArray(active)) return null;
  const items = (active as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length === 0) return null;

  return {
    ...(active as Record<string, unknown>),
    assets: doc.assets,
  };
}

async function internalJson(response: Response): Promise<Record<string, unknown>> {
  const data = await response.json().catch(() => ({}));
  return data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
}

function normalizedSnapshot(renderId: string, snapshot: Record<string, unknown>) {
  const result = snapshot.result && typeof snapshot.result === 'object' && !Array.isArray(snapshot.result)
    ? snapshot.result as Record<string, unknown>
    : null;

  return {
    renderId,
    status: typeof snapshot.status === 'string' ? snapshot.status : 'unknown',
    progress: typeof snapshot.progress === 'number' ? snapshot.progress : 0,
    phase: typeof snapshot.phase === 'string' ? snapshot.phase : undefined,
    processedFrames: typeof snapshot.processedFrames === 'number' ? snapshot.processedFrames : undefined,
    totalFrames: typeof snapshot.totalFrames === 'number' ? snapshot.totalFrames : undefined,
    createdAt: typeof snapshot.createdAt === 'number' ? snapshot.createdAt : undefined,
    updatedAt: typeof snapshot.updatedAt === 'number' ? snapshot.updatedAt : undefined,
    result: result ? {
      ...result,
      downloadPath: typeof result.path === 'string' ? result.path : undefined,
    } : null,
    error: typeof snapshot.error === 'string' ? snapshot.error : null,
    recovery: snapshot.recovery ?? null,
  };
}

export function isExternalRenderPath(value: string): boolean {
  const path = new URL(value || '/', 'http://localhost').pathname;
  return /^\/projects\/[^/]+\/renders$/.test(path)
    || /^\/renders\/[^/]+$/.test(path);
}

/**
 * Authenticated external render API for n8n.
 *
 * POST   /api/external/projects/:projectId/renders
 * GET    /api/external/renders/:renderId
 * DELETE /api/external/renders/:renderId
 *
 * It intentionally reuses OpenChatCut's existing /export/job queue instead of
 * implementing a second render pipeline.
 */
export async function handleExternalRenderRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!isExternalApiAuthorized(req)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }

  installExternalAgentServerFetch();
  const url = new URL(req.url ?? '/', 'http://localhost');

  const projectRender = url.pathname.match(/^\/projects\/([^/]+)\/renders$/);
  if (projectRender) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method not allowed — use POST' });
      return;
    }

    const projectId = decodeURIComponent(projectRender[1]);
    const doc = await loadExternalProjectDoc(projectId);
    if (!doc) {
      sendJson(res, 404, { error: 'project not found', code: 'PROJECT_NOT_FOUND' });
      return;
    }

    const state = activeRenderState(doc);
    if (!state) {
      sendJson(res, 409, { error: 'project timeline is empty', code: 'PROJECT_EMPTY' });
      return;
    }

    let options: RenderBody;
    try {
      options = renderOptions(await readJson(req));
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error), code: 'RENDER_REQUEST_INVALID' });
      return;
    }

    const response = await fetch('/export/job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, ...options }),
    });
    const data = await internalJson(response);

    if (!response.ok || typeof data.renderId !== 'string') {
      sendJson(res, response.status || 500, {
        error: typeof data.error === 'string' ? data.error : 'render could not be queued',
        code: 'RENDER_QUEUE_FAILED',
      });
      return;
    }

    sendJson(res, 202, {
      projectId,
      renderId: data.renderId,
      status: 'queued',
      statusPath: `/api/external/renders/${encodeURIComponent(data.renderId)}`,
    });
    return;
  }

  const render = url.pathname.match(/^\/renders\/([^/]+)$/);
  if (render) {
    const renderId = decodeURIComponent(render[1]);

    if (req.method === 'GET') {
      const response = await fetch(`/export/job/${encodeURIComponent(renderId)}`, { method: 'GET' });
      const data = await internalJson(response);
      if (!response.ok) {
        sendJson(res, response.status || 500, {
          error: typeof data.error === 'string' ? data.error : 'render status unavailable',
          code: response.status === 404 ? 'RENDER_NOT_FOUND' : 'RENDER_STATUS_FAILED',
          renderId,
        });
        return;
      }
      sendJson(res, 200, normalizedSnapshot(renderId, data));
      return;
    }

    if (req.method === 'DELETE') {
      const response = await fetch(`/export/job/${encodeURIComponent(renderId)}`, { method: 'DELETE' });
      if (response.status === 204) {
        sendJson(res, 200, { ok: true, renderId, deleted: true });
        return;
      }
      const data = await internalJson(response);
      sendJson(res, response.status || 500, {
        error: typeof data.error === 'string' ? data.error : 'render could not be deleted',
        code: response.status === 404 ? 'RENDER_NOT_FOUND'
          : response.status === 409 ? 'RENDER_STILL_RUNNING'
            : 'RENDER_DELETE_FAILED',
        renderId,
      });
      return;
    }

    sendJson(res, 405, { error: 'method not allowed — use GET or DELETE' });
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}
