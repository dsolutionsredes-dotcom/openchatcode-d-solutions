import assert from 'node:assert/strict';
import { TOOL_SCHEMAS } from './tools';
import { ToolActivation } from './tool-activation';
import { buildServerRunPayload } from './serverRunProtocol';
import { semanticToolNamesForRuntime } from './runtime';
import { semanticToolNamesForServerRun } from './serverRunSend';
import { llmProviderConfigNames } from '../../shared/llm-providers';
import {
  resolveSemanticIntent,
  SEMANTIC_INTENT_RESOLVER_CONFIG,
} from './semantic-intent-resolver';

type Message = { role: 'user' | 'assistant'; content: string };
const user = (content: string): Message => ({ role: 'user', content });

assert.equal(SEMANTIC_INTENT_RESOLVER_CONFIG.enabled, true);
assert.equal(SEMANTIC_INTENT_RESOLVER_CONFIG.provider, 'gemini');
assert.equal(SEMANTIC_INTENT_RESOLVER_CONFIG.model, 'gemini-2.5-flash-lite');
assert.equal(SEMANTIC_INTENT_RESOLVER_CONFIG.maxOutputTokens, 180);
assert.equal(llmProviderConfigNames('gemini').apiKey, 'LLM_GEMINI_API_KEY');

let calls = 0;
const noCall = async () => {
  calls += 1;
  throw new Error('resolver should not have been called');
};

for (const text of ['hola', 'pon subtítulos', 'corta el clip', 'renderiza el vídeo', 'vertical 9:16']) {
  const result = await resolveSemanticIntent(TOOL_SCHEMAS, [user(text)], { generate: noCall });
  assert.equal(result.metrics.path, 'fast-path', text);
  assert.equal(result.metrics.usedResolver, false, text);
}
assert.equal(calls, 0, 'clear lexical intents do not call the resolver');

let disabledCalls = 0;
const disabled = await resolveSemanticIntent(TOOL_SCHEMAS, [user('parte esa imagen')], {
  config: { enabled: false },
  generate: async () => {
    disabledCalls += 1;
    return { text: JSON.stringify({ confidence: 1, families: ['split'] }) };
  },
});
assert.equal(disabledCalls, 0, 'disabled resolver makes zero Gemini calls');
assert.equal(disabled.metrics.path, 'fast-path');

let configuredModel = '';
await resolveSemanticIntent(TOOL_SCHEMAS, [user('parte esa imagen')], {
  config: { model: 'gemini-test-model' },
  generate: async (options) => {
    configuredModel = options.model;
    return { text: JSON.stringify({ confidence: 0.9, families: ['split'] }) };
  },
});
assert.equal(configuredModel, 'gemini-test-model', 'configured resolver model is used');

const unexpectedResolver = async () => { throw new Error('unexpected resolver failure'); };
assert.deepEqual(
  await semanticToolNamesForRuntime(TOOL_SCHEMAS, [user('hazlo')], unexpectedResolver as never),
  [],
  'Agent fail-open returns no candidates',
);
assert.deepEqual(
  await semanticToolNamesForServerRun(TOOL_SCHEMAS, [user('hazlo')], unexpectedResolver as never),
  [],
  'Server Run fail-open returns no candidates',
);

const generated = async (prompt: string, _expected: string) => {
  calls += 1;
  assert.equal(_expected, SEMANTIC_INTENT_RESOLVER_CONFIG.model);
  return { text: prompt };
};
const classify = async (
  messages: readonly Message[],
  response: string,
) => resolveSemanticIntent(TOOL_SCHEMAS, messages, {
  generate: async (options) => generated(response, options.model),
});

const freeLanguageCases: Array<[string, string, string]> = [
  ['parte esa imagen justo por el medio', 'split', 'split_item'],
  ['saca esa foto de ahi', 'remove', 'remove_item'],
  ['quedate solamente con la primera mitad', 'trim', 'set_item_timing'],
  ['hazlo con aspecto de reel', 'aspect_layout', 'set_aspect_ratio'],
  ['dale mas vida a los colores', 'color', 'inspect_color'],
];
for (const [text, family, expectedTool] of freeLanguageCases) {
  const result = await classify([user(text)], JSON.stringify({ confidence: 0.93, families: [family] }));
  assert.ok(result.metrics.usedResolver, text);
  assert.ok(result.toolNames.includes(expectedTool), `${text} → ${expectedTool}`);
  assert.equal(result.metrics.path, 'semantic');
}

const contextual = await classify([
  user('reduce la imagen a diez segundos'),
  { role: 'assistant', content: 'Puedo ajustar la duración de esa imagen.' },
  user('hazlo'),
], JSON.stringify({ confidence: 0.91, families: ['trim'] }));
assert.ok(contextual.toolNames.includes('set_item_timing'), 'context can resolve a genuine continuation');

const hypothetical = await classify([
  user('¿qué harías con esta imagen?'),
  { role: 'assistant', content: 'Podría recortarla o cambiar su duración.' },
  user('dale'),
], JSON.stringify({ confidence: 0.55, families: ['remove'] }));
assert.deepEqual(hypothetical.toolNames, [], 'low-confidence contextual language stays non-destructive');

const unknownTool = await classify([user('hazlo')], JSON.stringify({
  confidence: 0.99,
  families: ['split', 'not_a_family'],
  candidateTools: ['invented_tool'],
}));
assert.deepEqual(unknownTool.families, ['split']);
assert.ok(unknownTool.toolNames.includes('split_item'));
assert.equal(unknownTool.toolNames.includes('invented_tool'), false, 'model cannot invent tools');

for (const response of [
  () => { throw new Error('401 unauthorized'); },
  () => { throw new Error('429 rate limited'); },
  () => { throw new Error('timeout'); },
  () => ({ text: '{not json' }),
  () => ({ text: JSON.stringify({ confidence: 0.2, families: ['remove'] }) }),
]) {
  const result = await resolveSemanticIntent(TOOL_SCHEMAS, [user('hazlo')], {
    generate: async () => response() as never,
  });
  assert.equal(result.metrics.path, 'fallback', String(result.metrics.fallbackReason));
  assert.deepEqual(result.toolNames, [], 'resolver failures leave normal Agent discovery available');
}

const unavailable = await resolveSemanticIntent(TOOL_SCHEMAS, [user('parte esa imagen')]);
assert.equal(unavailable.metrics.path, 'fallback', 'no configured Gemini key falls back without throwing');
assert.equal(unavailable.metrics.fallbackReason, 'gemini-not-configured');

const activated = new ToolActivation(
  TOOL_SCHEMAS,
  [user('parte esa imagen')],
  [],
  true,
  ['split_item', 'not_a_real_tool'],
);
assert.ok(activated.names().includes('split_item'));
assert.equal(activated.names().includes('not_a_real_tool'), false);

const originalMessage = 'parte esa imagen justo por el medio';
const payload = buildServerRunPayload('semantic-project', originalMessage, {}, {
  cacheMode: 'short',
  maxOutputTokens: 400,
  semanticToolNames: ['split_item', 'not_a_real_tool'],
});
assert.equal(payload.messages.at(-1)?.content, originalMessage, 'payload keeps the original message');
assert.ok(payload.tools.some((tool) => tool.name === 'split_item'));
assert.equal(payload.tools.some((tool) => tool.name === 'not_a_real_tool'), false);

console.log('semantic-intent-resolver.verify: fast-path, semantic fallback, context, safety, metrics, and canonical filtering passed');
