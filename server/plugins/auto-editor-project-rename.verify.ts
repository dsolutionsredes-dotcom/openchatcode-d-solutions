import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'openchatcut-auto-editor-project-rename-'));
const previous = {
  OPENCHATCUT_DATA_DIR: process.env.OPENCHATCUT_DATA_DIR,
  OPENCHATCUT_DEV_PROFILE_ID: process.env.OPENCHATCUT_DEV_PROFILE_ID,
};
process.env.OPENCHATCUT_DATA_DIR = root;
delete process.env.OPENCHATCUT_DEV_PROFILE_ID;
try {
  const { createExternalProject, deleteExternalProject } = await import('../external-agent/projects.ts');
  const { renameExternalProjectWith } = await import('./auto-editor.ts');
  const created = await createExternalProject({ name: 'before rename' });
  const renamed = await renameExternalProjectWith({ projectId: created.id, name: 'after rename' });
  assert.equal(renamed.ok, true);
  assert.equal(renamed.status, 'applied');
  assert.equal(renamed.action, 'project_rename');
  assert.equal(renamed.projectId, created.id);
  assert.equal((renamed.data as { project: { id: string; name: string } }).project.id, created.id);
  assert.equal((renamed.data as { project: { id: string; name: string } }).project.name, 'after rename');

  const missing = await renameExternalProjectWith({ projectId: 'missing-project', name: 'unused' });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 'not_found');
  assert.equal(missing.errorCode, 'project_not_found');
  await assert.rejects(renameExternalProjectWith({ projectId: created.id, name: '  ' }), /name is required/);
  assert.equal(await deleteExternalProject(created.id), true);
  console.log('auto-editor-project-rename.verify: ok');
} finally {
  if (previous.OPENCHATCUT_DATA_DIR === undefined) delete process.env.OPENCHATCUT_DATA_DIR;
  else process.env.OPENCHATCUT_DATA_DIR = previous.OPENCHATCUT_DATA_DIR;
  if (previous.OPENCHATCUT_DEV_PROFILE_ID === undefined) delete process.env.OPENCHATCUT_DEV_PROFILE_ID;
  else process.env.OPENCHATCUT_DEV_PROFILE_ID = previous.OPENCHATCUT_DEV_PROFILE_ID;
  await rm(root, { recursive: true, force: true });
}
