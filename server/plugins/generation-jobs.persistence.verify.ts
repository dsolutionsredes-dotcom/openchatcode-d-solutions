import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const tempHome = await mkdtemp(`${tmpdir()}\\openchatcut-generation-jobs-`);
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const {
  createGenerationJob,
  flushGenerationJobPersistence,
  getGenerationJobSnapshot,
  initializeGenerationJobStore,
} = await import('./generation-jobs.ts');
const { readStore } = await import('./project-store.ts');

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const result = (id: string) => ({
  assetId: id,
  kind: 'video' as const,
  name: 'persistent result',
  path: `/media/uploads/${id}.mp4`,
  durationSeconds: 1,
});

try {
  await initializeGenerationJobStore(true);

  const terminal = createGenerationJob(
    { kind: 'export', projectId: 'project-persisted' },
    async (id) => result(id),
  );
  await tick();
  await flushGenerationJobPersistence();
  assert.equal(getGenerationJobSnapshot(terminal.jobId)?.status, 'succeeded');

  const beforeRestart = await readStore();
  const records = beforeRestart.entries['jobs:server'] as Array<{ jobId: string; type: string; projectId?: string }>;
  assert.ok(records.some((job) => job.jobId === terminal.jobId && job.type === 'export' && job.projectId === 'project-persisted'));

  await initializeGenerationJobStore(true);
  assert.equal(getGenerationJobSnapshot(terminal.jobId)?.status, 'succeeded', 'terminal job survives registry recreation');

  const never = new Promise<void>(() => {});
  const running = createGenerationJob(
    { kind: 'video', projectId: 'project-running' },
    async (id, update) => {
      update({ progress: 45, phase: 'rendering' });
      await never;
      return result(id);
    },
  );
  const queued = createGenerationJob(
    { kind: 'music', projectId: 'project-queued' },
    async (id) => result(id),
    { acquire: async () => never.then(() => () => {}) },
  );
  await tick();
  await flushGenerationJobPersistence();
  assert.equal(getGenerationJobSnapshot(running.jobId)?.status, 'running');
  assert.equal(getGenerationJobSnapshot(queued.jobId)?.status, 'queued');

  await initializeGenerationJobStore(true);
  const recoveredRunning = getGenerationJobSnapshot(running.jobId);
  const recoveredQueued = getGenerationJobSnapshot(queued.jobId);
  assert.deepEqual(
    { status: recoveredRunning?.status, phase: recoveredRunning?.phase, error: recoveredRunning?.error },
    { status: 'failed', phase: 'interrupted', error: 'job interrupted by process restart; automatic resume is not supported' },
  );
  assert.deepEqual(
    { status: recoveredQueued?.status, phase: recoveredQueued?.phase, error: recoveredQueued?.error },
    { status: 'failed', phase: 'interrupted', error: 'job interrupted by process restart; automatic resume is not supported' },
  );
  await flushGenerationJobPersistence();
  console.log('generation job persistence checks passed');
} finally {
  await rm(tempHome, { recursive: true, force: true });
}
