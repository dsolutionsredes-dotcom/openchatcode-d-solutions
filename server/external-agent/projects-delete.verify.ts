import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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
  const { createExternalProject, deleteExternalProject, listExternalProjects } = await import('./projects.ts');
  const created = await createExternalProject({ name: 'delete-test-only' });
  assert.ok((await listExternalProjects()).some((project) => project.id === created.id));
  assert.equal(await deleteExternalProject(created.id), true);
  assert.equal((await listExternalProjects(true)).some((project) => project.id === created.id), false);
  assert.equal(await deleteExternalProject(created.id), false);
  console.log('projects-delete.verify: ok');
} finally {
  if (previous.OPENCHATCUT_DATA_DIR === undefined) delete process.env.OPENCHATCUT_DATA_DIR;
  else process.env.OPENCHATCUT_DATA_DIR = previous.OPENCHATCUT_DATA_DIR;
  if (previous.OPENCHATCUT_DEV_PROFILE_ID === undefined) delete process.env.OPENCHATCUT_DEV_PROFILE_ID;
  else process.env.OPENCHATCUT_DEV_PROFILE_ID = previous.OPENCHATCUT_DEV_PROFILE_ID;
  await rm(root, { recursive: true, force: true });
}
