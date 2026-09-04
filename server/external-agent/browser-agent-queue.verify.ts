import assert from 'node:assert/strict';
import {
  browserAgentQueueStatus,
  enqueueBrowserAgentWork,
  resetBrowserAgentQueuesForTest,
} from './browser-agent-queue.ts';

resetBrowserAgentQueuesForTest();
const order: string[] = [];
let releaseFirst!: () => void;
const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
const first = enqueueBrowserAgentWork('project-a', async () => {
  order.push('a-start');
  await firstGate;
  order.push('a-end');
  return 'first';
});
const second = enqueueBrowserAgentWork('project-a', async () => {
  order.push('b-start');
  order.push('b-end');
  return 'second';
});
const parallel = enqueueBrowserAgentWork('project-b', async () => {
  order.push('other-project');
  return 'parallel';
});
assert.equal(await parallel, 'parallel', 'different projects run without waiting for project-a');
assert.equal(browserAgentQueueStatus('project-a')['project-a']?.state, 'running');
assert.equal(browserAgentQueueStatus('project-a')['project-a']?.waiting, 1);
releaseFirst();
assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
assert.deepEqual(order, ['a-start', 'other-project', 'a-end', 'b-start', 'b-end']);
assert.deepEqual(browserAgentQueueStatus(), {});
console.log('browser-agent-queue.verify: OK');
