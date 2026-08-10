import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';

const tempHome = await mkdtemp(`${tmpdir()}\\openchatcut-projects-api-`);
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;
process.env.OPENCHATCUT_EXTERNAL_API_KEY = 'test-external-project-key';

const { handleExternalProjectsRequest } = await import('../external-api/projects.ts');
const { readStore } = await import('../plugins/project-store.ts');

type ResponseCapture = {
  statusCode: number;
  headersSent: boolean;
  body: string;
  setHeader(name: string, value: string): void;
  end(value?: string): void;
};

function response(): ResponseCapture {
  return {
    statusCode: 0,
    headersSent: false,
    body: '',
    setHeader() {},
    end(value = '') {
      this.body = value;
      this.headersSent = true;
    },
  };
}

async function request(
  method: string,
  url: string,
  apiKey?: string,
  body?: Record<string, unknown>,
): Promise<{ statusCode: number; json: unknown }> {
  const req = new PassThrough() as PassThrough & {
    method: string;
    url: string;
    headers: Record<string, string>;
  };
  req.method = method;
  req.url = url;
  req.headers = apiKey === undefined ? {} : { 'x-api-key': apiKey };
  const res = response();
  const task = handleExternalProjectsRequest(req, res as never);
  req.end(body === undefined ? undefined : JSON.stringify(body));
  await task;
  return { statusCode: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
}

try {
  assert.equal((await request('GET', '/projects')).statusCode, 401, 'missing key is rejected');
  assert.equal((await request('GET', '/projects', 'wrong-key')).statusCode, 401, 'wrong key is rejected');

  const created = await request('POST', '/projects', 'test-external-project-key', {
    name: 'n8n test project',
    description: 'created through the external API',
    fps: 25,
    compositionWidth: 1280,
    compositionHeight: 720,
  });
  assert.equal(created.statusCode, 201);
  assert.equal(typeof (created.json as { id: string }).id, 'string');
  assert.equal((created.json as { name: string }).name, 'n8n test project');
  const projectId = (created.json as { id: string }).id;

  const listed = await request('GET', '/projects', 'test-external-project-key');
  assert.equal(listed.statusCode, 200);
  assert.ok((listed.json as Array<{ id: string }>).some((project) => project.id === projectId));

  const fetched = await request('GET', `/projects/${encodeURIComponent(projectId)}`, 'test-external-project-key');
  assert.equal(fetched.statusCode, 200);
  assert.deepEqual(fetched.json, created.json, 'lookup returns the stored metadata');

  const missing = await request('GET', '/projects/does-not-exist', 'test-external-project-key');
  assert.equal(missing.statusCode, 404);

  const noContext = await request('GET', '/telegram/chats/telegram%3A42/project', 'test-external-project-key');
  assert.equal(noContext.statusCode, 404);
  const selected = await request('PUT', '/telegram/chats/telegram%3A42/project', 'test-external-project-key', { projectId });
  assert.equal(selected.statusCode, 200);
  assert.deepEqual(selected.json, {
    chatId: 'telegram:42', projectId, projectName: 'n8n test project', updatedAt: (selected.json as { updatedAt: number }).updatedAt,
  });
  const restored = await request('GET', '/telegram/chats/telegram%3A42/project', 'test-external-project-key');
  assert.equal((restored.json as { projectId: string }).projectId, projectId, 'chat selection persists in the project store');

  const absentDrive = await request('GET', `/projects/${projectId}/drive-context`, 'test-external-project-key');
  assert.equal(absentDrive.statusCode, 404);
  const savedDrive = await request('PUT', `/projects/${projectId}/drive-context`, 'test-external-project-key', {
    driveFolderId: '1hOnK9wdggJYrGNwOkoDgoWI7WHBM3IWG',
    originalsFolderId: '18jt5xgUG7Lf5Nu7MzhJv4s6amKi63VM9',
  });
  assert.equal(savedDrive.statusCode, 200);
  const restoredDrive = await request('GET', `/projects/${projectId}/drive-context`, 'test-external-project-key');
  assert.equal(restoredDrive.statusCode, 200);
  assert.equal((restoredDrive.json as { originalsFolderId: string }).originalsFolderId, '18jt5xgUG7Lf5Nu7MzhJv4s6amKi63VM9');

  const store = await readStore();
  assert.ok(store.entries[`project:${projectId}`], 'project document is persisted in the existing project store');
  assert.equal(
    (store.entries[`project:${projectId}`] as { timelines: unknown[] }).timelines.length,
    1,
    'persisted document uses the existing ProjectDoc shape',
  );
  console.log('external projects API checks passed');
} finally {
  await rm(tempHome, { recursive: true, force: true });
}
