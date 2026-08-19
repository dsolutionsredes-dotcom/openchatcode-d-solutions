import { isProposalStale, type Proposal } from '../../src/agent/proposal.ts';
import { replayActions } from '../../src/editor/store.ts';
import { revisionOf } from '../../src/agent/external-edit-session.ts';
import { loadExternalProjectDoc, saveExternalProjectDoc } from './projects.ts';
import { approvalStatusOf, loadExternalAgentRun, saveExternalAgentRun, type ExternalAgentRun } from './run-store.ts';

export class ExternalRunApprovalError extends Error {
  constructor(readonly code: 'RUN_NOT_FOUND' | 'PROPOSAL_NOT_PENDING' | 'PROPOSAL_STALE' | 'APPROVAL_CONFLICT', message: string) {
    super(message);
  }
}

export interface ExternalRunApprovalResult {
  runId: string;
  projectId: string;
  approvalStatus: 'pending' | 'applied' | 'rejected';
  appliedOperationCount: number;
  idempotent: boolean;
  updatedAt: string;
}

function proposalOf(run: ExternalAgentRun): Proposal {
  if (run.supersededByRunId) {
    throw new ExternalRunApprovalError(
      'APPROVAL_CONFLICT',
      `proposal was superseded by run ${run.supersededByRunId}`,
    );
  }
  if (!run.proposal || !run.requiresApproval || approvalStatusOf(run) !== 'pending') {
    throw new ExternalRunApprovalError('PROPOSAL_NOT_PENDING', 'run has no pending proposal');
  }
  return run.proposal;
}

function response(run: ExternalAgentRun, idempotent: boolean): ExternalRunApprovalResult {
  const approvalStatus = approvalStatusOf(run);
  if (!approvalStatus) throw new ExternalRunApprovalError('PROPOSAL_NOT_PENDING', 'run has no approval state');
  return {
    runId: run.runId,
    projectId: run.projectId,
    approvalStatus,
    appliedOperationCount: run.appliedOperationCount ?? 0,
    idempotent,
    updatedAt: new Date(run.updatedAt).toISOString(),
  };
}

function operations(proposal: Proposal) {
  return proposal.options[0]?.operations ?? [];
}

/** Apply the persisted continuous-draft proposal exactly once, without a browser. */
export async function applyExternalAgentRun(runId: string): Promise<ExternalRunApprovalResult> {
  const run = await loadExternalAgentRun(runId);
  if (!run) throw new ExternalRunApprovalError('RUN_NOT_FOUND', 'run not found');
  if (run.supersededByRunId) {
    throw new ExternalRunApprovalError(
      'APPROVAL_CONFLICT',
      `proposal was superseded by run ${run.supersededByRunId}`,
    );
  }

  const status = approvalStatusOf(run);
  if (status === 'applied') return response(run, true);
  if (status === 'rejected') throw new ExternalRunApprovalError('APPROVAL_CONFLICT', 'proposal was rejected and cannot be applied');

  const proposal = proposalOf(run);
  const doc = await loadExternalProjectDoc(run.projectId);
  if (!doc) throw new ExternalRunApprovalError('RUN_NOT_FOUND', 'project not found');
  const ops = operations(proposal);
  const expected = replayActions(proposal.baseDoc, ops.flatMap((operation) => operation.actions));

  if (isProposalStale(proposal, doc)) {
    // A previous request may have saved the project and been interrupted before
    // it could persist the terminal run state. Recognize that exact result as
    // applied instead of replaying the actions a second time.
    if (revisionOf(doc) !== revisionOf(expected)) {
      throw new ExternalRunApprovalError('PROPOSAL_STALE', 'proposal is stale because the project changed');
    }
  } else {
    const saved = await saveExternalProjectDoc(run.projectId, expected);
    if (!saved) throw new Error('project could not be saved');
  }

  const completed: ExternalAgentRun = {
    ...run,
    approvalStatus: 'applied',
    requiresApproval: false,
    appliedOperationCount: ops.length,
    updatedAt: Date.now(),
  };
  await saveExternalAgentRun(completed);
  return response(completed, false);
}

/** Rejecting is terminal and idempotent; it never changes the project. */
export async function rejectExternalAgentRun(runId: string): Promise<ExternalRunApprovalResult> {
  const run = await loadExternalAgentRun(runId);
  if (!run) throw new ExternalRunApprovalError('RUN_NOT_FOUND', 'run not found');
  if (run.supersededByRunId) {
    throw new ExternalRunApprovalError(
      'APPROVAL_CONFLICT',
      `proposal was superseded by run ${run.supersededByRunId}`,
    );
  }

  const status = approvalStatusOf(run);
  if (status === 'rejected') return response(run, true);
  if (status === 'applied') throw new ExternalRunApprovalError('APPROVAL_CONFLICT', 'proposal was applied and cannot be rejected');

  proposalOf(run);
  const completed: ExternalAgentRun = {
    ...run,
    approvalStatus: 'rejected',
    requiresApproval: false,
    appliedOperationCount: 0,
    updatedAt: Date.now(),
  };
  await saveExternalAgentRun(completed);
  return response(completed, false);
}
