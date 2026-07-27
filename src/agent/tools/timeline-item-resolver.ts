import type { TimelineItem, TimelineState } from '../../editor/types';

export const EDITABLE_TIMELINE_KINDS = new Set<TimelineItem['kind']>([
  'video', 'audio', 'image', 'gif', 'text', 'solid', 'svg', 'motion-graphic',
]);

export type TimelineItemResolution = { item: TimelineItem } | { error: string; candidates?: string[] };

/** Resolve a real timeline item. Exact ids win; prefixes are accepted only when unique. */
export function resolveTimelineItem(state: TimelineState, raw: unknown): TimelineItemResolution {
  const ref = String(raw ?? '').trim();
  if (!ref) return { error: 'itemId is required' };
  const track = state.tracks?.[ref];
  if (/^(?:C1|C2|V1|V2|A1|A2)$/i.test(ref) || track?.kind === 'caption') return { error: `${ref} is a track alias/id, not a TimelineItem` };
  if (track) return { error: `${ref} is a track id, not a TimelineItem` };
  const exact = state.items.find((item) => item.id === ref);
  if (exact) return EDITABLE_TIMELINE_KINDS.has(exact.kind) ? { item: exact } : { error: `${ref} is not an editable timeline item` };
  const hits = state.items.filter((item) => item.id.startsWith(ref));
  if (hits.length === 1) return EDITABLE_TIMELINE_KINDS.has(hits[0]!.kind) ? { item: hits[0]! } : { error: `${ref} is not an editable timeline item` };
  if (hits.length > 1) return { error: `ambiguous item prefix "${ref}"`, candidates: hits.map((item) => item.id) };
  return { error: `no timeline item ${ref}` };
}
