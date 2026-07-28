import assert from 'node:assert/strict';
import { seedKeystore } from './keystore.ts';
import { PROVIDER_CATEGORIES, hasProviderCredentials, resolveProviderConfig } from './provider-config.ts';

seedKeystore({
  LLM_PROVIDER: 'openai',
  LLM_OPENAI_API_KEY: 'test-secret-only',
  LLM_OPENAI_BASE_URL: 'https://llm.example/v1',
  LLM_OPENAI_MODEL: 'test-model',
} as Record<string, string>);
const config = resolveProviderConfig({ category: 'agent-brain' });
assert.ok(hasProviderCredentials(config));
assert.equal(config.provider, 'openai');
assert.equal(config.model, 'test-model');
assert.equal(config.baseUrl, 'https://llm.example/v1');
assert.ok(PROVIDER_CATEGORIES.includes('image'));
assert.equal(resolveProviderConfig({ category: 'image' }), undefined);
assert.equal(JSON.stringify({ provider: config.provider, model: config.model, baseUrl: config.baseUrl }).includes('test-secret-only'), false);
console.log('provider-config.verify: ok');
