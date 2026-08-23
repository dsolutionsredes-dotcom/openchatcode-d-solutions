import { policyForTool } from '../../src/agent/execution-policy.ts';
import {
  isExternalServerDirectCall,
  isExternalServerDirectTool,
} from '../../src/agent/external-tool-policy.ts';
import { ExternalEditorCallError } from './broker.ts';

export function assertOfflineToolAllowed(
  name: string,
  args: Record<string, unknown>,
  editorUrl: string,
): void {
  if (!isExternalServerDirectTool(name)) {
    throw new ExternalEditorCallError(
      'rejected',
      `Tool ${name} requires the browser editor. Open ${editorUrl} for visual/canvas inspection, generation, upload, network, preset, render, or export tools.`,
    );
  }
  if (!isExternalServerDirectCall(name, args)) {
    throw new ExternalEditorCallError(
      'rejected',
      `Tool ${name} action ${String(args.action ?? '')} uses browser-backed data. Open ${editorUrl} to run it.`,
    );
  }
  const policy = policyForTool(name);
  // Headless cloud transcription is the one paid external operation admitted
  // through the already-authenticated AUTO_EDITOR draft boundary. Local and
  // AssemblyAI providers still fail closed in offline-executor.
  if (policy.effect !== 'read' && policy.effect !== 'reversible_edit'
    && name !== 'finalize_uploaded_asset' && name !== 'transcribe_track') {
    throw new ExternalEditorCallError(
      'rejected',
      `Tool ${name} is not permitted by the offline execution policy.`,
    );
  }
}
