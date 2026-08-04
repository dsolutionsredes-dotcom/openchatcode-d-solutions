import { resolveAssetReference } from '../../src/agent/asset-resolver.ts';
import type { MediaAsset } from '../../src/editor/types.ts';

const SERVER_SAFE_TOOLS = new Set([
  'read_timeline', 'read_project', 'set_aspect_ratio', 'move_item', 'set_item_timing', 'duplicate_item',
  'remove_item', 'split_item', 'clear_timeline', 'update_item_props', 'edit_item',
  'edit_track', 'manage_timelines', 'manage_media_pool', 'edit_project', 'edit_captions',
]);

export function isExternalAgentToolAllowed(name: string): boolean {
  return SERVER_SAFE_TOOLS.has(name);
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
