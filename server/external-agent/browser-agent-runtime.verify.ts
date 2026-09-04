import assert from 'node:assert/strict';
import { BrowserAgentRuntime } from './browser-agent-runtime.ts';
import { registerEditor, resetExternalAgentBrokerForTest } from './broker.ts';

const tools = [{
  name: 'read_project',
  input_schema: { type: 'object' as const },
}];

resetExternalAgentBrokerForTest();
assert.throws(
  () => BrowserAgentRuntime.connect('v6-project-a', 'v6-agent:v6-project-a'),
  /Open the intended OpenChatCut project/,
  'V6 never falls back to an offline editor when no browser is open',
);

registerEditor('v6-project-a', 'editor-a', 'revision-a', tools);
const runtime = BrowserAgentRuntime.connect('v6-project-a', 'v6-agent:v6-project-a');
assert.equal(runtime.projectId, 'v6-project-a');

registerEditor('v6-project-b', 'editor-b', 'revision-b', tools);
assert.throws(
  () => BrowserAgentRuntime.connect('v6-project-a', 'v6-agent:v6-project-a'),
  /Only one OpenChatCut project may be open/,
  'V6 blocks ambiguous multi-editor routing instead of guessing a project',
);

resetExternalAgentBrokerForTest();
console.log('browser-agent-runtime.verify: OK');
