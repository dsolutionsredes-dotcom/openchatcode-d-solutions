import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'openchatcut-vps-project-store-'));
const port = 5300 + Math.floor(Math.random() * 400);
const previous = {
  OPENCHATCUT_DATA_DIR: process.env.OPENCHATCUT_DATA_DIR,
  OPENCHATCUT_KEYSTORE_PATH: process.env.OPENCHATCUT_KEYSTORE_PATH,
  OPENCHATCUT_PUBLIC_ORIGIN: process.env.OPENCHATCUT_PUBLIC_ORIGIN,
  OPENCHATCUT_VPS: process.env.OPENCHATCUT_VPS,
  OPENCHATCUT_HOST: process.env.OPENCHATCUT_HOST,
  PORT: process.env.PORT,
};
process.env.OPENCHATCUT_DATA_DIR = root;
process.env.OPENCHATCUT_KEYSTORE_PATH = join(root, '.openchatcut', 'settings.env');
process.env.OPENCHATCUT_PUBLIC_ORIGIN = `http://127.0.0.1:${port}`;
process.env.OPENCHATCUT_VPS = '1';
process.env.OPENCHATCUT_HOST = '127.0.0.1';
process.env.PORT = String(port);

let server: import('node:http').Server | undefined;
try {
  const { startVpsServer } = await import('./vps-server.ts');
  ({ server } = await startVpsServer());
  const origin = process.env.OPENCHATCUT_PUBLIC_ORIGIN;
  const sameOrigin = {
    origin,
    'sec-fetch-site': 'same-origin',
  };
  const health = await fetch(`${origin}/health`);
  assert.equal(health.status, 200);

  const key = `chat:vps-smoke-${crypto.randomUUID()}`;
  const write = await fetch(`${origin}/api/project-store/entry`, {
    method: 'PUT',
    headers: { ...sameOrigin, 'content-type': 'application/json' },
    body: JSON.stringify({ key, value: { persisted: true } }),
  });
  assert.equal(write.status, 200, 'same-origin VPS Project Store write must be available');

  const read = await fetch(`${origin}/api/project-store/entry?key=${encodeURIComponent(key)}`, {
    headers: { 'sec-fetch-site': 'same-origin' },
  });
  assert.deepEqual(await read.json(), { found: true, value: { persisted: true } });

  const crossOrigin = await fetch(`${origin}/api/project-store/entry`, {
    method: 'PUT',
    headers: {
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ key, value: { persisted: false } }),
  });
  assert.equal(crossOrigin.status, 403, 'cross-origin Project Store write must remain blocked');

  const purge = await fetch(`${origin}/api/project-store/project/purge`, {
    method: 'POST',
    headers: { ...sameOrigin, 'content-type': 'application/json' },
    body: JSON.stringify({ operation: 'purge-project', projectId: key.slice('chat:'.length) }),
  });
  assert.equal(purge.status, 200, 'VPS Project Store purge route must be mounted');

  const remove = await fetch(`${origin}/api/project-store/entry?key=${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: sameOrigin,
  });
  assert.equal(remove.status, 200);
  console.log('vps-project-store.verify: health, same-origin read/write, cross-origin rejection and purge passed');
} finally {
  await new Promise<void>((resolve, reject) => {
    if (!server) return resolve();
    server.close((error) => (error ? reject(error) : resolve()));
  });
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await rm(root, { recursive: true, force: true });
}
