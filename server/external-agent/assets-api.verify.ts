import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

const tempRoot = await mkdtemp(join(tmpdir(), 'openchatcut-assets-api-'));
process.env.HOME = tempRoot;
process.env.USERPROFILE = tempRoot;
process.env.OPENCHATCUT_EXTERNAL_API_KEY = 'test-external-assets-key';

const { seedKeystore } = await import('../keystore.ts');
seedKeystore({ MEDIA_DIR: join(tempRoot, 'uploads') });
const { handleExternalProjectsRequest } = await import('../external-api/projects.ts');
const { readStore, setStoredEntry } = await import('../plugins/project-store.ts');

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
  options: { apiKey?: string; body?: Buffer; contentType?: string } = {},
): Promise<{ statusCode: number; json: unknown }> {
  const req = new PassThrough() as PassThrough & {
    method: string;
    url: string;
    headers: Record<string, string>;
  };
  req.method = method;
  req.url = url;
  req.headers = {
    ...(options.apiKey === undefined ? {} : { 'x-api-key': options.apiKey }),
    ...(options.contentType ? { 'content-type': options.contentType } : {}),
    ...(options.body ? { 'content-length': String(options.body.length) } : {}),
  };
  const res = response();
  const task = handleExternalProjectsRequest(req, res as never);
  req.end(options.body);
  await task;
  return { statusCode: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
}

try {
  const created = await request('POST', '/projects', {
    apiKey: 'test-external-assets-key',
    body: Buffer.from(JSON.stringify({ name: 'assets target' })),
    contentType: 'application/json',
  });
  assert.equal(created.statusCode, 201);
  const projectId = (created.json as { id: string }).id;

  const unauthorized = await request('POST', `/projects/${projectId}/assets?name=clip.mp4`, {
    apiKey: 'wrong-key', body: Buffer.from('video'), contentType: 'video/mp4',
  });
  assert.equal(unauthorized.statusCode, 401);

  const missingProject = await request('POST', '/projects/missing-project/assets?name=clip.mp4', {
    apiKey: 'test-external-assets-key', body: Buffer.from('video'), contentType: 'video/mp4',
  });
  assert.equal(missingProject.statusCode, 404);

  const missingName = await request('POST', `/projects/${projectId}/assets`, {
    apiKey: 'test-external-assets-key', body: Buffer.from('video'), contentType: 'video/mp4',
  });
  assert.equal(missingName.statusCode, 400);

  const unsupported = await request('POST', `/projects/${projectId}/assets?name=payload.exe`, {
    apiKey: 'test-external-assets-key', body: Buffer.from('not media'), contentType: 'application/octet-stream',
  });
  assert.equal(unsupported.statusCode, 415);

  const uploaded = await request('POST', `/projects/${projectId}/assets?name=clip.mp4&kind=video`, {
    apiKey: 'test-external-assets-key', body: Buffer.from('video bytes'), contentType: 'video/mp4',
  });
  assert.equal(uploaded.statusCode, 201);
  const result = uploaded.json as { projectId: string; asset: { id: string; name: string; kind: string; src: string } };
  assert.equal(result.projectId, projectId);
  assert.deepEqual(
    { name: result.asset.name, kind: result.asset.kind },
    { name: 'clip.mp4', kind: 'video' },
  );
  assert.match(result.asset.src, /^\/media\/uploads\/[a-z0-9-]+\.mp4$/i);

  const store = await readStore();
  const doc = store.entries[`project:${projectId}`] as { assets: Array<{ id: string; src: string; name: string; kind: string }> };
  const persisted = doc.assets.find((asset) => asset.id === result.asset.id);
  assert.ok(persisted, 'asset is registered in the requested ProjectDoc');
  assert.equal(persisted.name, 'clip.mp4');
  assert.equal(persisted.kind, 'video');
  assert.equal(persisted.src, result.asset.src);
  const diskName = result.asset.src.split('/').pop()!;
  assert.deepEqual(await readFile(join(tempRoot, 'uploads', diskName)), Buffer.from('video bytes'));

  const inventory = await request('GET', `/projects/${projectId}/assets`, {
    apiKey: 'test-external-assets-key',
  });
  assert.equal(inventory.statusCode, 200);
  assert.deepEqual(inventory.json, {
    projectId,
    assets: [{
      id: result.asset.id,
      name: 'clip.mp4',
      kind: 'video',
      src: result.asset.src,
      durationInFrames: 150,
    }],
    assetCount: 1,
  }, 'asset inventory exposes only the project media pool');

  const blockedDoc = {
    ...doc,
    timelines: [{ id: 'tl_using_asset', items: [{ id: 'clip_1', src: result.asset.src }] }],
  };
  await setStoredEntry(`project:${projectId}`, blockedDoc);
  const inUse = await request('DELETE', `/projects/${projectId}/assets/${result.asset.id}`, {
    apiKey: 'test-external-assets-key',
  });
  assert.equal(inUse.statusCode, 409);
  assert.deepEqual(inUse.json, {
    error: 'asset is in use by the timeline',
    code: 'ASSET_IN_USE',
    timelineIds: ['tl_using_asset'],
  });

  await setStoredEntry(`project:${projectId}`, { ...blockedDoc, timelines: [] });
  const deleted = await request('DELETE', `/projects/${projectId}/assets/${result.asset.id}`, {
    apiKey: 'test-external-assets-key',
  });
  assert.equal(deleted.statusCode, 200);
  assert.deepEqual(deleted.json, {
    ok: true,
    projectId,
    asset: { id: result.asset.id, name: 'clip.mp4', kind: 'video' },
    storage: 'local_deleted',
  });
  const emptyInventory = await request('GET', `/projects/${projectId}/assets`, {
    apiKey: 'test-external-assets-key',
  });
  assert.deepEqual(emptyInventory.json, { projectId, assets: [], assetCount: 0 });
  await assert.rejects(readFile(join(tempRoot, 'uploads', diskName)));

  const missingInventory = await request('GET', '/projects/missing-project/assets', {
    apiKey: 'test-external-assets-key',
  });
  assert.equal(missingInventory.statusCode, 404);
  console.log('external assets API checks passed');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
