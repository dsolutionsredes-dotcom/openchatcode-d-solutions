import { resolveAssetReference } from '../../src/agent/asset-resolver.ts';
import { EXTERNAL_DRAFT_TOOL_NAMES, isExternalDraftTool } from '../../src/agent/external-tool-policy.ts';
import type { MediaAsset } from '../../src/editor/types.ts';

/**
 * Tools that execute against the server-side draft context without a browser,
 * editor bridge, or relative browser fetch. Mutating tools remain staged by
 * ExternalEditSession and therefore still require Apply/Reject.
 */
export const SERVER_SAFE_TOOLS = EXTERNAL_DRAFT_TOOL_NAMES;

export function isExternalAgentToolAllowed(name: string): boolean {
  return isExternalDraftTool(name);
}

/** Prepare deterministic project-asset context before an external LLM run. */
export function prepareExternalAgentInput(
  message: string,
  assets: readonly MediaAsset[],
  references: unknown[],
): { content?: string; clarification?: string } {
  const resolved = resolveAssetReference(assets, message, { references });
  if (resolved.status === 'ambiguous') {
    const candidates = resolved.candidates.map((asset) => `${asset.name} (${asset.kind}, ${asset.id})`).join(', ');
    return { clarification: `Necesito aclaración para identificar el asset: ${candidates}.` };
  }
  const entries = [...references];
  if (resolved.status === 'resolved') {
    entries.push({ type: 'asset', id: resolved.asset.id, name: resolved.asset.name, kind: resolved.asset.kind, src: resolved.asset.src, durationInFrames: resolved.asset.durationInFrames });
  }
  return {
    content: entries.length ? `${message}\n\n${JSON.stringify({ type: 'chat_context_entry', entries })}` : message,
  };
}
