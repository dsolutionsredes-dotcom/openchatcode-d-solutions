import type { Proposal } from '../../src/agent/proposal.ts';
import { readStore, setStoredEntry } from '../plugins/project-store.ts';

export const EXTERNAL_AGENT_RUNS_KEY = 'jobs:agent-runs';
export type ExternalApprovalStatus = 'pending' | 'applied' | 'rejected';

export interface ExternalAgentRun {
  runId: string;
  projectId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  assistantText: string;
  proposal: Proposal | null;
  requiresApproval: boolean;
  approvalStatus?: ExternalApprovalStatus;
  appliedOperationCount?: number;
  error: string | null;
  providerUsed?: string;
  modelUsed?: string;
  fallbackAttempts?: Array<{ provider: string; model: string }>;
  createdAt: number;
  updatedAt: number;
}

export function approvalStatusOf(run: ExternalAgentRun): ExternalApprovalStatus | null {
  return run.approvalStatus ?? (run.requiresApproval ? 'pending' : null);
}

function isRun(value: unknown): value is ExternalAgentRun {
  if (!value || typeof value !== 'object') return false;
  const run = value as Partial<ExternalAgentRun>;
  return typeof run.runId === 'string' && typeof run.projectId === 'string'
    && (run.status === 'queued' || run.status === 'running' || run.status === 'succeeded' || run.status === 'failed')
    && typeof run.assistantText === 'string' && typeof run.requiresApproval === 'boolean'
    && (run.error === null || typeof run.error === 'string')
    && typeof run.createdAt === 'number' && typeof run.updatedAt === 'number';
}

export async function saveExternalAgentRun(run: ExternalAgentRun): Promise<void> {
  const store = await readStore();
  const runs = Array.isArray(store.entries[EXTERNAL_AGENT_RUNS_KEY])
    ? store.entries[EXTERNAL_AGENT_RUNS_KEY].filter(isRun)
    : [];
  await setStoredEntry(EXTERNAL_AGENT_RUNS_KEY, [run, ...runs.filter((item) => item.runId !== run.runId)]);
}

export async function loadExternalAgentRun(runId: string): Promise<ExternalAgentRun | undefined> {
  const store = await readStore();
  return Array.isArray(store.entries[EXTERNAL_AGENT_RUNS_KEY])
    ? store.entries[EXTERNAL_AGENT_RUNS_KEY].filter(isRun).find((item) => item.runId === runId)
    : undefined;
}
