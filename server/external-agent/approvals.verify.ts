import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';

const tempHome = await mkdtemp(`${tmpdir()}\\openchatcut-approvals-`);
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;
process.env.OPENCHATCUT_EXTERNAL_API_KEY = 'approval-test-key';

const { createExternalProject, loadExternalProjectDoc, saveExternalProjectDoc } = await import('./projects.ts');
const { saveExternalAgentRun } = await import('./run-store.ts');
const { applyExternalAgentRun, rejectExternalAgentRun, ExternalRunApprovalError } = await import('./approvals.ts');
const { makeDraft } = await import('../../src/editor/store.ts');
const { buildProposal } = await import('../../src/agent/proposal.ts');
const { handleExternalProjectsRequest } = await import('../external-api/projects.ts');

function proposalFor(doc: Parameters<typeof makeDraft>[0]) {
  const draft = makeDraft(doc);
  draft.commands.setAspect(1080, 1920, 'contain');
  const actions = draft.takeActions();
  return buildProposal([{ tool: 'set_aspect_ratio', args: { ratio: '9:16' }, actions, action: 'aspect', target: 'canvas', impact: '1 change' }], 'Vertical', doc, draft.getState());
}

async function seed(runId: string) {
  const project = await createExternalProject({ name: runId });
  const doc = await loadExternalProjectDoc(project.id);
  assert.ok(doc);
  const proposal = proposalFor(doc as never);
  await saveExternalAgentRun({
    runId, projectId: project.id, status: 'succeeded', assistantText: 'Vertical', proposal,
    requiresApproval: true, approvalStatus: 'pending', error: null, createdAt: Date.now(), updatedAt: Date.now(),
  });
  return { project, doc, proposal };
}

type ResponseCapture = { statusCode: number; body: string; setHeader: () => void; end: (value?: string) => void };
function response(): ResponseCapture {
  return { statusCode: 0, body: '', setHeader() {}, end(value = '') { this.body = value; } };
}
async function request(url: string, key: string | undefined, api: Parameters<typeof handleExternalProjectsRequest>[2]) {
  const req = new PassThrough() as PassThrough & { method: string; url: string; headers: Record<string, string> };
  req.method = 'POST'; req.url = url; req.headers = key ? { 'x-api-key': key } : {};
  const res = response();
  const task = handleExternalProjectsRequest(req, res as never, api);
  req.end(); await task;
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

try {
  const api = {
    createRun: async () => ({ runId: 'unused', status: 'queued' }),
    getRun: async () => undefined,
    applyRun: applyExternalAgentRun,
    rejectRun: rejectExternalAgentRun,
  };
  const first = await seed('run-apply');
  assert.equal((await request('/agent/runs/run-apply/apply', undefined, api)).status, 401, 'approval requires API key');
  const applied = await request('/agent/runs/run-apply/apply', 'approval-test-key', api);
  assert.equal(applied.status, 200);
  assert.deepEqual({ runId: applied.body.runId, projectId: applied.body.projectId, approvalStatus: applied.body.approvalStatus, appliedOperationCount: applied.body.appliedOperationCount, idempotent: applied.body.idempotent }, { runId: 'run-apply', projectId: first.project.id, approvalStatus: 'applied', appliedOperationCount: 1, idempotent: false });
  const changed = await loadExternalProjectDoc(first.project.id);
  assert.equal(changed!.timelines[0]!.width, 1080, 'apply persists the real ProjectDoc before finishing');
  const duplicateApply = await request('/agent/runs/run-apply/apply', 'approval-test-key', api);
  assert.equal(duplicateApply.body.idempotent, true, 'second apply does not replay actions');
  assert.equal((await loadExternalProjectDoc(first.project.id))!.timelines[0]!.width, 1080);
  assert.equal((await request('/agent/runs/run-apply/reject', 'approval-test-key', api)).status, 409, 'reject after apply conflicts');

  const rejected = await seed('run-reject');
  assert.equal((await request('/agent/runs/run-reject/reject', 'approval-test-key', api)).body.idempotent, false);
  assert.equal((await request('/agent/runs/run-reject/reject', 'approval-test-key', api)).body.idempotent, true, 'reject is idempotent');
  assert.equal((await request('/agent/runs/run-reject/apply', 'approval-test-key', api)).status, 409, 'apply after reject conflicts');
  assert.equal((await loadExternalProjectDoc(rejected.project.id))!.timelines[0]!.width, rejected.doc!.timelines[0]!.width);

  const stale = await seed('run-stale');
  const altered = { ...stale.doc!, timelines: stale.doc!.timelines.map((timeline, index) => index === 0 ? { ...timeline, width: 1280 } : timeline) };
  assert.equal(await saveExternalProjectDoc(stale.project.id, altered), true);
  const staleResult = await request('/agent/runs/run-stale/apply', 'approval-test-key', api);
  assert.equal(staleResult.status, 409);
  assert.match(staleResult.body.error, /stale/);

  const afterReload = await applyExternalAgentRun('run-apply');
  assert.equal(afterReload.idempotent, true, 'terminal run survives a store reload');
  console.log('external agent approval checks passed');
} finally {
  await rm(tempHome, { recursive: true, force: true });
}
