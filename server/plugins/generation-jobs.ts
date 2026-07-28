import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { readStore, setStoredEntry } from './project-store.ts';

export type GenerationJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface GenerationResult {
  assetId: string;
  kind: 'audio' | 'video' | 'image';
  name: string;
  path: string;
  durationSeconds: number;
  width?: number;
  height?: number;
  fps?: number;
  /** Offset of a ranged export within the source timeline. */
  sourceStartSeconds?: number;
  // 导出/渲染 job 复用同一队列：可选字段，让渲染产物自描述大小与编码（生成类 job 不填）。
  sizeBytes?: number;
  codec?: string;
}

interface GenerationJob {
  id: string;
  status: GenerationJobStatus;
  progress: number;
  phase?: string;
  processedFrames?: number;
  totalFrames?: number;
  params: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  result?: GenerationResult;
  results?: GenerationResult[];
  error?: string;
  cleanupResult?: (result: GenerationResult) => Promise<void> | void;
  retentionMs: number;
  expiryTimer?: NodeJS.Timeout;
}

interface PersistedGenerationJob extends GenerationJobSnapshot {
  jobId: string;
  type: string;
  projectId?: string;
}

export interface GenerationJobSnapshot {
  id: string;
  status: GenerationJobStatus;
  progress: number;
  phase?: string;
  processedFrames?: number;
  totalFrames?: number;
  params: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  result?: GenerationResult;
  results?: GenerationResult[];
  error?: string;
}

export interface GenerationJobProgress {
  progress?: number;
  phase?: string;
  processedFrames?: number;
  totalFrames?: number;
}

export type UpdateGenerationJob = (progress: GenerationJobProgress) => void;

export interface GenerationJobOptions {
  /** Keep the job queued until a permit for expensive local work is available. */
  acquire?: () => Promise<() => void>;
  /** Dispose temporary output when a terminal job is deleted or expires. */
  cleanupResult?: (result: GenerationResult) => Promise<void> | void;
  /** Terminal-job retention window. Override only for focused tests. */
  retentionMs?: number;
}

const jobs = new Map<string, GenerationJob>();
const TERMINAL = new Set<GenerationJobStatus>(['succeeded', 'failed']);
const MAX_JOB_AGE_MS = 60 * 60_000;
const PERSISTENCE_KEY = 'jobs:server';
const INTERRUPTION_ERROR = 'job interrupted by process restart; automatic resume is not supported';
let persistenceEnabled = false;
let persistenceWrites = Promise.resolve();

function jobType(params: Record<string, unknown>): string {
  return typeof params.kind === 'string' && params.kind.trim() ? params.kind : 'unknown';
}

function projectIdOf(params: Record<string, unknown>): string | undefined {
  return typeof params.projectId === 'string' && params.projectId.trim() ? params.projectId : undefined;
}

function snapshotOf(job: GenerationJob): GenerationJobSnapshot {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    phase: job.phase,
    processedFrames: job.processedFrames,
    totalFrames: job.totalFrames,
    params: job.params,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    result: job.result,
    results: job.results,
    error: job.error,
  };
}

function persistedOf(job: GenerationJob): PersistedGenerationJob {
  return { ...snapshotOf(job), jobId: job.id, type: jobType(job.params), ...(projectIdOf(job.params) ? { projectId: projectIdOf(job.params) } : {}) };
}

function isPersistedGenerationJob(value: unknown): value is PersistedGenerationJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as Partial<PersistedGenerationJob>;
  return typeof job.jobId === 'string'
    && typeof job.type === 'string'
    && (job.status === 'queued' || job.status === 'running' || job.status === 'succeeded' || job.status === 'failed')
    && typeof job.createdAt === 'number'
    && typeof job.updatedAt === 'number'
    && typeof job.progress === 'number'
    && !!job.params && typeof job.params === 'object' && !Array.isArray(job.params);
}

