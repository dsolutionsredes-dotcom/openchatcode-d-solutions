import type { Proposal } from '../../src/agent/proposal.ts';
import { readStore, setStoredEntry } from '../plugins/project-store.ts';

export const EXTERNAL_AGENT_RUNS_KEY = 'jobs:agent-runs';
export type ExternalApprovalStatus = 'pending' | 'applied' | 'rejected';
export type ExternalPreviewStatus = 'awaiting-choice' | 'rendering' | 'ready' | 'failed' | 'scheduled' | 'editing';

export interface ExternalAgentRun {
  runId: string;
  projectId: string;
  /** Stable caller conversation identity, for example telegram:<chatId>. */
  conversationId?: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  assistantText: string;
  proposal: Proposal | null;
  requiresApproval: boolean;
  approvalStatus?: ExternalApprovalStatus;
  appliedOperationCount?: number;
  previewStatus?: ExternalPreviewStatus;
  preview?: { jobId?: string; status: 'queued' | 'running' | 'ready' | 'failed'; path?: string; sizeBytes?: number; error?: string };
  /** A newer run replaced this draft/proposal. Old runs must no longer be approvable. */
  supersededByRunId?: string;
  /** Audit pointer to the prior draft/proposal that this run continued. */
  supersedesRunId?: string;
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

async function allRuns(): Promise<ExternalAgentRun[]> {
  const store = await readStore();
  return Array.isArray(store.entries[EXTERNAL_AGENT_RUNS_KEY])
    ? store.entries[EXTERNAL_AGENT_RUNS_KEY].filter(isRun)
    : [];
}

export async function saveExternalAgentRun(run: ExternalAgentRun): Promise<void> {
  const runs = await allRuns();
  await setStoredEntry(EXTERNAL_AGENT_RUNS_KEY, [run, ...runs.filter((item) => item.runId !== run.runId)]);
}

export async function loadExternalAgentRun(runId: string): Promise<ExternalAgentRun | undefined> {
  return (await allRuns()).find((item) => item.runId === runId);
}

/**
 * Return the newest still-live draft/proposal for one project + conversation.
 * It includes normal pending proposals and preview/editing runs that temporarily
 * hide approval until the preview is ready.
 */
export async function loadLatestExternalDraftRun(
  projectId: string,
  conversationId: string,
  excludeRunId?: string,
): Promise<ExternalAgentRun | undefined> {
  return (await allRuns()).find((run) => (
    run.runId !== excludeRunId
    && run.projectId === projectId
    && run.conversationId === conversationId
    && !!run.proposal
    && !run.supersededByRunId
    && approvalStatusOf(run) !== 'applied'
    && approvalStatusOf(run) !== 'rejected'
    && (
      run.requiresApproval
      || run.previewStatus === 'awaiting-choice'
      || run.previewStatus === 'rendering'
      || run.previewStatus === 'ready'
      || run.previewStatus === 'editing'
      || run.previewStatus === 'scheduled'
    )
  ));
}

/** Make an older draft non-approvable after a newer run has safely replaced it. */
export async function supersedeExternalAgentRun(runId: string, supersededByRunId: string): Promise<void> {
  const run = await loadExternalAgentRun(runId);
  if (!run || run.supersededByRunId) return;
  await saveExternalAgentRun({
    ...run,
    requiresApproval: false,
    approvalStatus: undefined,
    supersededByRunId,
    updatedAt: Date.now(),
  });
}
