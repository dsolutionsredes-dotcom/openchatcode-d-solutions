import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'openchatcut-project-rename-'));
const previous = {
  OPENCHATCUT_DATA_DIR: process.env.OPENCHATCUT_DATA_DIR,
  OPENCHATCUT_DEV_PROFILE_ID: process.env.OPENCHATCUT_DEV_PROFILE_ID,
};
process.env.OPENCHATCUT_DATA_DIR = root;
delete process.env.OPENCHATCUT_DEV_PROFILE_ID;
try {
  const { createExternalProject, renameExternalProject } = await import('./projects.ts');
  const created = await createExternalProject({ name: 'before', description: 'kept' });
  const renamed = await renameExternalProject(created.id, 'after');
  assert.ok(renamed);
  assert.equal(renamed.id, created.id);
  assert.equal(renamed.name, 'after');
  assert.equal(renamed.description, 'kept');
  assert.equal(await renameExternalProject('missing-project', 'after'), null);
  await assert.rejects(renameExternalProject(created.id, '   '), /Project name is required/);
  console.log('projects-rename.verify: ok');
} finally {
  if (previous.OPENCHATCUT_DATA_DIR === undefined) delete process.env.OPENCHATCUT_DATA_DIR;
  else process.env.OPENCHATCUT_DATA_DIR = previous.OPENCHATCUT_DATA_DIR;
  if (previous.OPENCHATCUT_DEV_PROFILE_ID === undefined) delete process.env.OPENCHATCUT_DEV_PROFILE_ID;
  else process.env.OPENCHATCUT_DEV_PROFILE_ID = previous.OPENCHATCUT_DEV_PROFILE_ID;
  await rm(root, { recursive: true, force: true });
}
