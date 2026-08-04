import { randomUUID } from 'node:crypto';
import { readStore, setStoredEntry } from '../plugins/project-store.ts';
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
}

interface StoredProjectDoc {
  version: unknown;
  assets: ExternalProjectAsset[];
  mediaFolders: unknown[];
  timelines: unknown[];
  activeTimelineId: string;
  [key: string]: unknown;
}

export async function getExternalProject(projectId: string): Promise<ProjectMeta | undefined> {
  return (await listExternalProjects()).find((project) => project.id === projectId);
}

/** Load the persisted document used by the editor; callers must still treat it as immutable. */
export async function loadExternalProjectDoc(projectId: string): Promise<StoredProjectDoc | undefined> {
  const store = await readStore();
  const meta = projectMetas(store.entries.projects).find((project) => project.id === projectId && !project.deletedAt);
  const doc = store.entries[`project:${projectId}`];
  return meta && isProjectDoc(doc) ? doc : undefined;
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
