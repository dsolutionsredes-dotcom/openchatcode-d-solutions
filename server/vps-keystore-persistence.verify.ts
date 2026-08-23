import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'openchatcut-vps-keystore-'));
const previous = {
  keyPath: process.env.OPENCHATCUT_KEYSTORE_PATH,
  vps: process.env.OPENCHATCUT_VPS,
};
try {
  process.env.OPENCHATCUT_VPS = '1';
  process.env.OPENCHATCUT_KEYSTORE_PATH = join(root, '.openchatcut', 'settings.env');
  await mkdir(join(root, '.openchatcut'), { recursive: true });
  const keystore = await import('./keystore.ts');
  const profile = (await import('./runtime-profile.ts')).runtimeProfile();
  assert.equal(profile.keystorePath, process.env.OPENCHATCUT_KEYSTORE_PATH);

  await keystore.setKeys({
    OPENAI_API_KEY: 'vps-secret-value',
    LLM_OPENAI_BASE_URL: 'https://api.example.test/v1',
    LLM_OPENAI_MODEL: 'gpt-test-model',
    PREFERRED_IMAGE_VENDOR: 'openai',
  });
  const persisted = await readFile(profile.keystorePath, 'utf8');
  assert.match(persisted, /OPENAI_API_KEY=vps-secret-value/);
  assert.match(persisted, /LLM_OPENAI_MODEL=gpt-test-model/);

  keystore.resetKeystoreForTests();
  assert.equal(keystore.keyStatus().keys.OPENAI_API_KEY.configured, false);
  await keystore.loadKeystoreFromDisk();
  const recovered = keystore.keyStatus();
  assert.equal(recovered.keys.OPENAI_API_KEY.configured, true, 'secret survives a simulated restart');
  assert.equal(recovered.models.LLM_OPENAI_MODEL, 'gpt-test-model');
  assert.equal(JSON.stringify(recovered).includes('vps-secret-value'), false, 'secret never appears in browser-facing status');
} finally {
  if (previous.keyPath === undefined) delete process.env.OPENCHATCUT_KEYSTORE_PATH;
  else process.env.OPENCHATCUT_KEYSTORE_PATH = previous.keyPath;
  if (previous.vps === undefined) delete process.env.OPENCHATCUT_VPS;
  else process.env.OPENCHATCUT_VPS = previous.vps;
  await rm(root, { recursive: true, force: true });
}

console.log('vps-keystore-persistence.verify: ok');
