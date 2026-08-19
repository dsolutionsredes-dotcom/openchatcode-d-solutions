import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, stat } from 'node:fs/promises';
import type { TimelineState } from '../../src/editor/types.ts';
import { exportDuration, exportScale } from '../plugins/export-plan.ts';
import { acquireExportPermit } from '../plugins/export-runtime.ts';
import { createGenerationJob, getGenerationJobSnapshot } from '../plugins/generation-jobs.ts';
import { uploadDir } from '../media-dir.ts';
// @ts-expect-error plain ESM render pipeline has no declaration file.
import { renderTimeline } from '../../remotion/render.mjs';
import { loadExternalProjectDoc } from './projects.ts';
import { loadExternalAgentRun, saveExternalAgentRun, type ExternalAgentRun } from './run-store.ts';

export type ExternalPreviewChoice = 'render' | 'schedule' | 'edit';

export class ExternalPreviewError extends Error {
  constructor(readonly code: 'RUN_NOT_FOUND' | 'PREVIEW_NOT_REQUESTED' | 'PREVIEW_CONFLICT' | 'PROJECT_EMPTY', message: string) {
    super(message);
  }
}

export function isExplicitPreviewRequest(message: string): boolean {
  const text = message.trim().toLocaleLowerCase('es');
  return /\b(?:preview|previsualizaci[oó]n)\b/.test(text)
    && !/\bno\s+(?:generes?|hacer|hagas?|crear|crees?)?\s*(?:un\s+)?(?:preview|previsualizaci[oó]n)\b/.test(text);
}

export function previewPrompt(): string {
  return 'El preview no se ha renderizado. Elige: renderizar ahora, programarlo o seguir editando.';
}

function response(run: ExternalAgentRun, idempotent: boolean) {
  return {
    runId: run.runId,
    projectId: run.projectId,
    previewStatus: run.previewStatus,
    preview: run.preview ?? null,
    requiresApproval: run.requiresApproval,
    approvalStatus: run.approvalStatus ?? null,
    idempotent,
    updatedAt: new Date(run.updatedAt).toISOString(),
  };
}

function activeState(doc: Awaited<ReturnType<typeof loadExternalProjectDoc>>): TimelineState {
  const timeline = doc?.timelines.find(
    (entry) => entry && typeof entry === 'object' && (entry as { id?: unknown }).id === doc.activeTimelineId,
  );
  if (!timeline || !Array.isArray((timeline as { items?: unknown }).items) || !(timeline as { items: unknown[] }).items.length) {
    throw new ExternalPreviewError('PROJECT_EMPTY', 'project timeline is empty');
  }
  return { ...(timeline as TimelineState), assets: doc.assets as TimelineState['assets'] };
}

/**
 * Prefer the unapproved proposal result. This is the actual continuous draft
 * the user has been editing. Fall back to the persisted project only when there
 * is no pending draft proposal.
 */
function previewState(run: ExternalAgentRun, doc: Awaited<ReturnType<typeof loadExternalProjectDoc>>): TimelineState {
  const result = run.proposal?.resultState;
  if (result) {
    if (!Array.isArray(result.items) || result.items.length === 0) {
      throw new ExternalPreviewError('PROJECT_EMPTY', 'draft timeline is empty');
    }
    return {
      ...result,
      assets: (result.assets?.length ? result.assets : run.proposal?.baseDoc.assets ?? doc?.assets ?? []) as TimelineState['assets'],
    };
  }
  return activeState(doc);
}

