type QueueState = 'idle' | 'queued' | 'running';

interface ProjectQueue {
  tail: Promise<void>;
  state: QueueState;
  waiting: number;
}

const queues = new Map<string, ProjectQueue>();

function queueFor(projectId: string): ProjectQueue {
  const current = queues.get(projectId);
  if (current) return current;
  const created: ProjectQueue = { tail: Promise.resolve(), state: 'idle', waiting: 0 };
  queues.set(projectId, created);
  return created;
}

/** Serialize external editing instructions per project without blocking other projects. */
export async function enqueueBrowserAgentWork<T>(
  projectId: string,
  work: () => Promise<T>,
): Promise<T> {
  const queue = queueFor(projectId);
  queue.waiting += 1;
  queue.state = queue.state === 'running' ? 'running' : 'queued';
  const previous = queue.tail;
  let release: () => void;
  const settled = new Promise<void>((resolve) => { release = resolve; });
  queue.tail = previous.catch(() => undefined).then(() => settled);
  await previous.catch(() => undefined);
  queue.waiting -= 1;
  queue.state = 'running';
  try {
    return await work();
  } finally {
    release!();
    if (queue.waiting === 0) {
      queue.state = 'idle';
      if (queues.get(projectId) === queue) queues.delete(projectId);
    } else {
      queue.state = 'queued';
    }
  }
}

export function browserAgentQueueStatus(projectId?: string): Record<string, { state: QueueState; waiting: number }> {
  const entries: Array<[string, ProjectQueue | undefined]> = projectId
    ? [[projectId, queues.get(projectId)]]
    : [...queues.entries()];
  return Object.fromEntries(entries.flatMap(([id, queue]) => (
    queue ? [[id, { state: queue.state, waiting: queue.waiting }]] : []
  )));
}

export function resetBrowserAgentQueuesForTest(): void {
  queues.clear();
}
