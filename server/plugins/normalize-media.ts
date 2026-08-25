// POST /api/normalize-media — compatibility normalization with opt-in media optimization.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { extname } from 'node:path';
import { isSafeUploadName, resolveUploadFile, uploadDir } from '../media-dir.ts';
import {
  NormalizeAdmissionFullError,
  type NormalizeAdmission,
  type NormalizeEncodeContext,
} from '../media-normalization.ts';
import {
  normalizeMediaFile,
  NormalizeMediaProbeError,
  type NormalizeMediaFileResult,
} from '../media-normalization-runner.ts';

export {
  createNormalizeAdmission,
  createNormalizeTempPath,
  isVariableFrameRate,
  parseFrameRate,
  playableDurationSeconds,
  resolveNormalizeOutputPath,
  resolveNormalizeTargetKey,
  resolveStreamPlan,
  resolveTargetFps,
} from '../media-normalization.ts';
export type { NormalizeEncodeContext } from '../media-normalization.ts';

const MAX_JSON = 8 * 1024;
const VIDEO_EXTENSIONS: Record<string, true> = {
  '.mp4': true,
  '.mov': true,
  '.webm': true,
  '.mkv': true,
  '.m4v': true,
  '.avi': true,
  '.mpeg': true,
  '.mpg': true,
};
const PASSTHROUGH_EXTENSIONS: Record<string, true> = {
  '.jpg': true,
  '.jpeg': true,
  '.png': true,
  '.gif': true,
  '.webp': true,
  '.svg': true,
  '.mp3': true,
  '.wav': true,
  '.m4a': true,
  '.aac': true,
  '.ogg': true,
  '.flac': true,
  '.opus': true,
  '.cube': true,
  '.json': true,
};

export interface NormalizeMediaPluginOptions {
  readonly admission?: NormalizeAdmission;
  readonly encoderHook?: (
    context: NormalizeEncodeContext,
    encode: () => Promise<void>,
  ) => Promise<void>;
}

export interface NormalizeUploadedMediaOptions extends NormalizeMediaPluginOptions {
  readonly signal?: AbortSignal;
  readonly force?: boolean;
  readonly optimize?: boolean;
  readonly forceCfr?: boolean;
  readonly targetFps?: number;
  readonly logInfo?: (message: string) => void;
  readonly logError?: (message: string) => void;
}

export interface NormalizedUploadedMedia {
  readonly path: string;
  readonly normalized: boolean;
  readonly reason: string;
  readonly bytes?: number;
  readonly bytesBefore?: number;
  readonly width?: number;
  readonly height?: number;
  readonly durationSeconds?: number;
  readonly videoFrameCount?: number;
  readonly fps?: number;
  readonly variableFrameRate?: boolean;
}

interface NormalizeRequestBody {
  readonly src?: string;
  readonly force?: boolean;
  readonly optimize?: boolean;
  readonly forceCfr?: boolean;
  readonly targetFps?: number;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage, max = MAX_JSON): Promise<unknown> {
  const deferred = Promise.withResolvers<unknown>();
  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > max) {
      deferred.reject(new Error('body too large'));
      req.destroy();
    } else {
      chunks.push(chunk);
    }
  });
  req.on('end', () => {
    try {
      deferred.resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
    } catch (error) {
      deferred.reject(error);
    }
  });
  req.on('error', deferred.reject);
  return deferred.promise;
}

function uploadNameFromSrc(src: string): string | null {
  const clean = decodeURIComponent((src.split('?')[0] ?? '').trim());
  const match = clean.match(/^\/media\/uploads\/([^/]+)$/);
  if (!match) return null;
  return isSafeUploadName(match[1]) ? match[1] : null;
}

function bindRequestAbort(req: IncomingMessage, res: ServerResponse): {
  readonly signal: AbortSignal;
  readonly dispose: () => void;
} {
  const controller = new AbortController();
  const abort = (): void => controller.abort(new DOMException('normalize request closed', 'AbortError'));
  const close = (): void => { if (!res.writableEnded) abort(); };
  req.once('aborted', abort);
  res.once('close', close);
  return {
    signal: controller.signal,
    dispose: () => {
      req.removeListener('aborted', abort);
      res.removeListener('close', close);
    },
  };
}

function isPassthrough(name: string): boolean {
  return name.includes('.asr.') || extname(name).toLowerCase() in PASSTHROUGH_EXTENSIONS;
}

