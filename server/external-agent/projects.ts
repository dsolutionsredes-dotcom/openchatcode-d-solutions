import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { purgeProjectPermanently, readStore, setStoredEntry } from '../plugins/project-store.ts';
import { deleteMediaPreviewDerivatives } from '../plugins/media-preview.ts';
import { isSafeUploadName, uploadReadDirs } from '../media-dir.ts';
import { deleteUploadObject } from '../r2.ts';
import { CURRENT_PROJECT_VERSION } from '../../shared/project-version.ts';

const MEDIA_PREFIX = '/media/uploads/';

interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
  deletedAt?: number;
  description?: string;
}

function projectMetas(value: unknown): ProjectMeta[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ProjectMeta => (
    !!entry
    && typeof entry === 'object'
    && typeof (entry as ProjectMeta).id === 'string'
    && typeof (entry as ProjectMeta).name === 'string'
    && typeof (entry as ProjectMeta).updatedAt === 'number'
  ));
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

function emptyProject(args: Record<string, unknown>): unknown {
  const timelineId = `tl_${randomUUID()}`;
  const timeline = {
    id: timelineId,
    name: '序列 1',
    order: 0,
    fps: positiveNumber(args.fps, 30),
    width: positiveNumber(args.compositionWidth, 1920),
    height: positiveNumber(args.compositionHeight, 1080),
    items: [],
    selectedId: null,
    trackOrder: ['track_v1'],
    tracks: { track_v1: { kind: 'video' } },
  };
  return {
    version: CURRENT_PROJECT_VERSION,
    assets: [],
    mediaFolders: [],
    timelines: [timeline],
    activeTimelineId: timelineId,
  };
}

export async function listExternalProjects(includeDeleted = false): Promise<ProjectMeta[]> {
  const store = await readStore();
  return projectMetas(store.entries.projects)
    .filter((project) => includeDeleted || !project.deletedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function uploadSrcsIn(value: unknown): string[] {
  let text: string;
  try { text = typeof value === 'string' ? value : JSON.stringify(value); }
  catch { return []; }
  const found = new Set<string>();
  for (const [, rawName] of text.matchAll(/\/media\/uploads\/([^"'\\/\s?#]+)/g)) {
    const name = decodeURIComponent(rawName);
    if (isSafeUploadName(name)) found.add(`${MEDIA_PREFIX}${name}`);
  }
  return [...found];
}

export interface ExternalProjectDeleteResult {
  readonly deleted: boolean;
  readonly mediaDeleted: number;
  readonly previewsDeleted: number;
}

/**
 * Permanently delete a project and only the media masters that no remaining
 * project references. Preview derivatives are removed with their master.
 */
export async function deleteExternalProjectWithMedia(
  projectId: string,
): Promise<ExternalProjectDeleteResult> {
  const exists = (await listExternalProjects(true)).some((project) => project.id === projectId);
  if (!exists) return { deleted: false, mediaDeleted: 0, previewsDeleted: 0 };

  const store = await readStore();
  const own = new Set(uploadSrcsIn(store.entries[`project:${projectId}`]));
  const retained = new Set<string>();
  for (const [key, value] of Object.entries(store.entries)) {
    if (!key.startsWith('project:') || key === `project:${projectId}`) continue;
    for (const src of uploadSrcsIn(value)) retained.add(src);
  }

  await purgeProjectPermanently(projectId);
  let mediaDeleted = 0;
  let previewsDeleted = 0;
  for (const src of own) {
    if (retained.has(src)) continue;
    const name = basename(src);
    for (const directory of uploadReadDirs()) {
      try {
        await unlink(join(directory, name));
        mediaDeleted += 1;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    await deleteUploadObject(name).catch(() => false);
    previewsDeleted += await deleteMediaPreviewDerivatives(name);
  }
  return { deleted: true, mediaDeleted, previewsDeleted };
}

/** Backward-compatible boolean deletion API. */
export async function deleteExternalProject(projectId: string): Promise<boolean> {
  return (await deleteExternalProjectWithMedia(projectId)).deleted;
}

export async function renameExternalProject(
  projectId: string,
  newName: string,
): Promise<ProjectMeta | null> {
  const name = newName.trim();
  if (!name) throw new Error('Project name is required.');

  const projects = await listExternalProjects(true);
  const index = projects.findIndex((project) => project.id === projectId);
  if (index < 0) return null;

  const renamed: ProjectMeta = {
    ...projects[index],
    name,
    updatedAt: Date.now(),
  };
  projects[index] = renamed;
  await setStoredEntry('projects', projects);
  return renamed;
}

export async function createExternalProject(
  args: Record<string, unknown>,
): Promise<ProjectMeta> {
  const name = String(args.name ?? '').trim() || 'External MCP Project';
  const description = String(args.description ?? '').trim();
  const meta: ProjectMeta = {
    id: randomUUID(),
    name,
    updatedAt: Date.now(),
    ...(description ? { description } : {}),
  };
  const projects = await listExternalProjects(true);
  await setStoredEntry(`project:${meta.id}`, emptyProject(args));
  await setStoredEntry('projects', [meta, ...projects]);
  return meta;
}
