import assert from 'node:assert/strict';
import { finalVisibleRunMessage, requiresUserInputFor } from './auto-editor.ts';

const message = finalVisibleRunMessage({
  events: [
    { type: 'text-start', data: {} },
    { type: 'text-delta', data: { text: 'old turn' } },
    { type: 'tool-request', data: { tool: 'read_project' } },
    { type: 'text-start', data: {} },
    { type: 'text-delta', data: { text: 'final ' } },
    { type: 'text-delta', data: { text: 'answer' } },
    { type: 'text-end', data: {} },
  ],
});
assert.equal(message, 'final answer');
assert.equal(requiresUserInputFor('pending_approval'), true);
assert.equal(requiresUserInputFor('needs_clarification'), true);
for (const status of ['read', 'queued', 'running', 'applied', 'rejected', 'failed']) {
  assert.equal(requiresUserInputFor(status), false, status);
}
console.log('auto-editor.verify: ok');