/**
 * Normalize an uploaded media source without going through the HTTP route.
 * The route below delegates here too, so server-side imports and browser
 * requests share exactly the same validation and FFmpeg normalization logic.
 */
export async function normalizeUploadedMedia(
  src: string,
  options: NormalizeUploadedMediaOptions = {},
): Promise<NormalizedUploadedMedia> {
  const name = uploadNameFromSrc(src);
  if (!name) throw new Error('src must be /media/uploads/<safe-name>');
  const inputPath = resolveUploadFile(name);
  if (!inputPath) throw new Error(`media not found: ${name}`);
  const extension = extname(name).toLowerCase();
  if (isPassthrough(name)) {
    return { path: src, normalized: false, reason: 'not a video master' };
  }
  if (!(extension in VIDEO_EXTENSIONS) && !options.force) {
    return { path: src, normalized: false, reason: 'skip non-video extension' };
  }
  const result: NormalizeMediaFileResult = await normalizeMediaFile({
    inputPath,
    publicSrc: src,
    force: options.force,
    optimize: options.optimize,
    forceCfr: options.forceCfr,
    targetFps: options.targetFps,
    signal: options.signal,
    admission: options.admission,
    encoderHook: options.encoderHook,
    publishR2: true,
    uploadsDirectory: uploadDir(),
    logInfo: options.logInfo,
    logError: options.logError,
  });
  return {
    path: result.path,
    normalized: result.normalized,
    reason: result.reason,
    bytes: result.bytes,
    bytesBefore: result.bytesBefore,
    width: result.width,
    height: result.height,
    durationSeconds: result.durationSeconds,
    videoFrameCount: result.videoFrameCount,
    fps: result.sourceFps,
    variableFrameRate: result.variableFrameRate,
  };
}

function sendNormalizeError(
  res: ServerResponse,
  error: unknown,
  log: (message: string) => void,
): void {
  if (error instanceof NormalizeAdmissionFullError) {
    sendJson(res, 429, { error: error.message, code: 'NORMALIZE_QUEUE_FULL' });
    return;
  }
  if (error instanceof NormalizeMediaProbeError) {
    sendJson(res, 422, { error: error.message, code: 'MEDIA_PROBE_FAILED' });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  log(`[normalize-media] ${message}`);
  const status = /ENOENT|spawn .*ffmpeg|spawn .*ffprobe/i.test(message) ? 503 : 500;
  sendJson(res, status, { error: message });
}

async function normalizeVideoRequest(
  req: IncomingMessage,
  res: ServerResponse,
  src: string,
  body: NormalizeRequestBody,
  options: NormalizeMediaPluginOptions,
  logger: { info(message: string): void; error(message: string): void },
): Promise<void> {
  const abort = bindRequestAbort(req, res);
  try {
    const result = await normalizeUploadedMedia(src, {
      ...options,
      force: body.force,
      optimize: body.optimize,
      forceCfr: body.forceCfr,
      targetFps: body.targetFps,
      signal: abort.signal,
      logInfo: (message) => logger.info(message),
      logError: (message) => logger.error(message),
    });
    if (!abort.signal.aborted) {
      sendJson(res, 200, {
        ok: true,
        path: result.path,
        normalized: result.normalized,
        reason: result.reason,
        bytes: result.bytes,
        bytesBefore: result.bytesBefore,
        width: result.width,
        height: result.height,
        durationSeconds: result.durationSeconds,
        videoFrameCount: result.videoFrameCount,
        fps: result.fps,
        variableFrameRate: result.variableFrameRate,
      });
    }
  } catch (error) {
    if (!abort.signal.aborted) {
      sendNormalizeError(res, error, (message) => logger.error(message));
    }
  } finally {
    abort.dispose();
  }
}


async function handleNormalizeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: NormalizeMediaPluginOptions,
  logger: { info(message: string): void; error(message: string): void },
): Promise<void> {
  const body = (await readJson(req)) as NormalizeRequestBody;
  const src = String(body.src ?? '').trim();
  try {
    await normalizeVideoRequest(req, res, src, body, options, logger);
  } catch (error) {
    sendNormalizeError(res, error, (message) => logger.error(message));
  }
}

export function normalizeMediaPlugin(options: NormalizeMediaPluginOptions = {}): Plugin {
  return {
    name: 'openchatcut-normalize-media',
    configureServer(server) {
      server.middlewares.use('/api/normalize-media', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'method not allowed — use POST' });
          return;
        }
        await handleNormalizeRequest(req, res, options, server.config.logger);
      });
    },
  };
}