/** Starts a low-resolution preview only after an explicit Telegram choice. */
export async function chooseExternalPreview(runId: string, choice: ExternalPreviewChoice) {
  const run = await loadExternalAgentRun(runId);
  if (!run) throw new ExternalPreviewError('RUN_NOT_FOUND', 'run not found');
  if (run.previewStatus === 'ready' || run.previewStatus === 'rendering') return response(run, true);
  if (run.previewStatus !== 'awaiting-choice') {
    throw new ExternalPreviewError('PREVIEW_NOT_REQUESTED', 'run has no pending preview request');
  }

  if (choice === 'edit' || choice === 'schedule') {
    const next: ExternalAgentRun = {
      ...run,
      previewStatus: choice === 'edit' ? 'editing' : 'scheduled',
      requiresApproval: false,
      approvalStatus: undefined,
      assistantText: choice === 'edit'
        ? 'Perfecto, seguimos editando. Puedes enviar la siguiente modificación.'
        : 'Preview pendiente de programación. Indica cuándo quieres generarlo; mientras tanto puedes seguir editando.',
      updatedAt: Date.now(),
    };
    await saveExternalAgentRun(next);
    return response(next, false);
  }

  const doc = await loadExternalProjectDoc(run.projectId);
  const state = previewState(run, doc);

  const { jobId } = createGenerationJob(
    { kind: 'external-preview', projectId: run.projectId, runId, resolution: '480p' },
    async (_jobId, update) => {
      const filename = `telegram-preview-${runId}-${randomUUID()}.mp4`;
      const directory = uploadDir();
      await mkdir(directory, { recursive: true });
      const output = join(directory, filename);
      const frames = exportDuration(state);
      update({ phase: 'rendering', progress: 10, totalFrames: frames });

      await renderTimeline({
        state,
        outputLocation: output,
        codec: 'h264',
        scale: exportScale(state, '480p'),
        onProgress: (progress: number) => update({
          progress: 10 + Math.min(0.89, Math.max(0, progress)) * 89,
          processedFrames: Math.floor(frames * progress),
          totalFrames: frames,
        }),
      });

      const info = await stat(output);
      const completed = await loadExternalAgentRun(runId);
      if (completed) {
        await saveExternalAgentRun({
          ...completed,
          previewStatus: 'ready',
          preview: { jobId: _jobId, status: 'ready', path: `/media/uploads/${filename}`, sizeBytes: info.size },
          // Approval becomes available only after the draft preview is ready.
          requiresApproval: !!completed.proposal,
          approvalStatus: completed.proposal ? 'pending' : undefined,
          updatedAt: Date.now(),
        });
      }

      return {
        assetId: _jobId,
        kind: 'video' as const,
        name: filename,
        path: `/media/uploads/${filename}`,
        durationSeconds: frames / state.fps,
        sizeBytes: info.size,
        codec: 'h264',
      };
    },
    { acquire: acquireExportPermit },
  );

  const next: ExternalAgentRun = {
    ...run,
    previewStatus: 'rendering',
    preview: { jobId, status: 'queued' },
    requiresApproval: false,
    approvalStatus: undefined,
    assistantText: 'Generando preview de baja resolución…',
    updatedAt: Date.now(),
  };
  await saveExternalAgentRun(next);
  return response(next, false);
}

export async function refreshExternalPreview(run: ExternalAgentRun): Promise<ExternalAgentRun> {
  if (!run.preview?.jobId || run.previewStatus !== 'rendering') return run;
  const job = getGenerationJobSnapshot(run.preview.jobId);
  if (!job) return run;

  if (job.status === 'failed') {
    const failed: ExternalAgentRun = {
      ...run,
      previewStatus: 'failed',
      preview: { ...run.preview, status: 'failed', error: job.error },
      requiresApproval: false,
      approvalStatus: undefined,
      updatedAt: job.updatedAt,
    };
    await saveExternalAgentRun(failed);
    return failed;
  }

  if (job.status === 'succeeded' && job.result?.path) {
    const ready: ExternalAgentRun = {
      ...run,
      previewStatus: 'ready',
      preview: { ...run.preview, status: 'ready', path: job.result.path, sizeBytes: job.result.sizeBytes },
      requiresApproval: !!run.proposal,
      approvalStatus: run.proposal ? 'pending' : undefined,
      updatedAt: job.updatedAt,
    };
    await saveExternalAgentRun(ready);
    return ready;
  }

  return { ...run, preview: { ...run.preview, status: job.status }, updatedAt: job.updatedAt };
}
