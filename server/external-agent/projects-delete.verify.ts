import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, access, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'openchatcut-project-delete-'));
const previous = {
  OPENCHATCUT_DATA_DIR: process.env.OPENCHATCUT_DATA_DIR,
  OPENCHATCUT_DEV_PROFILE_ID: process.env.OPENCHATCUT_DEV_PROFILE_ID,
};
process.env.OPENCHATCUT_DATA_DIR = root;
delete process.env.OPENCHATCUT_DEV_PROFILE_ID;
try {
  const { createExternalProject, deleteExternalProject, deleteExternalProjectWithMedia, listExternalProjects } = await import('./projects.ts');
  const created = await createExternalProject({ name: 'delete-test-only' });
  assert.ok((await listExternalProjects()).some((project) => project.id === created.id));
  assert.equal(await deleteExternalProject(created.id), true);
  assert.equal((await listExternalProjects(true)).some((project) => project.id === created.id), false);
  assert.equal(await deleteExternalProject(created.id), false);

  const source = await createExternalProject({ name: 'media-owner' });
  const shared = await createExternalProject({ name: 'media-sharer' });
  const media = join(root, 'media', 'uploads');
  await mkdir(media, { recursive: true });
  await mkdir(join(media, '.preview'), { recursive: true });
  await writeFile(join(media, 'exclusive.mp4'), 'exclusive');
  await writeFile(join(media, 'shared.mp4'), 'shared');
  await writeFile(join(media, '.preview', 'exclusive.mp4.preview-v3-1-1.peaks.json'), '{}');
  const store = await import('../plugins/project-store.ts');
  await store.setStoredEntry(`project:${source.id}`, { assets: [{ src: '/media/uploads/exclusive.mp4' }, { src: '/media/uploads/shared.mp4' }], timelines: [] });
  await store.setStoredEntry(`project:${shared.id}`, { assets: [{ src: '/media/uploads/shared.mp4' }], timelines: [] });
  const result = await deleteExternalProjectWithMedia(source.id);
  assert.equal(result.deleted, true);
  assert.equal(result.mediaDeleted, 1);
  assert.equal(result.previewsDeleted, 1);
  await assert.rejects(access(join(media, 'exclusive.mp4')));
  await assert.rejects(access(join(media, '.preview', 'exclusive.mp4.preview-v3-1-1.peaks.json')));
  await access(join(media, 'shared.mp4'));
  console.log('projects-delete.verify: ok');
} finally {
  if (previous.OPENCHATCUT_DATA_DIR === undefined) delete process.env.OPENCHATCUT_DATA_DIR;
  else process.env.OPENCHATCUT_DATA_DIR = previous.OPENCHATCUT_DATA_DIR;
  if (previous.OPENCHATCUT_DEV_PROFILE_ID === undefined) delete process.env.OPENCHATCUT_DEV_PROFILE_ID;
  else process.env.OPENCHATCUT_DEV_PROFILE_ID = previous.OPENCHATCUT_DEV_PROFILE_ID;
  await rm(root, { recursive: true, force: true });
}
