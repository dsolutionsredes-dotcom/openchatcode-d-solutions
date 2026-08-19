import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { purgeProjectPermanently, readStore, setStoredEntry } from '../plugins/project-store.ts';
import { DEFAULT_UPLOAD_DIR, isSafeUploadName, uploadDir } from '../media-dir.ts';
import { CURRENT_PROJECT_VERSION } from '../../shared/project-version.ts';
import type { MediaKind } from '../../shared/media-kind.ts';

export interface ProjectMeta {
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

export interface ExternalProjectAsset {
  id: string;
  name: string;
  kind: MediaKind;
  src: string;
  durationInFrames: number;
  width?: number;
  height?: number;
}

/**
 * Read-only asset inventory for external coordinators (such as n8n).
 * This deliberately exposes only the media-pool fields needed to identify an
 * asset; it never returns a timeline, chat history, provider settings, or
 * secrets.
 */
export interface ExternalProjectAssetInventory {
  projectId: string;
  assets: ExternalProjectAsset[];
  assetCount: number;
}

export type ExternalProjectAssetDeletion =
  | {
    ok: true;
    projectId: string;
    asset: ExternalProjectAsset;
    storage: 'local_deleted' | 'local_not_found' | 'retained_shared' | 'not_managed';
  }
  | {
    ok: false;
    code: 'PROJECT_NOT_FOUND' | 'ASSET_NOT_FOUND' | 'ASSET_IN_USE';
    projectId: string;
    assetId: string;
    timelineIds?: string[];
  };

interface StoredProjectDoc {
  version: unknown;
  assets: ExternalProjectAsset[];
  mediaFolders: unknown[];
  timelines: unknown[];
  activeTimelineId: string;
  [key: string]: unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function timelineIdsUsingSource(doc: StoredProjectDoc, src: string): string[] {
  const ids: string[] = [];
  for (const timelineValue of doc.timelines) {
    const timeline = record(timelineValue);
    const items = Array.isArray(timeline?.items) ? timeline.items : [];
    if (items.some((itemValue) => {
      const item = record(itemValue);
      return item?.src === src || item?.denoisedSrc === src;
    })) ids.push(String(timeline?.id ?? 'unknown'));
  }
  return ids;
}

function sourceIsReferencedElsewhere(
  entries: Record<string, unknown>,
  projectId: string,
  assetId: string,
  src: string,
): boolean {
  for (const [key, value] of Object.entries(entries)) {
    if (!key.startsWith('project:') || !isProjectDoc(value)) continue;
    const ownerProjectId = key.slice('project:'.length);
    if (value.assets.some((asset) => (
      asset.src === src && !(ownerProjectId === projectId && asset.id === assetId)
    ))) return true;
    if (ownerProjectId !== projectId && timelineIdsUsingSource(value, src).length > 0) return true;
  }
  return false;
}

async function removeManagedLocalFile(src: string): Promise<'local_deleted' | 'local_not_found' | 'not_managed'> {
  const prefix = '/media/uploads/';
  if (!src.startsWith(prefix)) return 'not_managed';
  const name = src.slice(prefix.length);
  if (!isSafeUploadName(name)) return 'not_managed';

  const directories = [...new Set([uploadDir(), DEFAULT_UPLOAD_DIR])];
  let removed = false;
  for (const directory of directories) {
    try {
      await unlink(join(directory, name));
      removed = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return removed ? 'local_deleted' : 'local_not_found';
}

export async function getExternalProject(projectId: string): Promise<ProjectMeta | undefined> {
  return (await listExternalProjects()).find((project) => project.id === projectId);
}

/** Permanently remove a project and all project-scoped persisted data. */
export async function deleteExternalProject(projectId: string): Promise<boolean> {
  const exists = (await listExternalProjects(true)).some((project) => project.id === projectId);
  if (!exists) return false;
  await purgeProjectPermanently(projectId);
  return true;
}

/** Load the persisted document used by the editor; callers must still treat it as immutable. */
export async function loadExternalProjectDoc(projectId: string): Promise<StoredProjectDoc | undefined> {
  const store = await readStore();
  const meta = projectMetas(store.entries.projects).find((project) => project.id === projectId && !project.deletedAt);
  const doc = store.entries[`project:${projectId}`];
  return meta && isProjectDoc(doc) ? doc : undefined;
}

/** FPS of the active ProjectDoc timeline, when that timeline defines one. */
export async function getExternalProjectTimelineFps(projectId: string): Promise<number | undefined> {
  const doc = await loadExternalProjectDoc(projectId);
  if (!doc) return undefined;
  const timelines = doc.timelines.map(record).filter((timeline): timeline is Record<string, unknown> => !!timeline);
  const active = timelines.find((timeline) => String(timeline.id ?? '') === doc.activeTimelineId) ?? timelines[0];
  const fps = Number(active?.fps);
  return Number.isFinite(fps) && fps > 0 && fps <= 120 ? fps : undefined;
}

export async function getExternalProjectAssetInventory(
  projectId: string,
): Promise<ExternalProjectAssetInventory | undefined> {
  const doc = await loadExternalProjectDoc(projectId);
  if (!doc) return undefined;
  return {
    projectId,
    assets: doc.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      src: asset.src,
      durationInFrames: asset.durationInFrames,
    })),
    assetCount: doc.assets.length,
  };
}

/**
 * Remove one asset from an external project's media pool.
 * Timeline references block deletion so a coordinator cannot silently break an edit.
 * A local upload is removed only when no other persisted project still references it.
 */
export async function deleteExternalProjectAsset(
  projectId: string,
  assetId: string,
): Promise<ExternalProjectAssetDeletion> {
  const store = await readStore();
  const metas = projectMetas(store.entries.projects);
  const meta = metas.find((project) => project.id === projectId && !project.deletedAt);
  const current = store.entries[`project:${projectId}`];
  if (!meta || !isProjectDoc(current)) {
    return { ok: false, code: 'PROJECT_NOT_FOUND', projectId, assetId };
  }

  const asset = current.assets.find((item) => item.id === assetId);
  if (!asset) return { ok: false, code: 'ASSET_NOT_FOUND', projectId, assetId };

  const timelineIds = timelineIdsUsingSource(current, asset.src);
  if (timelineIds.length) {
    return { ok: false, code: 'ASSET_IN_USE', projectId, assetId, timelineIds };
  }

  const shared = sourceIsReferencedElsewhere(store.entries, projectId, assetId, asset.src);
  const storage = shared ? 'retained_shared' : await removeManagedLocalFile(asset.src);
  const next: StoredProjectDoc = {
    ...current,
    assets: current.assets.filter((item) => item.id !== assetId),
  };
  const updatedAt = Date.now();
  await setStoredEntry(`project:${projectId}`, next);
  await setStoredEntry('projects', metas.map((project) => (
    project.id === projectId ? { ...project, updatedAt } : project
  )));
  return { ok: true, projectId, asset, storage };
}

function isProjectDoc(value: unknown): value is StoredProjectDoc {
  return !!value
    && typeof value === 'object'
    && Array.isArray((value as StoredProjectDoc).assets)
    && Array.isArray((value as StoredProjectDoc).mediaFolders)
    && Array.isArray((value as StoredProjectDoc).timelines)
    && typeof (value as StoredProjectDoc).activeTimelineId === 'string';
}

/** Adds one pool asset to the already-persisted ProjectDoc. It never changes a timeline. */
export async function addExternalProjectAsset(
  projectId: string,
  asset: ExternalProjectAsset,
): Promise<ExternalProjectAsset | undefined> {
  const store = await readStore();
  const metas = projectMetas(store.entries.projects);
  const meta = metas.find((project) => project.id === projectId && !project.deletedAt);
  const current = store.entries[`project:${projectId}`];
  if (!meta || !isProjectDoc(current)) return undefined;

  const next: StoredProjectDoc = { ...current, assets: [...current.assets, asset] };
  const updatedAt = Date.now();
  await setStoredEntry(`project:${projectId}`, next);
  await setStoredEntry('projects', metas.map((project) => (
    project.id === projectId ? { ...project, updatedAt } : project
  )));
  return asset;
}

/** Persist a complete ProjectDoc produced by an approved external proposal. */
export async function saveExternalProjectDoc(projectId: string, doc: StoredProjectDoc): Promise<boolean> {
  const store = await readStore();
  const metas = projectMetas(store.entries.projects);
  if (!metas.some((project) => project.id === projectId && !project.deletedAt) || !isProjectDoc(doc)) return false;
  const updatedAt = Date.now();
  await setStoredEntry(`project:${projectId}`, doc);
  await setStoredEntry('projects', metas.map((project) => (
    project.id === projectId ? { ...project, updatedAt } : project
  )));
  return true;
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
