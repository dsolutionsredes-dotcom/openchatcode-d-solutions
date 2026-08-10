import { readStore, setStoredEntry } from '../plugins/project-store.ts';
import { getExternalProject } from './projects.ts';

export interface ProjectDriveContext {
  projectId: string;
  driveFolderId: string;
  originalsFolderId: string;
  updatedAt: number;
}

const KEY = 'external-project-drive-contexts';
const DRIVE_ID = /^[a-zA-Z0-9_-]{8,200}$/;

function contexts(value: unknown): ProjectDriveContext[] {
  return Array.isArray(value) ? value.filter((item): item is ProjectDriveContext => (
    !!item && typeof item === 'object'
    && typeof (item as ProjectDriveContext).projectId === 'string'
    && typeof (item as ProjectDriveContext).driveFolderId === 'string'
    && typeof (item as ProjectDriveContext).originalsFolderId === 'string'
    && typeof (item as ProjectDriveContext).updatedAt === 'number'
  )) : [];
}

export async function getProjectDriveContext(projectId: string): Promise<ProjectDriveContext | undefined> {
  return contexts((await readStore()).entries[KEY]).find((item) => item.projectId === projectId);
}

/** Maps a persistent OpenChatCode project to its human-readable Drive folders. */
export async function setProjectDriveContext(
  projectId: string,
  driveFolderId: string,
  originalsFolderId: string,
): Promise<ProjectDriveContext | undefined> {
  if (!DRIVE_ID.test(driveFolderId) || !DRIVE_ID.test(originalsFolderId) || !await getExternalProject(projectId)) return undefined;
  const store = await readStore();
  const next: ProjectDriveContext = { projectId, driveFolderId, originalsFolderId, updatedAt: Date.now() };
  await setStoredEntry(KEY, [next, ...contexts(store.entries[KEY]).filter((item) => item.projectId !== projectId)]);
  return next;
}