function queuePersistence(action: () => Promise<void>): void {
  if (!persistenceEnabled) return;
  persistenceWrites = persistenceWrites.then(action, action).catch((error) => {
    console.warn(`[generation-job] persistence failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}

function persistJob(job: GenerationJob): void {
  const stored = persistedOf(job);
  queuePersistence(async () => {
    const current = await readStore();
    const records = Array.isArray(current.entries[PERSISTENCE_KEY])
      ? current.entries[PERSISTENCE_KEY].filter(isPersistedGenerationJob)
      : [];
    await setStoredEntry(PERSISTENCE_KEY, [stored, ...records.filter((entry) => entry.jobId !== stored.jobId)]);
  });
}

function removePersistedJob(jobId: string): void {
  queuePersistence(async () => {
    const current = await readStore();
    const records = Array.isArray(current.entries[PERSISTENCE_KEY])
      ? current.entries[PERSISTENCE_KEY].filter(isPersistedGenerationJob)
      : [];
    await setStoredEntry(PERSISTENCE_KEY, records.filter((entry) => entry.jobId !== jobId));
  });
}

/** Initialize durable state from the project-store volume. Safe to call more than once. */
export async function initializeGenerationJobStore(force = false): Promise<void> {
  if (persistenceEnabled && !force) return;
  if (force) {
    for (const job of jobs.values()) if (job.expiryTimer) clearTimeout(job.expiryTimer);
    jobs.clear();
  }
  persistenceEnabled = true;
  const store = await readStore();
  const records = Array.isArray(store.entries[PERSISTENCE_KEY])
    ? store.entries[PERSISTENCE_KEY].filter(isPersistedGenerationJob)
    : [];
  let recoveredInterrupted = false;
  for (const record of records) {
    const interrupted = record.status === 'queued' || record.status === 'running';
    const job: GenerationJob = {
      id: record.jobId,
      status: interrupted ? 'failed' : record.status,
      progress: interrupted ? 100 : record.progress,
      phase: interrupted ? 'interrupted' : record.phase,
      processedFrames: record.processedFrames,
      totalFrames: record.totalFrames,
      params: record.params,
      createdAt: record.createdAt,
      updatedAt: interrupted ? Date.now() : record.updatedAt,
      result: record.result,
      results: record.results,
      error: interrupted ? INTERRUPTION_ERROR : record.error,
      retentionMs: MAX_JOB_AGE_MS,
    };
    jobs.set(job.id, job);
    if (interrupted) recoveredInterrupted = true;
    else scheduleExpiry(job);
  }
  if (recoveredInterrupted) {
    for (const job of jobs.values()) if (job.phase === 'interrupted') persistJob(job);
  }
}

/** Wait for queued durable writes; used by focused lifecycle verification. */
export async function flushGenerationJobPersistence(): Promise<void> {
  await persistenceWrites;
}

function normalizeRetentionMs(value: number | undefined): number {
  return Number.isFinite(value) && Number(value) >= 0 ? Number(value) : MAX_JOB_AGE_MS;
}

function scheduleExpiry(job: GenerationJob): void {
  if (!TERMINAL.has(job.status)) return;
  if (job.expiryTimer) clearTimeout(job.expiryTimer);
  job.expiryTimer = setTimeout(() => { void evictTerminalJob(job.id); }, job.retentionMs);
  job.expiryTimer.unref?.();
}

async function evictTerminalJob(jobId: string): Promise<boolean> {
  const job = jobs.get(jobId);
  if (!job || !TERMINAL.has(job.status)) return false;
  jobs.delete(jobId);
  if (job.expiryTimer) clearTimeout(job.expiryTimer);
  removePersistedJob(jobId);
  if (job.results?.length && job.cleanupResult) {
    try {
      await Promise.all(job.results.map((result) => job.cleanupResult!(result)));
    } catch (error) {
      console.warn(`[generation-job] failed to clean result for ${jobId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return true;
}

function applyProgress(job: GenerationJob, next: GenerationJobProgress): void {
  if (TERMINAL.has(job.status)) return;
  if (next.progress !== undefined && Number.isFinite(next.progress)) {
    job.progress = Math.max(job.progress, Math.min(99, Math.max(0, next.progress)));
  }
  if (next.phase !== undefined) job.phase = next.phase;
  if (next.totalFrames !== undefined && Number.isFinite(next.totalFrames)) {
    job.totalFrames = Math.max(0, Math.floor(next.totalFrames));
  }
  if (next.processedFrames !== undefined && Number.isFinite(next.processedFrames)) {
    const processed = Math.max(0, Math.floor(next.processedFrames));
    job.processedFrames = job.totalFrames === undefined ? processed : Math.min(job.totalFrames, processed);
  }
  job.updatedAt = Date.now();
  persistJob(job);
}

async function runGenerationJob(
  job: GenerationJob,
  task: (jobId: string, update: UpdateGenerationJob) => Promise<GenerationResult | GenerationResult[]>,
  options: GenerationJobOptions,
): Promise<void> {
  let release: (() => void) | undefined;
  try {
    release = await options.acquire?.();
    job.status = 'running';
    job.progress = 10;
    job.phase = 'starting';
    job.updatedAt = Date.now();
    persistJob(job);
    const returned = await task(job.id, (next) => applyProgress(job, next));
    job.results = Array.isArray(returned) ? returned : [returned];
    job.result = job.results[0];
    job.status = 'succeeded';
    job.progress = 100;
    job.phase = 'completed';
    if (job.totalFrames !== undefined) job.processedFrames = job.totalFrames;
  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : String(error);
    job.progress = 100;
    job.phase = 'failed';
  } finally {
    job.updatedAt = Date.now();
    release?.();
    persistJob(job);
    scheduleExpiry(job);
  }
}

export function createGenerationJob(
  params: Record<string, unknown>,
  task: (jobId: string, update: UpdateGenerationJob) => Promise<GenerationResult | GenerationResult[]>,
  options: GenerationJobOptions = {},
): { jobId: string; status: 'queued' } {
  const id = randomUUID();
  const now = Date.now();
  const job: GenerationJob = {
    id,
    status: 'queued',
    progress: 0,
    phase: 'queued',
    params,
    createdAt: now,
    updatedAt: now,
    cleanupResult: options.cleanupResult,
    retentionMs: normalizeRetentionMs(options.retentionMs),
  };
  jobs.set(id, job);
  persistJob(job);
  void runGenerationJob(job, task, options);
  return { jobId: id, status: 'queued' };
}

export function getGenerationJobSnapshot(jobId: string): GenerationJobSnapshot | undefined {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  return snapshotOf(job);
}

/** Remove a finished job after a one-shot consumer has downloaded its result. */
export function deleteGenerationJob(jobId: string): Promise<boolean> {
  return evictTerminalJob(jobId);
}

interface ProgressRequest {
  action?: 'params' | 'status' | 'wait';
  target?: string;
  jobIds?: string[] | string;
  timeoutSeconds?: number;
}

async function readJson(req: IncomingMessage): Promise<ProgressRequest> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > 100_000) throw new Error('request body too large');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ProgressRequest;
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function parseJobIds(value: ProgressRequest['jobIds']): string[] {
  const ids = Array.isArray(value) ? value : String(value ?? '').split(',');
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function report(job: GenerationJob, action: ProgressRequest['action']) {
  return {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    phase: job.phase,
    processedFrames: job.processedFrames,
    totalFrames: job.totalFrames,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(action === 'params' ? { params: job.params } : {}),
    ...(job.result ? { result: job.result } : {}),
    ...(job.results && job.results.length > 1 ? { results: job.results } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

const wait = (milliseconds: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

export function generationProgressPlugin(): Plugin {
  return {
    name: 'openchatcut-generation-progress',
    async configureServer(server) {
      await initializeGenerationJobStore();
      server.middlewares.use('/generate/progress', async (req, res) => {
        if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed — use POST' }); return; }
        try {
          const input = await readJson(req);
          if (input.target !== 'generation') throw new Error('target must be generation');
          if (!input.action || !['params', 'status', 'wait'].includes(input.action)) throw new Error('action must be params, status, or wait');
          const jobIds = parseJobIds(input.jobIds);
          if (!jobIds.length) throw new Error('jobIds is required');
          const timeoutSeconds = input.timeoutSeconds ?? 90;
          if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0 || timeoutSeconds > 3600) throw new Error('timeoutSeconds must be between 0 and 3600');

          if (input.action === 'wait') {
            const deadline = Date.now() + timeoutSeconds * 1000;
            while (Date.now() < deadline) {
              const known = jobIds.map((id) => jobs.get(id));
              if (known.every((job) => !job || TERMINAL.has(job.status))) break;
              await wait(250);
            }
          }

          const reports = jobIds.map((id) => {
            const job = jobs.get(id);
            return job ? report(job, input.action) : { jobId: id, status: 'not_found', error: 'generation job not found' };
          });
          sendJson(res, 200, { target: 'generation', action: input.action, reports });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          server.config.logger.error(`[generate:progress] ${message}`);
          sendJson(res, 400, { error: message });
        }
      });
    },
  };
}
