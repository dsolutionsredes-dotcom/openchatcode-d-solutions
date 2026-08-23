import assert from 'node:assert/strict';
import { shouldFinishSettledServerRun } from './serverRunSend.ts';

for (const status of ['cancelled', 'failed', 'completed', 'awaiting_user'] as const) {
  assert.equal(shouldFinishSettledServerRun(status), true, `${status} must release the browser run`);
}
assert.equal(shouldFinishSettledServerRun('running' as never), false);
console.log('serverRunSend.verify: ok');
