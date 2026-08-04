import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { ServerResponse } from 'node:http';
import { handleExternalProjectsRequest } from '../external-api/projects.ts';

class ResponseCapture {
  statusCode = 200;
  body = '';
  setHeader(_name: string, _value: string): void {}
  end(value?: string): void { this.body = value ?? ''; }
}

process.env.OPENCHATCUT_EXTERNAL_API_KEY = 'production-test-key';
const req = Object.assign(Readable.from([JSON.stringify({ message: 'cambia el formato', references: [], conversationId: 'telegram:42' })]), {
  method: 'POST', url: '/projects/project-1/agent/messages', headers: { 'x-api-key': 'production-test-key' },
});
const res = new ResponseCapture();
let received: unknown[] | undefined;
await handleExternalProjectsRequest(req as never, res as unknown as ServerResponse, {
  createRun: async (projectId, message, references, conversationId) => {
    received = [projectId, message, references, conversationId];
    return { runId: 'run-production', status: 'queued' };
  },
  getRun: async () => undefined,
  applyRun: async () => ({ runId: 'run-production', projectId: 'project-1', approvalStatus: 'applied', appliedOperationCount: 1, idempotent: false, updatedAt: new Date(0).toISOString() }),
  rejectRun: async () => ({ runId: 'run-production', projectId: 'project-1', approvalStatus: 'rejected', appliedOperationCount: 0, idempotent: false, updatedAt: new Date(0).toISOString() }),
});
assert.deepEqual(received, ['project-1', 'cambia el formato', [], 'telegram:42']);
assert.equal(res.statusCode, 202);
assert.deepEqual(JSON.parse(res.body), { runId: 'run-production', status: 'queued' });

const bundle = await readFile(resolve(process.cwd(), 'server-dist/vps-server.mjs'), 'utf8');
assert.ok(!bundle.includes('ssrLoadModule'), 'production bundle must not depend on Vite SSR APIs');
await import(new URL(`file://${resolve(process.cwd(), 'server-dist/vps-server.mjs')}`).href);
console.log('external agent production bundle verification passed');
