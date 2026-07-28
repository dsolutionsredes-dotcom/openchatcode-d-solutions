import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createExternalProject, getExternalProject, listExternalProjects } from '../external-agent/projects.ts';

const MAX_BODY_BYTES = 64 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
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

export async function handleExternalProjectsRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!isExternalApiAuthorized(req)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  const match = url.pathname.match(/^\/projects(?:\/([^/]+))?$/);
  if (!match) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }

  if (req.method === 'POST' && !match[1]) {
    const project = await createExternalProject(await readJson(req));
    sendJson(res, 201, project);
    return;
  }
  if (req.method === 'GET' && !match[1]) {
    sendJson(res, 200, await listExternalProjects());
    return;
  }
  if (req.method === 'GET' && match[1]) {
    const project = await getExternalProject(decodeURIComponent(match[1]));
    if (!project) {
      sendJson(res, 404, { error: 'project not found' });
      return;
    }
    sendJson(res, 200, project);
    return;
  }
  sendJson(res, 405, { error: 'method not allowed' });
}
