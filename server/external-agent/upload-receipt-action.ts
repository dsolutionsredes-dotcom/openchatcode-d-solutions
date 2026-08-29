import {
  abortUploadReceipt,
  claimUploadReceipt,
  commitUploadReceipt,
} from './import-token.ts';

export interface UploadReceiptActionResult {
  status: number;
  body: Record<string, unknown>;
}

/** Shared receipt transition used by both the HTTP bridge and server-local finalization. */
export function processUploadReceiptAction(body: Record<string, unknown>): UploadReceiptActionResult {
  if (body.action === 'claim') {
    const claimed = claimUploadReceipt(body.receipt, body.projectId, body.claimId);
    if (claimed.status !== 'accepted') {
      // Do not log the receipt, project id, or claim id: they are credentials.
      // The state is enough to diagnose a failed server-side import safely.
      console.warn(`[upload-receipt] claim rejected: ${claimed.status}`);
      return {
        status: 409,
        body: {
          error: claimed.status === 'claimed'
            ? 'upload receipt is already being finalized'
            : 'upload receipt is invalid, expired, consumed, or outside this project',
        },
      };
    }
    return {
      status: 200,
      body: { ...claimed.value, claimId: claimed.claimId, claimExpiresAt: claimed.claimExpiresAt },
    };
  }
  if (body.action === 'commit') {
    const committed = commitUploadReceipt(body.receipt, body.projectId, body.claimId);
    return {
      status: committed ? 200 : 409,
      body: committed
        ? { ok: true, state: 'committed' }
        : { error: 'upload receipt claim is invalid, expired, or no longer current' },
    };
  }
  if (body.action === 'abort') {
    const aborted = abortUploadReceipt(body.receipt, body.projectId, body.claimId);
    return {
      status: aborted ? 200 : 409,
      body: aborted
        ? { ok: true, state: 'available' }
        : { error: 'upload receipt claim is invalid, expired, or no longer current' },
    };
  }
  return { status: 400, body: { error: 'upload receipt action must be claim, commit, or abort' } };
}
